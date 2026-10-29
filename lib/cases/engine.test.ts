// Recorrido completo del motor sobre la base en memoria (fake-db): entrante,
// reparto, respuesta humana, cierre con reglas, reapertura y cron.

import { beforeEach, describe, expect, it } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { FakeDb } from "./fake-db.test-helper";
import {
  activateScheduledCases,
  addNote,
  changeStage,
  closeCase,
  handleHumanOutboundForConversation,
  handleInbound,
  notifyOverdueNextActions,
  openCase,
  previewClose,
  retryUnassignedCases,
  setNextAction,
  stampBotOutbound,
} from "./index";

type Row = Record<string, unknown>;

const WS = "ws-1";
const OWNER = "u-0-owner";
const ANA = "u-1-ana";
const BETO = "u-2-beto";

let fake: FakeDb;

function byName(table: string, name: string): Row {
  const row = fake.rows(table).find((r) => r.name === name);
  if (!row) throw new Error(`${table}: ${name} no existe`);
  return row;
}

function caseById(id: string): Row {
  return fake.rows("cases").find((c) => c.id === id)!;
}

function activity(type: string, caseId?: string): Row[] {
  return fake.rows("activity").filter((a) => a.type === type && (!caseId || a.case_id === caseId));
}

async function setup(template: "ecommerce" | "gym" = "ecommerce") {
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: BETO, role: "member" },
  ]);
  await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, template);
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María" }]);
  const [conversation] = fake.seed("conversations", [{ workspace_id: WS, contact_id: contact.id, channel_id: "ch" }]);
  return { contactId: contact.id as string, conversationId: conversation.id as string };
}

const db = () => fake.asDb();

