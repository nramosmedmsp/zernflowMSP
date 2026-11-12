// Deshacer un cambio de etapa sobre la base en memoria: restaura la etapa, deja
// constancia, NO vuelve a disparar flujos ni reglas, y se niega fuera de la
// ventana, a otra persona o si alguien cambió algo después.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { FakeDb } from "./fake-db.test-helper";

const emitStageChanged = vi.hoisted(() => vi.fn());
vi.mock("./events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./events")>()),
  emitStageChanged,
}));

import { addNote, changeStage, handleInbound, undoStageChange } from "./index";
import { UNDO_GRACE_MS, UNDO_WINDOW_MS } from "./undo";

type Row = Record<string, unknown>;

const WS = "ws-1";
const ANA = "u-1-ana";
const SARA = "u-3-sara";

let fake: FakeDb;
const db = () => fake.asDb();

function byName(table: string, name: string, typeName: string): Row {
  const typeId = fake.rows("case_types").find((t) => t.name === typeName)!.id;
  return fake.rows(table).find((r) => r.name === name && r.case_type_id === typeId)!;
}
const stageId = (name: string, type = "Venta") => byName("case_stages", name, type).id as string;
const caseRow = (id: string) => fake.rows("cases").find((c) => c.id === id)!;
const stageLog = (caseId: string) => fake.rows("activity").filter((a) => a.case_id === caseId && a.type === "stage_changed");

async function setup() {
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: SARA, role: "member" },
  ]);
  await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "ecommerce");
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María" }]);
  const [conversation] = fake.seed("conversations", [{ workspace_id: WS, contact_id: contact.id, channel_id: "ch" }]);
  const opened = await handleInbound(db(), { workspaceId: WS, contactId: contact.id as string, conversationId: conversation.id as string });
  emitStageChanged.mockClear();
  return opened!.caseId;
}

const move = (caseId: string, to: string, actorId = ANA) =>
  changeStage(db(), { caseId, stageId: stageId(to), actorId, guide: { canSupervise: false } });

