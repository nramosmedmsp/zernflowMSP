// Guía de la gestión sobre la base en memoria: el orden estricto lo exige el
// servidor al cambiar de etapa y al cerrar (asesor bloqueado, supervisor y
// automatización exentos, volver un paso permitido), el salto de un supervisor
// queda en el historial y la plantilla de E-commerce trae la guía configurada.

import { beforeEach, describe, expect, it } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { FakeDb } from "./fake-db.test-helper";
import { changeStage, closeOrRequestClose, handleInbound } from "./index";
import { parseNextSteps, resolveExits, toGuideStage } from "./guide";

type Row = Record<string, unknown>;

const WS = "ws-1";
const ANA = "u-1-ana";
const SARA = "u-3-sara";

let fake: FakeDb;
const db = () => fake.asDb();

function byName(table: string, name: string, typeName?: string): Row {
  const typeId = typeName ? fake.rows("case_types").find((t) => t.name === typeName)!.id : null;
  const row = fake.rows(table).find((r) => r.name === name && (!typeId || r.case_type_id === typeId));
  if (!row) throw new Error(`${table}: ${name} no existe`);
  return row;
}
const stageId = (name: string, type = "Venta") => byName("case_stages", name, type).id as string;
const caseRow = (id: string) => fake.rows("cases").find((c) => c.id === id)!;

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
  return opened!.caseId;
}

function setStrict(on: boolean, typeName = "Venta") {
  fake.rows("case_types").find((t) => t.name === typeName)!.strict_order = on;
}

describe("la plantilla de E-commerce trae la guía", () => {
  beforeEach(async () => {
    await setup();
  });

  it("guarda textos, requisitos y pasos siguientes con ids del mismo tipo", () => {
    const esperando = byName("case_stages", "Esperando pago", "Venta");
    expect(esperando.guide_text).toBe("Espera la confirmación del pago (Yape, Plin o transferencia).");
    const steps = parseNextSteps(esperando.next_steps);
    expect(steps).toEqual([
      { stageId: stageId("Pagado"), action: null, label: "Pagó" },
      { stageId: null, action: "remind_tomorrow", label: "Aún no, recordarle mañana" },
      { stageId: stageId("No compró"), action: null, label: null },
    ]);
    const nueva = byName("case_stages", "Nueva", "Postventa");
    expect(nueva.requires).toBe("category");
    expect(byName("case_stages", "En gestión", "Postventa").requires).toBe("solution");
    // Cada destino pertenece al mismo tipo que la etapa.
    for (const st of fake.rows("case_stages")) {
      for (const step of parseNextSteps(st.next_steps)) {
        if (!step.stageId) continue;
        const target = fake.rows("case_stages").find((s) => s.id === step.stageId)!;
        expect(target.case_type_id).toBe(st.case_type_id);
      }
    }
  });

  it("los botones de Esperando pago son Pagó, el recordatorio y No compró", () => {
    const stages = fake.rows("case_stages").filter((s) => s.case_type_id === byName("case_types", "Venta").id).map((r) => toGuideStage(r as never));
    expect(resolveExits(stages, stageId("Esperando pago")).map((e) => [e.label, e.tone])).toEqual([
      ["Pagó", "primary"],
      ["Aún no, recordarle mañana", "ghost"],
      ["No compró", "danger"],
    ]);
  });
});