describe("motor de gestiones (E-commerce)", () => {
  let contactId: string;
  let conversationId: string;

  beforeEach(async () => {
    ({ contactId, conversationId } = await setup());
  });

  it("entrante: tipo de contacto por defecto, Venta sugerida, primera etapa y reparto por turnos", async () => {
    const result = await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: "2026-10-18T15:00:00.000Z" });
    expect(result).toMatchObject({ opened: true, reopened: false });

    const contact = fake.rows("contacts")[0];
    expect(contact.contact_type_id).toBe(byName("contact_types", "Prospecto").id);

    const row = caseById(result!.caseId);
    const venta = byName("case_types", "Venta");
    expect(row.case_type_id).toBe(venta.id);
    expect(row.stage_id).toBe(
      fake.rows("case_stages").find((s) => s.case_type_id === venta.id && s.name === "Nuevo interesado")!.id,
    );
    expect(row.waiting_since).toBe("2026-10-18T15:00:00.000Z");
    // Por turnos entre los miembros 'member' (ninguno había recibido: gana el menor id).
    expect(row.assignee_id).toBe(ANA);
    // Primer reparto "al responsable": fija el responsable del contacto.
    expect(contact.owner_id).toBe(ANA);
    expect(fake.rows("notifications").filter((n) => n.user_id === ANA && n.type === "case_assigned")).toHaveLength(1);
    expect(activity("case_opened")).toHaveLength(1);
    expect(activity("assigned")).toHaveLength(1);
    expect(activity("contact_type_changed")).toHaveLength(1);
  });

  it("dos contactos nuevos seguidos van a personas distintas", async () => {
    const [other] = fake.seed("contacts", [{ workspace_id: WS, display_name: "Pedro" }]);
    const a = await handleInbound(db(), { workspaceId: WS, contactId });
    const b = await handleInbound(db(), { workspaceId: WS, contactId: other.id as string });
    expect(caseById(a!.caseId).assignee_id).toBe(ANA);
    expect(caseById(b!.caseId).assignee_id).toBe(BETO);
  });

  it("mensajes simultáneos del mismo contacto no abren dos gestiones", async () => {
    const [a, b] = await Promise.all([
      handleInbound(db(), { workspaceId: WS, contactId }),
      handleInbound(db(), { workspaceId: WS, contactId }),
    ]);
    expect(a!.caseId).toBe(b!.caseId);
    expect(fake.rows("cases")).toHaveLength(1);
  });

  it("primera respuesta solo humana; la respuesta humana pausa el bot", async () => {
    const { caseId } = (await handleInbound(db(), {
      workspaceId: WS,
      contactId,
      conversationId,
      at: "2026-10-18T15:00:00.000Z",
    }))!;
    await handleInbound(db(), { workspaceId: WS, contactId, at: "2026-10-18T15:01:00.000Z" });
    expect(caseById(caseId).waiting_since).toBe("2026-10-18T15:00:00.000Z");

    await stampBotOutbound(db(), { contactId, at: "2026-10-18T15:01:05.000Z" });
    expect(caseById(caseId)).toMatchObject({
      last_outbound_at: "2026-10-18T15:01:05.000Z",
      waiting_since: "2026-10-18T15:00:00.000Z",
      first_response_at: null,
    });

    await handleHumanOutboundForConversation(db(), { conversationId, userId: ANA, at: "2026-10-18T15:05:00.000Z" });
    expect(caseById(caseId)).toMatchObject({ first_response_at: "2026-10-18T15:05:00.000Z", waiting_since: null });
    expect(activity("first_response", caseId)[0].meta).toMatchObject({ seconds: 300 });
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(true);
  });

  it("cerrar una Venta ganada: Cliente, Recompra a 25 días y reanuda el bot", async () => {
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId }))!;
    await handleHumanOutboundForConversation(db(), { conversationId, userId: ANA });
    const now = new Date("2026-10-18T19:35:00Z");

    const preview = await previewClose(db(), { caseId, kind: "won" }, now);
    expect(preview).toMatchObject({
      ok: true,
      preview: {
        kind: "won",
        askKeyDate: null,
        contactType: { to: byName("contact_types", "Cliente").id },
        schedules: [{ caseTypeName: "Recompra", scheduledFor: "2026-11-12T14:00:00.000Z", days: 25 }],
      },
    });

    const result = await closeCase(db(), { caseId, kind: "won", actorId: ANA }, now);
    expect(result).toMatchObject({ ok: true, status: "won" });
    expect(caseById(caseId)).toMatchObject({ status: "won", closed_by: ANA, closed_at: now.toISOString() });
    expect(fake.rows("contacts")[0].contact_type_id).toBe(byName("contact_types", "Cliente").id);

    const recompra = fake.rows("cases").find((c) => c.status === "scheduled")!;
    expect(recompra).toMatchObject({
      case_type_id: byName("case_types", "Recompra").id,
      origin: "proactive",
      scheduled_for: "2026-11-12T14:00:00.000Z",
    });
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(false);
  });

  it("el asesor cambia la fecha de la Recompra al cerrar", async () => {
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    const now = new Date("2026-10-18T19:35:00Z");
    await closeCase(db(), { caseId, kind: "won", actorId: ANA, overrides: { schedule_at: "2026-12-20" } }, now);
    expect(fake.rows("cases").find((c) => c.status === "scheduled")!.scheduled_for).toBe("2026-12-20T14:00:00.000Z");
  });

  it("perder exige el motivo", async () => {
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    expect(await closeCase(db(), { caseId, kind: "lost", actorId: ANA })).toEqual({ error: "Elige el motivo del resultado." });
    const venta = byName("case_types", "Venta");
    const precio = fake.rows("case_outcome_reasons").find((r) => r.case_type_id === venta.id && r.name === "Precio")!;
    expect(await closeCase(db(), { caseId, kind: "lost", outcomeReasonId: precio.id as string, actorId: ANA })).toMatchObject({
      ok: true,
      status: "lost",
    });
    // Perder no programa nada ni cambia el tipo de contacto.
    expect(fake.rows("cases").filter((c) => c.status === "scheduled")).toHaveLength(0);
  });

  it("Cliente frecuente desde la segunda ganada; no duplica la Recompra", async () => {
    const first = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    await closeCase(db(), { caseId: first.caseId, kind: "won", actorId: ANA });
    const second = await openCase(db(), {
      workspaceId: WS,
      contactId,
      caseTypeId: byName("case_types", "Venta").id as string,
      actorId: ANA,
    });
    expect(second).toMatchObject({ ok: true, status: "open" });
    if (!("ok" in second)) throw new Error();
    await closeCase(db(), { caseId: second.caseId, kind: "won", actorId: ANA });
    expect(fake.rows("contacts")[0].contact_type_id).toBe(byName("contact_types", "Cliente frecuente").id);
    expect(fake.rows("cases").filter((c) => c.status === "scheduled")).toHaveLength(1);
  });

  it("reapertura: el cliente escribe dentro de 24 h y vuelve la misma gestión a su etapa previa", async () => {
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    const venta = byName("case_types", "Venta");
    const asesorando = fake.rows("case_stages").find((s) => s.case_type_id === venta.id && s.name === "Asesorando")!;
    await changeStage(db(), { caseId, stageId: asesorando.id as string, actorId: ANA });
    await closeCase(db(), { caseId, kind: "won", actorId: ANA }, new Date("2026-10-18T10:00:00Z"));

    const again = await handleInbound(db(), { workspaceId: WS, contactId, at: "2026-10-18T20:00:00.000Z" });
    expect(again).toMatchObject({ caseId, opened: false, reopened: true });
    expect(caseById(caseId)).toMatchObject({
      status: "open",
      closed_at: null,
      stage_id: asesorando.id,
      waiting_since: "2026-10-18T20:00:00.000Z",
    });
    expect(activity("case_reopened", caseId)).toHaveLength(1);
  });

  it("pasadas 24 h se abre una gestión nueva", async () => {
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    await closeCase(db(), { caseId, kind: "won", actorId: ANA }, new Date("2026-10-17T10:00:00Z"));
    const again = await handleInbound(db(), { workspaceId: WS, contactId, at: "2026-10-18T10:00:01.000Z" });
    expect(again!.caseId).not.toBe(caseId);
    expect(again!.opened).toBe(true);
  });

  it("cron: activa la Recompra del día, la reparte al responsable y avisa", async () => {
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    await closeCase(db(), { caseId, kind: "won", actorId: ANA });
    const recompra = fake.rows("cases").find((c) => c.status === "scheduled")!;
    recompra.scheduled_for = "2026-01-01T14:00:00.000Z";

    const r = await activateScheduledCases(db(), { deadline: Date.now() + 5000 });
    expect(r.activated).toBe(1);
    expect(caseById(recompra.id as string)).toMatchObject({ status: "open", assignee_id: ANA });
    const n = fake.rows("notifications").filter((x) => x.type === "case_activated");
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe("Recompra para hoy: María");
    // Una segunda vuelta no la vuelve a activar.
    expect((await activateScheduledCases(db(), { deadline: Date.now() + 5000 })).activated).toBe(0);
  });

  it("sin elegibles avisa a los administradores; el cron la asigna cuando alguien vuelve", async () => {
    for (const m of fake.rows("workspace_members")) m.availability = "away";
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    expect(caseById(caseId).assignee_id).toBeNull();
    const unassigned = fake.rows("notifications").filter((x) => x.type === "case_unassigned");
    expect(unassigned.map((x) => x.user_id)).toEqual([OWNER]);

    // Otro mensaje no repite el aviso.
    await handleInbound(db(), { workspaceId: WS, contactId });
    expect(fake.rows("notifications").filter((x) => x.type === "case_unassigned")).toHaveLength(1);

    // El cron sin nadie disponible no hace nada.
    expect((await retryUnassignedCases(db(), { deadline: Date.now() + 5000 })).assigned).toBe(0);

    fake.rows("workspace_members").find((m) => m.user_id === BETO)!.availability = "available";
    const r = await retryUnassignedCases(db(), { deadline: Date.now() + 5000 });
    expect(r.assigned).toBe(1);
    expect(caseById(caseId).assignee_id).toBe(BETO);
    expect(fake.rows("notifications").filter((x) => x.type === "case_unassigned")).toHaveLength(1);
  });

  it("próximo contacto vencido: avisa una sola vez por fecha", async () => {
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    const longAgo = new Date("2025-12-01T00:00:00Z");
    await setNextAction(db(), { caseId, at: "2026-01-02T10:00:00.000Z", note: "Llamar", actorId: ANA }, longAgo);
    expect((await notifyOverdueNextActions(db(), { deadline: Date.now() + 5000 })).notified).toBe(1);
    expect((await notifyOverdueNextActions(db(), { deadline: Date.now() + 5000 })).notified).toBe(0);
    const due = fake.rows("notifications").filter((x) => x.type === "next_action_due");
    expect(due).toMatchObject([{ user_id: ANA, body: "Llamar", title: "Próximo contacto vencido: María" }]);

    // Una fecha nueva vuelve a avisar.
    await setNextAction(db(), { caseId, at: "2026-01-03T10:00:00.000Z", actorId: ANA }, longAgo);
    expect((await notifyOverdueNextActions(db(), { deadline: Date.now() + 5000 })).notified).toBe(1);
  });

  it("menciones: solo notifica a quien puede ver el contacto", async () => {
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    const result = await addNote(db(), { caseId, body: "Revisen el pago", mentions: [OWNER, BETO, "u-ajeno"], actorId: ANA });
    expect(result).toMatchObject({ ok: true, notified: [OWNER], notNotified: [BETO] });
    expect(fake.rows("case_notes")[0]).toMatchObject({ mentions: [OWNER, BETO], author_id: ANA });
    expect(fake.rows("notifications").filter((n) => n.type === "mention").map((n) => n.user_id)).toEqual([OWNER]);
  });
});