describe("deshacer un cambio de etapa", () => {
  let caseId: string;
  beforeEach(async () => {
    caseId = await setup();
  });

  it("devuelve la etapa anterior y deja constancia en el historial", async () => {
    const moved = await move(caseId, "Asesorando");
    expect(moved).toMatchObject({ ok: true, move: { fromStageId: stageId("Nuevo interesado"), toStageId: stageId("Asesorando") } });

    const undone = await undoStageChange(db(), { caseId, actorId: ANA, expectedStageId: stageId("Asesorando") });
    expect(undone).toEqual({ ok: true, stageId: stageId("Nuevo interesado") });
    expect(caseRow(caseId).stage_id).toBe(stageId("Nuevo interesado"));

    const log = stageLog(caseId);
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({
      actor_id: ANA,
      from_value: stageId("Asesorando"),
      to_value: stageId("Nuevo interesado"),
      meta: { undo: true },
    });
  });

  it("no vuelve a disparar los flujos ni las reglas de entrar a la etapa restaurada", async () => {
    await move(caseId, "Asesorando");
    expect(emitStageChanged).toHaveBeenCalledTimes(1);
    const scheduledBefore = fake.rows("cases").length;
    await undoStageChange(db(), { caseId, actorId: ANA, expectedStageId: stageId("Asesorando") });
    expect(emitStageChanged).toHaveBeenCalledTimes(1);
    expect(fake.rows("cases")).toHaveLength(scheduledBefore);
  });

  it("avisa cuando el movimiento ya disparó un flujo (lo que no se puede revertir)", async () => {
    const [flow] = fake.seed("flows", [{ workspace_id: WS, name: "Aviso", status: "published" }]);
    fake.seed("triggers", [
      { workspace_id: WS, flow_id: flow.id, type: "case_stage_changed", is_active: true, config: { stage_id: stageId("Asesorando") } },
      // Otra etapa y otro flujo sin publicar: no cuentan.
      { workspace_id: WS, flow_id: flow.id, type: "case_stage_changed", is_active: true, config: { stage_id: stageId("Esperando pago") } },
    ]);
    const moved = await move(caseId, "Asesorando");
    expect(moved).toMatchObject({ ok: true, move: { effects: { flows: 1 } } });
    expect((moved as { move: { irreversible: string | null } }).move.irreversible).toContain("1 flujo automático");

    const quiet = await move(caseId, "Pedido o enlace de pago enviado");
    expect((quiet as { move: { irreversible: string | null } }).move.irreversible).toBeNull();
  });

  it("solo quien movió la gestión puede deshacer", async () => {
    await move(caseId, "Asesorando");
    const r = await undoStageChange(db(), { caseId, actorId: SARA, expectedStageId: stageId("Asesorando") });
    expect(r).toMatchObject({ error: expect.stringContaining("Solo quien movió") });
    expect(caseRow(caseId).stage_id).toBe(stageId("Asesorando"));
  });

  it("se rechaza fuera de la ventana", async () => {
    await move(caseId, "Asesorando");
    const late = new Date(Date.now() + UNDO_WINDOW_MS + UNDO_GRACE_MS + 1_000);
    const r = await undoStageChange(db(), { caseId, actorId: ANA, expectedStageId: stageId("Asesorando") }, late);
    expect(r).toMatchObject({ error: expect.stringContaining("Ya pasó el tiempo") });
    expect(caseRow(caseId).stage_id).toBe(stageId("Asesorando"));
    // Dentro de la ventana (con la hora real) sí se puede.
    const soon = await undoStageChange(db(), { caseId, actorId: ANA, expectedStageId: stageId("Asesorando") });
    expect(soon).toMatchObject({ ok: true });
  });

  it("se rechaza si alguien más cambió la gestión después", async () => {
    await move(caseId, "Asesorando");
    await addNote(db(), { caseId, body: "Ya hablé con el cliente", actorId: SARA });
    const r = await undoStageChange(db(), { caseId, actorId: ANA, expectedStageId: stageId("Asesorando") });
    expect(r).toMatchObject({ error: expect.stringContaining("Alguien más cambió") });
    expect(caseRow(caseId).stage_id).toBe(stageId("Asesorando"));
  });

  it("se rechaza si un flujo ya movió la gestión a otra etapa", async () => {
    await move(caseId, "Asesorando");
    fake.rows("cases").find((c) => c.id === caseId)!.stage_id = stageId("Esperando pago");
    const r = await undoStageChange(db(), { caseId, actorId: ANA, expectedStageId: stageId("Asesorando") });
    expect(r).toMatchObject({ error: expect.stringContaining("Alguien más cambió") });
  });

  it("no se deshace dos veces ni se deshace un deshacer", async () => {
    await move(caseId, "Asesorando");
    await undoStageChange(db(), { caseId, actorId: ANA, expectedStageId: stageId("Asesorando") });
    const again = await undoStageChange(db(), { caseId, actorId: ANA, expectedStageId: stageId("Nuevo interesado") });
    expect(again).toMatchObject({ error: expect.any(String) });
    expect(caseRow(caseId).stage_id).toBe(stageId("Nuevo interesado"));
  });

  it("no deshace otro cambio distinto del que se mostró", async () => {
    await move(caseId, "Asesorando");
    const r = await undoStageChange(db(), { caseId, actorId: ANA, expectedStageId: stageId("Esperando pago") });
    expect(r).toMatchObject({ error: expect.any(String) });
    expect(caseRow(caseId).stage_id).toBe(stageId("Asesorando"));
  });

  it("no hay nada que deshacer en una gestión cerrada", async () => {
    await move(caseId, "Asesorando");
    caseRow(caseId).status = "won";
    const r = await undoStageChange(db(), { caseId, actorId: ANA, expectedStageId: stageId("Asesorando") });
    expect(r).toMatchObject({ error: expect.stringContaining("cerrada") });
  });
});