describe("orden estricto en changeStage", () => {
  let caseId: string;

  beforeEach(async () => {
    caseId = await setup();
  });

  it("apagado: el asesor puede ir a cualquier etapa abierta", async () => {
    const r = await changeStage(db(), { caseId, stageId: stageId("Esperando pago"), actorId: ANA, guide: { canSupervise: false } });
    expect(r).toMatchObject({ ok: true });
  });

  it("encendido: el asesor solo va a los pasos siguientes", async () => {
    setStrict(true);
    // Nuevo interesado → Esperando pago no está en sus pasos.
    const blocked = await changeStage(db(), { caseId, stageId: stageId("Esperando pago"), actorId: ANA, guide: { canSupervise: false } });
    expect(blocked).toMatchObject({ error: expect.stringContaining("Orden estricto") });
    expect(caseRow(caseId).stage_id).toBe(stageId("Nuevo interesado"));

    const ok = await changeStage(db(), { caseId, stageId: stageId("Asesorando"), actorId: ANA, guide: { canSupervise: false } });
    expect(ok).toMatchObject({ ok: true });
    expect(caseRow(caseId).stage_id).toBe(stageId("Asesorando"));
  });

  it("encendido: el asesor puede volver un paso", async () => {
    setStrict(true);
    await changeStage(db(), { caseId, stageId: stageId("Asesorando"), actorId: ANA, guide: { canSupervise: false } });
    const back = await changeStage(db(), { caseId, stageId: stageId("Nuevo interesado"), actorId: ANA, guide: { canSupervise: false } });
    expect(back).toMatchObject({ ok: true });
  });

  it("encendido: el supervisor salta y queda en el historial con quién fue", async () => {
    setStrict(true);
    const r = await changeStage(db(), {
      caseId,
      stageId: stageId("Esperando pago"),
      actorId: SARA,
      guide: { canSupervise: true, jump: true },
    });
    expect(r).toMatchObject({ ok: true });
    const log = fake.rows("activity").filter((a) => a.type === "stage_changed" && a.case_id === caseId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_id: SARA, to_value: stageId("Esperando pago"), meta: { jump: true } });
  });

  it("un cambio normal no se marca como salto", async () => {
    await changeStage(db(), { caseId, stageId: stageId("Asesorando"), actorId: ANA, guide: { canSupervise: false, jump: true } });
    const log = fake.rows("activity").filter((a) => a.type === "stage_changed" && a.case_id === caseId);
    expect(log[0].meta).toEqual({});
  });

  it("encendido: un flujo o regla (sin guía) mueve la gestión a cualquier etapa", async () => {
    setStrict(true);
    const r = await changeStage(db(), { caseId, stageId: stageId("Esperando pago"), actorId: null });
    expect(r).toMatchObject({ ok: true });
    expect(caseRow(caseId).stage_id).toBe(stageId("Esperando pago"));
  });
});

describe("la etapa pide categoría (Postventa › Nueva)", () => {
  async function postventaCase() {
    const caseId = await setup();
    const postventa = byName("case_types", "Postventa");
    fake.rows("cases").find((c) => c.id === caseId)!.case_type_id = postventa.id;
    fake.rows("cases").find((c) => c.id === caseId)!.stage_id = stageId("Nueva", "Postventa");
    return caseId;
  }

  it("el asesor no avanza sin categoría; con categoría sí; el supervisor sí", async () => {
    const caseId = await postventaCase();
    const target = stageId("En gestión", "Postventa");
    const blocked = await changeStage(db(), { caseId, stageId: target, actorId: ANA, guide: { canSupervise: false } });
    expect(blocked).toMatchObject({ error: expect.stringContaining("categoría") });

    fake.rows("cases").find((c) => c.id === caseId)!.category_id = byName("case_categories", "Producto dañado").id;
    expect(await changeStage(db(), { caseId, stageId: target, actorId: ANA, guide: { canSupervise: false } })).toMatchObject({ ok: true });
  });

  it("la automatización no queda limitada", async () => {
    const caseId = await postventaCase();
    expect(await changeStage(db(), { caseId, stageId: stageId("En gestión", "Postventa"), actorId: null })).toEqual({ ok: true });
  });
});

describe("orden estricto al cerrar", () => {
  let caseId: string;

  beforeEach(async () => {
    caseId = await setup();
    setStrict(true);
  });

  const closeInput = (name: string) => ({ caseId, stageId: stageId(name), outcomeReasonId: byName("case_outcome_reasons", "Precio").id as string, actorId: ANA });

  it("el asesor no cierra desde una etapa cuyo paso siguiente no incluye ese cierre", async () => {
    // Nuevo interesado solo lleva a Asesorando.
    const r = await closeOrRequestClose(db(), closeInput("No compró"), { actorIsSupervisor: false, guide: true });
    expect(r).toMatchObject({ error: expect.stringContaining("Orden estricto") });
    expect(caseRow(caseId).status).toBe("open");
  });

  it("el asesor cierra por un paso configurado (Asesorando → No compró)", async () => {
    await changeStage(db(), { caseId, stageId: stageId("Asesorando"), actorId: null });
    const r = await closeOrRequestClose(db(), closeInput("No compró"), { actorIsSupervisor: false, guide: true });
    expect(r).toMatchObject({ ok: true, requested: false, status: "lost" });
  });

  it("el supervisor cierra desde cualquier etapa", async () => {
    const r = await closeOrRequestClose(db(), { ...closeInput("No compró"), actorId: SARA }, { actorIsSupervisor: true, guide: true });
    expect(r).toMatchObject({ ok: true, status: "lost" });
  });

  it("sin la marca de interfaz (cron, flujos) no se aplica", async () => {
    const r = await closeOrRequestClose(db(), closeInput("No compró"), { actorIsSupervisor: false });
    expect(r).toMatchObject({ ok: true, status: "lost" });
  });

  it("apagado, el asesor cierra desde cualquier etapa", async () => {
    setStrict(false);
    const r = await closeOrRequestClose(db(), closeInput("No compró"), { actorIsSupervisor: false, guide: true });
    expect(r).toMatchObject({ ok: true, status: "lost" });
  });
});