describe("motor de gestiones (Gimnasio)", () => {
  it("Venta de membresía ganada: pide el vencimiento, Socio activo y Renovación 7 días antes", async () => {
    const { contactId } = await setup("gym");
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    const now = new Date("2026-10-18T19:35:00Z");

    const preview = await previewClose(db(), { caseId, kind: "won" }, now);
    expect(preview).toMatchObject({ ok: true, preview: { askKeyDate: { label: "Vencimiento de membresía", current: null } } });

    expect(await closeCase(db(), { caseId, kind: "won", actorId: ANA }, now)).toEqual({
      error: "Indica la fecha: Vencimiento de membresía.",
    });
    expect(caseById(caseId).status).toBe("open");

    const result = await closeCase(db(), { caseId, kind: "won", keyDate: "2026-11-30", actorId: ANA }, now);
    expect(result).toMatchObject({ ok: true });
    const contact = fake.rows("contacts")[0];
    expect(contact).toMatchObject({
      key_date: "2026-11-30",
      contact_type_id: byName("contact_types", "Socio activo").id,
    });
    expect(fake.rows("cases").find((c) => c.status === "scheduled")).toMatchObject({
      case_type_id: byName("case_types", "Renovación").id,
      scheduled_for: "2026-11-23T14:00:00.000Z",
    });
  });
});

