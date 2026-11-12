// Dos asesores moviendo la misma gestión a la vez (CONF-11): gana el primero y el
// segundo recibe un aviso claro; nada se pisa.

import { beforeEach, describe, expect, it } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { FakeDb } from "./fake-db.test-helper";
import { changeStage, handleInbound, transferCase } from "./index";
import { CASE_CHANGED_MESSAGE, isCaseConflict } from "./conflict";

const WS = "ws-1";
const ANA = "u-1-ana";
const SARA = "u-3-sara";

let fake: FakeDb;
let caseId: string;
const db = () => fake.asDb();
const stageId = (name: string, type = "Venta") => {
  const typeId = fake.rows("case_types").find((t) => t.name === type)!.id;
  return fake.rows("case_stages").find((s) => s.name === name && s.case_type_id === typeId)!.id as string;
};
const row = () => fake.rows("cases").find((c) => c.id === caseId)!;

beforeEach(async () => {
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
  caseId = opened!.caseId;
});

describe("cambio de etapa con comprobación optimista", () => {
  it("si la gestión sigue en la etapa que veías, se mueve", async () => {
    const from = row().stage_id as string;
    const r = await changeStage(db(), { caseId, stageId: stageId("Asesorando"), actorId: ANA, expectedStageId: from });
    expect("error" in r).toBe(false);
    expect(row().stage_id).toBe(stageId("Asesorando"));
  });

  it("si otra persona ya la movió, no se pisa y el aviso es claro", async () => {
    const seen = row().stage_id as string;
    // Sara la mueve primero.
    await changeStage(db(), { caseId, stageId: stageId("Asesorando"), actorId: SARA, expectedStageId: seen });
    // Ana todavía veía la etapa anterior.
    const r = await changeStage(db(), { caseId, stageId: stageId("Pedido o enlace de pago enviado"), actorId: ANA, expectedStageId: seen });
    expect(r).toEqual({ error: CASE_CHANGED_MESSAGE });
    expect(isCaseConflict((r as { error: string }).error)).toBe(true);
    expect(row().stage_id).toBe(stageId("Asesorando"));
    // Y no quedó rastro de un segundo cambio en el historial.
    expect(fake.rows("activity").filter((a) => a.type === "stage_changed" && a.actor_id === ANA)).toHaveLength(0);
  });

  it("sin etapa esperada (flujos, reglas, cron) no se comprueba", async () => {
    await changeStage(db(), { caseId, stageId: stageId("Asesorando"), actorId: SARA });
    const r = await changeStage(db(), { caseId, stageId: stageId("Pedido o enlace de pago enviado"), actorId: null });
    expect("error" in r).toBe(false);
  });

  it("si la gestión se cerró en ese instante, el cambio de etapa no la deja cerrada con etapa abierta", async () => {
    // La lectura ve la gestión abierta, pero otra persona la cierra antes de escribir.
    fake.beforeUpdate = () => {
      row().status = "won";
    };
    const r = await changeStage(db(), { caseId, stageId: stageId("Asesorando"), actorId: ANA });
    fake.beforeUpdate = undefined;
    expect(r).toEqual({ error: CASE_CHANGED_MESSAGE });
    expect(row().stage_id).not.toBe(stageId("Asesorando"));
  });
});

describe("transferencia con comprobación", () => {
  it("si el reparto asignó la gestión mientras tanto, la transferencia no lo pisa en silencio", async () => {
    row().assignee_id = null;
    row().team_id = null;
    fake.beforeUpdate = () => {
      row().assignee_id = ANA;
    };
    const r = await transferCase(db(), { caseId, teamId: null, assigneeId: SARA, actorId: SARA });
    fake.beforeUpdate = undefined;
    expect(r).toEqual({ error: CASE_CHANGED_MESSAGE });
    expect(row().assignee_id).toBe(ANA);
  });
});