describe("próximo contacto y apertura manual con fechas (M-20, M-23)", () => {
  const NOW = new Date("2026-10-28T15:00:00Z"); // 10:00 en Lima

  it("rechaza un próximo contacto en el pasado y no cambia la gestión", async () => {
    const { contactId } = await setup();
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    const result = await setNextAction(db(), { caseId, at: "2020-01-01T15:00:00.000Z", actorId: ANA }, NOW);
    expect(result).toEqual({ error: "Esa fecha y hora ya pasaron. Elige una fecha y hora futuras para el próximo contacto." });
    expect(caseById(caseId).next_action_at).toBeNull();
    expect(activity("next_action_set", caseId)).toHaveLength(0);
  });

  it("una fecha sin hora de hoy (09:00 ya pasó) también se rechaza", async () => {
    const { contactId } = await setup();
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    const result = await setNextAction(db(), { caseId, at: "2026-10-28", actorId: ANA }, NOW);
    expect(result).toMatchObject({ error: expect.stringContaining("ya pasaron") });
  });

  it("acepta una fecha futura y quitar el próximo contacto", async () => {
    const { contactId } = await setup();
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    expect(await setNextAction(db(), { caseId, at: "2026-10-29T14:00:00.000Z", actorId: ANA }, NOW)).toMatchObject({ ok: true });
    expect(await setNextAction(db(), { caseId, at: null, actorId: ANA }, NOW)).toMatchObject({ ok: true, nextActionAt: null });
  });

  it("repetir la fecha que ya está atrasada permite editar la nota", async () => {
    const { contactId } = await setup();
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId }))!;
    const longAgo = new Date("2025-12-01T00:00:00Z");
    await setNextAction(db(), { caseId, at: "2026-01-02T10:00:00.000Z", actorId: ANA }, longAgo);
    const again = await setNextAction(db(), { caseId, at: "2026-01-02T10:00:00.000Z", note: "Nota nueva", actorId: ANA }, NOW);
    expect(again).toMatchObject({ ok: true });
    expect(caseById(caseId).next_action_note).toBe("Nota nueva");
  });

  it("abrir con una fecha programada que ya pasó devuelve error y no crea la gestión", async () => {
    const { contactId } = await setup();
    const ventaId = byName("case_types", "Venta").id as string;
    const before = fake.rows("cases").length;
    const past = await openCase(db(), { workspaceId: WS, contactId, caseTypeId: ventaId, actorId: ANA, scheduledFor: "2026-10-28" }, NOW);
    expect(past).toMatchObject({ error: expect.stringContaining("ya pasó") });
    expect(fake.rows("cases")).toHaveLength(before);

    const future = await openCase(db(), { workspaceId: WS, contactId, caseTypeId: ventaId, actorId: ANA, scheduledFor: "2026-10-29" }, NOW);
    expect(future).toMatchObject({ ok: true, status: "scheduled" });
  });
});
