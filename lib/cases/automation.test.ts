// Fase 2, tanda 1 (docs/FASE-2-TECNICO.md 3): reparto en horario, respuesta
// fuera de horario, reasignación por espera, plantilla automática,
// client_no_reply, eventos para flujos y fecha clave. Sobre la base en
// memoria (fake-db) y con la mensajería inyectada (sin red).
//
// Calendario de las pruebas (hora de Lima = UTC-5): el 16/10/2026 es viernes,
// el 18 domingo y el 19 lunes.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { FakeDb } from "./fake-db.test-helper";

vi.mock("@/lib/flow-engine/case-triggers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/flow-engine/case-triggers")>();
  return { ...actual, runCaseEventFlows: vi.fn(async () => {}) };
});

import { runCaseEventFlows, type CaseFlowEvent } from "@/lib/flow-engine/case-triggers";
import {
  buildAutoTemplateParams,
  parseAutoTemplate,
  sendAutoTemplate,
} from "./auto-template";
import {
  activateScheduledCases,
  changeStage,
  closeCase,
  handleInbound,
  retryUnassignedCases,
  scheduleCasesForKeyDate,
  type CaseMessenger,
} from "./index";
import { detectClientNoReply, nextNoReplyThreshold, noReplyMinutes } from "./no-reply";
import { offHoursReplyDue, renderOffHoursReply } from "./off-hours";
import { reassignWaitingCases } from "./reassign";

type Row = Record<string, unknown>;

const WS = "ws-1";
const OWNER = "u-0-owner";
const ANA = "u-1-ana";
const BETO = "u-2-beto";

const WEEKDAYS = { mon: [["09:00", "18:00"]], tue: [["09:00", "18:00"]], wed: [["09:00", "18:00"]], thu: [["09:00", "18:00"]], fri: [["09:00", "18:00"]] };

const SUNDAY_10AM = "2026-10-18T15:00:00.000Z";
const MONDAY_9AM = "2026-10-19T14:00:00.000Z";

let fake: FakeDb;
let contactId: string;
let conversationId: string;

const db = () => fake.asDb();
const deadline = () => Date.now() + 5000;

function caseById(id: string): Row {
  return fake.rows("cases").find((c) => c.id === id)!;
}

function activity(type: string, caseId?: string): Row[] {
  return fake.rows("activity").filter((a) => a.type === type && (!caseId || a.case_id === caseId));
}

function notifications(type: string): Row[] {
  return fake.rows("notifications").filter((n) => n.type === type);
}

function stageName(row: Row): string {
  return fake.rows("case_stages").find((s) => s.id === row.stage_id)!.name as string;
}

function setSettings(settings: Row) {
  fake.rows("workspaces")[0].settings = settings;
}

function minutesAfter(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
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
  fake.seed("channels", [{ id: "ch", workspace_id: WS, platform: "whatsapp", late_account_id: "acc-1" }]);
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María" }]);
  const [conversation] = fake.seed("conversations", [
    { workspace_id: WS, contact_id: contact.id, channel_id: "ch", late_conversation_id: "conv-1" },
  ]);
  contactId = contact.id as string;
  conversationId = conversation.id as string;
}

function messenger(overrides: Partial<CaseMessenger> = {}) {
  const sendText = vi.fn(async () => ({ ok: true as const, messageId: "m-text" }));
  const sendTemplate = vi.fn(async () => ({ ok: true as const, messageId: "m-tpl" }));
  return { sendText, sendTemplate, ...overrides } satisfies CaseMessenger;
}

const flowEvents = vi.mocked(runCaseEventFlows);

function emitted(type?: CaseFlowEvent["type"]): CaseFlowEvent[] {
  const all = flowEvents.mock.calls.map((c) => c[1]);
  return type ? all.filter((e) => e.type === type) : all;
}

beforeEach(() => {
  flowEvents.mockReset();
  flowEvents.mockImplementation(async () => {});
});

// ── 3.1 Reparto en horario ────────────────────────────────────────────────

describe("reparto en horario", () => {
  beforeEach(async () => {
    await setup();
    setSettings({ business_hours: WEEKDAYS });
  });

  it("fuera de horario la gestión queda sin asignar y sin aviso; el cron la reparte al abrir", async () => {
    const result = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: SUNDAY_10AM }))!;
    expect(result.assignment).toMatchObject({ status: "unassigned", reason: "off_hours" });
    expect(caseById(result.caseId).assignee_id).toBeNull();
    expect(notifications("case_unassigned")).toHaveLength(0);
    expect(notifications("case_assigned")).toHaveLength(0);

    // Cerrado: el cron no la toca.
    const closed = await retryUnassignedCases(db(), { deadline: deadline(), now: new Date(SUNDAY_10AM) });
    expect(closed).toMatchObject({ retried: 0, assigned: 0 });
    expect(caseById(result.caseId).assignee_id).toBeNull();

    // Al abrir se reparte.
    const open = await retryUnassignedCases(db(), { deadline: deadline(), now: new Date(MONDAY_9AM) });
    expect(open.assigned).toBe(1);
    expect(caseById(result.caseId).assignee_id).toBe(ANA);
  });

  it("dentro del horario se reparte al momento", async () => {
    const result = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: MONDAY_9AM }))!;
    expect(result.assignment).toMatchObject({ status: "assigned", assigneeId: ANA });
  });

  it("sin horario configurado (24 horas) se reparte también el domingo", async () => {
    setSettings({});
    const result = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: SUNDAY_10AM }))!;
    expect(result.assignment).toMatchObject({ status: "assigned" });
  });

  it("un feriado de la empresa cierra el día", async () => {
    fake.seed("holidays", [{ workspace_id: WS, team_id: null, date: "2026-10-19", name: "Feriado de prueba" }]);
    const result = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: MONDAY_9AM }))!;
    expect(result.assignment).toMatchObject({ status: "unassigned", reason: "off_hours" });
  });

  it("el horario del equipo manda sobre el de la empresa", async () => {
    // La empresa atiende de lunes a viernes; la Sede Sur solo los sábados.
    const [team] = fake.seed("teams", [
      { workspace_id: WS, name: "Sede Sur", is_default: true, business_hours: { sat: [["09:00", "13:00"]] } },
    ]);
    fake.seed("team_members", [
      { team_id: team.id, user_id: ANA, role: "agent" },
      { team_id: team.id, user_id: BETO, role: "agent" },
    ]);
    const monday = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: MONDAY_9AM }))!;
    expect(monday.assignment).toMatchObject({ status: "unassigned", reason: "off_hours" });
  });

  it("las proactivas que se activan fuera de horario esperan a la apertura", async () => {
    await setup("gym");
    setSettings({ business_hours: WEEKDAYS });
    const renovacion = fake.rows("case_types").find((t) => t.name === "Renovación")!;
    const [scheduled] = fake.seed("cases", [
      {
        workspace_id: WS,
        contact_id: contactId,
        case_type_id: renovacion.id,
        status: "scheduled",
        origin: "proactive",
        scheduled_for: "2026-10-18T14:00:00.000Z",
      },
    ]);

    const sunday = await activateScheduledCases(db(), { deadline: deadline(), now: new Date(SUNDAY_10AM) });
    expect(sunday).toMatchObject({ activated: 0, deferred: 1 });
    expect(caseById(scheduled.id as string)).toMatchObject({ status: "scheduled", scheduled_for: MONDAY_9AM });

    const monday = await activateScheduledCases(db(), { deadline: deadline(), now: new Date(MONDAY_9AM) });
    expect(monday.activated).toBe(1);
    expect(caseById(scheduled.id as string)).toMatchObject({ status: "open", assignee_id: ANA });
  });
});

// ── 3.2 Respuesta fuera de horario ────────────────────────────────────────

describe("respuesta fuera de horario", () => {
  const TEXT = "Hola {nombre}, abrimos {apertura}.";

  beforeEach(async () => {
    await setup();
    setSettings({
      business_hours: WEEKDAYS,
      off_hours_reply: { enabled: true, text: TEXT, min_hours_between: null },
    });
  });

  it("se envía una vez por gestión, con las variables y sellando la salida del bot", async () => {
    const m = messenger();
    const first = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: SUNDAY_10AM, messenger: m }))!;
    expect(first.offHoursReply).toEqual({ status: "sent", text: "Hola María, abrimos mañana 9:00." });
    expect(m.sendText).toHaveBeenCalledTimes(1);
    expect(m.sendText).toHaveBeenCalledWith({
      workspaceId: WS,
      lateConversationId: "conv-1",
      lateAccountId: "acc-1",
      text: "Hola María, abrimos mañana 9:00.",
    });
    expect(caseById(first.caseId)).toMatchObject({
      off_hours_reply_sent_at: SUNDAY_10AM,
      last_outbound_at: SUNDAY_10AM,
      waiting_since: SUNDAY_10AM,
      first_response_at: null,
    });
    expect(activity("off_hours_reply_sent", first.caseId)).toHaveLength(1);

    // Otro mensaje en la misma gestión: no se repite.
    const second = (await handleInbound(db(), {
      workspaceId: WS,
      contactId,
      conversationId,
      at: minutesAfter(SUNDAY_10AM, 600),
      messenger: m,
    }))!;
    expect(second.offHoursReply).toEqual({ status: "skipped", reason: "already_sent" });
    expect(m.sendText).toHaveBeenCalledTimes(1);
  });

  it("dentro del horario no responde", async () => {
    const m = messenger();
    const r = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: MONDAY_9AM, messenger: m }))!;
    expect(r.offHoursReply).toEqual({ status: "skipped", reason: "within_hours" });
    expect(m.sendText).not.toHaveBeenCalled();
  });

  it("desactivada o sin texto no responde", async () => {
    setSettings({ business_hours: WEEKDAYS, off_hours_reply: { enabled: false, text: TEXT, min_hours_between: null } });
    const m = messenger();
    const r = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: SUNDAY_10AM, messenger: m }))!;
    expect(r.offHoursReply).toEqual({ status: "skipped", reason: "disabled" });
    expect(m.sendText).not.toHaveBeenCalled();
  });

  it("con horas mínimas se repite pasado ese tiempo", async () => {
    setSettings({ business_hours: WEEKDAYS, off_hours_reply: { enabled: true, text: TEXT, min_hours_between: 2 } });
    const m = messenger();
    const at = (min: number) => minutesAfter(SUNDAY_10AM, min);
    const send = (when: string) => handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: when, messenger: m });

    expect((await send(at(0)))!.offHoursReply).toMatchObject({ status: "sent" });
    expect((await send(at(60)))!.offHoursReply).toEqual({ status: "skipped", reason: "already_sent" });
    expect((await send(at(180)))!.offHoursReply).toMatchObject({ status: "sent" });
    expect(m.sendText).toHaveBeenCalledTimes(2);
    expect(activity("off_hours_reply_sent")).toHaveLength(2);
  });

  it("si el envío falla, no sella y el siguiente mensaje lo intenta de nuevo", async () => {
    const failing = messenger({ sendText: vi.fn(async () => ({ ok: false as const, error: "Zernio rechazó el mensaje" })) });
    const first = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: SUNDAY_10AM, messenger: failing }))!;
    expect(first.offHoursReply).toEqual({ status: "failed", error: "Zernio rechazó el mensaje" });
    expect(caseById(first.caseId).off_hours_reply_sent_at).toBeNull();
    expect(caseById(first.caseId).last_outbound_at).toBeNull();
    expect(activity("off_hours_reply_sent")).toHaveLength(0);

    const ok = messenger();
    const second = (await handleInbound(db(), {
      workspaceId: WS,
      contactId,
      conversationId,
      at: minutesAfter(SUNDAY_10AM, 5),
      messenger: ok,
    }))!;
    expect(second.offHoursReply).toMatchObject({ status: "sent" });
  });

  it("una excepción del mensajero no corta el webhook", async () => {
    const boom = messenger({
      sendText: vi.fn(async () => {
        throw new Error("sin red");
      }),
    });
    const r = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: SUNDAY_10AM, messenger: boom }))!;
    expect(r.caseId).toBeTruthy();
  });

  it("funciones puras: variables y repetición", () => {
    const now = new Date(SUNDAY_10AM);
    const monday = new Date(MONDAY_9AM);
    expect(renderOffHoursReply("{nombre}: abrimos {apertura} en {empresa}", { contactName: "Ana Pérez", workspaceName: "Muscle", opening: monday, now })).toBe(
      "Ana Pérez: abrimos mañana 9:00 en Muscle",
    );
    expect(renderOffHoursReply("Abrimos {apertura}", { opening: null, now })).toBe("Abrimos pronto");
    expect(offHoursReplyDue(null, null, SUNDAY_10AM)).toBe(true);
    expect(offHoursReplyDue(SUNDAY_10AM, null, minutesAfter(SUNDAY_10AM, 5000))).toBe(false);
    expect(offHoursReplyDue(SUNDAY_10AM, 2, minutesAfter(SUNDAY_10AM, 119))).toBe(false);
    expect(offHoursReplyDue(SUNDAY_10AM, 2, minutesAfter(SUNDAY_10AM, 120))).toBe(true);
  });
});

// ── 3.3 Reasignación por espera ───────────────────────────────────────────

describe("reasignación por espera", () => {
  const FRIDAY_530PM = "2026-10-16T22:30:00.000Z"; // 17:30 Lima
  const MONDAY_905AM = "2026-10-19T14:05:00.000Z";

  async function waitingCase(): Promise<string> {
    fake.now = () => FRIDAY_530PM;
    const r = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: FRIDAY_530PM }))!;
    expect(caseById(r.caseId).assignee_id).toBe(ANA);
    return r.caseId;
  }

  beforeEach(async () => {
    await setup();
    setSettings({ business_hours: WEEKDAYS, reassign_after_minutes: 30 });
  });

  it("cuenta minutos hábiles: no reasigna de noche ni el fin de semana, sí a los 30 minutos hábiles", async () => {
    const caseId = await waitingCase();

    // 20 minutos hábiles (17:30 a 17:50).
    expect((await reassignWaitingCases(db(), { deadline: deadline(), now: new Date("2026-10-16T22:50:00.000Z") })).reassigned).toBe(0);
    // Sábado: muchísimos minutos de reloj, ninguno hábil, y cerrado.
    expect((await reassignWaitingCases(db(), { deadline: deadline(), now: new Date("2026-10-17T15:00:00.000Z") })).reassigned).toBe(0);
    expect(caseById(caseId).assignee_id).toBe(ANA);

    // Lunes 9:05: 30 min del viernes + 5 del lunes = 35.
    fake.now = () => MONDAY_905AM;
    const stats = await reassignWaitingCases(db(), { deadline: deadline(), now: new Date(MONDAY_905AM) });
    expect(stats).toMatchObject({ reassigned: 1, alerted: 0 });
    expect(caseById(caseId)).toMatchObject({ assignee_id: BETO, reassigned_count: 1 });
  });

  it("registra unassigned y assigned con motivo espera y avisa a la persona anterior y al supervisor", async () => {
    const caseId = await waitingCase();
    fake.now = () => MONDAY_905AM;
    await reassignWaitingCases(db(), { deadline: deadline(), now: new Date(MONDAY_905AM) });

    expect(activity("unassigned", caseId)).toMatchObject([{ from_value: ANA, to_value: null, meta: { reason: "espera" } }]);
    const assigned = activity("assigned", caseId).filter((a) => (a.meta as Row).reason === "espera");
    expect(assigned).toMatchObject([{ to_value: BETO }]);

    const reassigned = notifications("case_reassigned");
    expect(reassigned.map((n) => n.user_id).sort()).toEqual([ANA, OWNER].sort());
    // La persona nueva recibe su aviso de asignación.
    expect(notifications("case_assigned").some((n) => n.user_id === BETO)).toBe(true);
  });

  it("la persona nueva tiene su propio plazo", async () => {
    const caseId = await waitingCase();
    fake.now = () => MONDAY_905AM;
    await reassignWaitingCases(db(), { deadline: deadline(), now: new Date(MONDAY_905AM) });
    const again = await reassignWaitingCases(db(), {
      deadline: deadline(),
      now: new Date("2026-10-19T14:20:00.000Z"),
    });
    expect(again.reassigned).toBe(0);
    expect(caseById(caseId).assignee_id).toBe(BETO);
  });

  it("nunca vuelve a la persona anterior; sin nadie más avisa una sola vez al supervisor", async () => {
    const caseId = await waitingCase();
    fake.rows("workspace_members").find((m) => m.user_id === BETO)!.availability = "away";
    fake.now = () => MONDAY_905AM;

    const first = await reassignWaitingCases(db(), { deadline: deadline(), now: new Date(MONDAY_905AM) });
    expect(first).toMatchObject({ reassigned: 0, alerted: 1 });
    expect(caseById(caseId)).toMatchObject({ assignee_id: ANA, reassigned_count: 0 });
    expect(notifications("wait_exceeded").map((n) => n.user_id)).toEqual([OWNER]);

    const second = await reassignWaitingCases(db(), { deadline: deadline(), now: new Date("2026-10-19T14:30:00.000Z") });
    expect(second.alerted).toBe(0);
    expect(notifications("wait_exceeded")).toHaveLength(1);
  });

  it("sin reassign_after_minutes no hace nada", async () => {
    await waitingCase();
    setSettings({ business_hours: WEEKDAYS });
    const stats = await reassignWaitingCases(db(), { deadline: deadline(), now: new Date(MONDAY_905AM) });
    expect(stats).toMatchObject({ scanned: 0, reassigned: 0 });
  });

  it("si el cliente ya fue atendido (sin espera) no se reasigna", async () => {
    const caseId = await waitingCase();
    caseById(caseId).waiting_since = null;
    const stats = await reassignWaitingCases(db(), { deadline: deadline(), now: new Date(MONDAY_905AM) });
    expect(stats.reassigned).toBe(0);
  });
});

// ── 3.4 Plantilla automática en proactivas ────────────────────────────────

describe("plantilla automática de las proactivas", () => {
  const AUTO = { template_name: "renovacion", language: "es", params: ["{nombre}", "{fecha_clave}"] };
  const KEY_DATE_NOW = new Date("2026-10-18T15:00:00.000Z");
  const ACTIVATION = new Date("2026-11-23T14:30:00.000Z"); // lunes 9:30 Lima

  async function scheduledRenovacion(): Promise<string> {
    const renovacion = fake.rows("case_types").find((t) => t.name === "Renovación")!;
    renovacion.auto_template = AUTO;
    const contact = fake.rows("contacts")[0];
    contact.phone = "+51 987 654 321";
    contact.key_date = "2026-11-30";
    const result = await scheduleCasesForKeyDate(db(), WS, contactId, { now: KEY_DATE_NOW });
    expect(result.scheduled).toHaveLength(1);
    return result.scheduled[0].caseId;
  }

  beforeEach(async () => {
    await setup("gym");
  });

  it("al activarse envía la plantilla con sus variables, sella, registra y pasa a la segunda etapa", async () => {
    const caseId = await scheduledRenovacion();
    expect(stageName(caseById(caseId))).toBe("Por vencer");
    const m = messenger();

    const r = await activateScheduledCases(db(), { deadline: deadline(), now: ACTIVATION, messenger: m });
    expect(r).toMatchObject({ activated: 1, autoTemplates: { sent: 1, failed: 0 } });
    expect(m.sendTemplate).toHaveBeenCalledTimes(1);
    expect(m.sendTemplate).toHaveBeenCalledWith({
      workspaceId: WS,
      lateAccountId: "acc-1",
      phone: "51987654321",
      templateName: "renovacion",
      language: "es",
      params: ["María", "30/11/2026"],
    });
    expect(caseById(caseId)).toMatchObject({
      status: "open",
      auto_template_sent_at: ACTIVATION.toISOString(),
      last_outbound_at: ACTIVATION.toISOString(),
    });
    expect(stageName(caseById(caseId))).toBe("Contactado");
    expect(activity("auto_template_sent", caseId)).toMatchObject([
      { meta: { template_name: "renovacion", params: ["María", "30/11/2026"], message_id: "m-tpl" } },
    ]);
    expect(emitted("case_stage_changed").some((e) => e.caseId === caseId)).toBe(true);

    // Una segunda vuelta no la reenvía.
    await activateScheduledCases(db(), { deadline: deadline(), now: ACTIVATION, messenger: m });
    expect(m.sendTemplate).toHaveBeenCalledTimes(1);
    expect((await sendAutoTemplate(db(), { caseId, at: ACTIVATION.toISOString(), messenger: m })).status).toBe("skipped");
  });

  it("si falla, la gestión queda en la primera etapa y se avisa al responsable", async () => {
    const caseId = await scheduledRenovacion();
    const m = messenger({ sendTemplate: vi.fn(async () => ({ ok: false as const, error: "Plantilla no aprobada" })) });

    const r = await activateScheduledCases(db(), { deadline: deadline(), now: ACTIVATION, messenger: m });
    expect(r).toMatchObject({ activated: 1, autoTemplates: { sent: 0, failed: 1 } });
    const row = caseById(caseId);
    expect(row).toMatchObject({ status: "open", auto_template_sent_at: null });
    expect(stageName(row)).toBe("Por vencer");
    expect(activity("auto_template_failed", caseId)).toMatchObject([{ meta: { error: "Plantilla no aprobada" } }]);
    const failed = notifications("auto_template_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ user_id: row.assignee_id });
    expect(failed[0].body).toContain("Plantilla no aprobada");
    // La activación sigue avisando "para hoy".
    expect(notifications("case_activated")).toHaveLength(1);
  });

  it("si una variable queda vacía no envía y lo explica", async () => {
    const caseId = await scheduledRenovacion();
    fake.rows("case_types").find((t) => t.name === "Renovación")!.auto_template = {
      ...AUTO,
      params: ["{nombre}", "{campo:plan}"],
    };
    const m = messenger();
    await activateScheduledCases(db(), { deadline: deadline(), now: ACTIVATION, messenger: m });
    expect(m.sendTemplate).not.toHaveBeenCalled();
    expect(activity("auto_template_failed", caseId)).toHaveLength(1);
  });

  it("sin teléfono no envía y lo registra", async () => {
    const caseId = await scheduledRenovacion();
    fake.rows("contacts")[0].phone = null;
    const m = messenger();
    const r = await activateScheduledCases(db(), { deadline: deadline(), now: ACTIVATION, messenger: m });
    expect(r).toMatchObject({ activated: 1, autoTemplates: { sent: 0, failed: 0 } });
    expect(m.sendTemplate).not.toHaveBeenCalled();
    expect(activity("auto_template_skipped", caseId)).toMatchObject([{ meta: { reason: "no_phone" } }]);
    expect(stageName(caseById(caseId))).toBe("Por vencer");
  });

  it("R2: quien pidió la baja no recibe la plantilla automática", async () => {
    const caseId = await scheduledRenovacion();
    fake.rows("contacts")[0].is_subscribed = false;
    const m = messenger();
    const r = await activateScheduledCases(db(), { deadline: deadline(), now: ACTIVATION, messenger: m });
    expect(r).toMatchObject({ activated: 1, autoTemplates: { sent: 0, failed: 0 } });
    expect(m.sendTemplate).not.toHaveBeenCalled();
    expect(activity("auto_template_skipped", caseId)).toMatchObject([{ meta: { reason: "unsubscribed" } }]);
    expect(caseById(caseId).auto_template_sent_at ?? null).toBeNull();
  });

  it("un tipo sin plantilla no envía nada", async () => {
    await scheduledRenovacion();
    fake.rows("case_types").find((t) => t.name === "Renovación")!.auto_template = null;
    const m = messenger();
    await activateScheduledCases(db(), { deadline: deadline(), now: ACTIVATION, messenger: m });
    expect(m.sendTemplate).not.toHaveBeenCalled();
  });

  it("funciones puras: lectura y variables", () => {
    expect(parseAutoTemplate(null)).toBeNull();
    expect(parseAutoTemplate({ template_name: "", language: "es" })).toBeNull();
    expect(parseAutoTemplate({ template_name: " renovacion ", language: "es", params: ["{nombre}", 3] })).toEqual({
      template_name: "renovacion",
      language: "es",
      params: ["{nombre}"],
    });
    expect(
      buildAutoTemplateParams(AUTO, { contactName: "Ana Pérez", keyDate: "2026-11-30", workspaceName: "Gym" }),
    ).toEqual({ ok: true, params: ["Ana Pérez", "30/11/2026"] });
    expect(buildAutoTemplateParams(AUTO, { contactName: "Ana", keyDate: null })).toMatchObject({ ok: false });
    expect(
      buildAutoTemplateParams(
        { ...AUTO, params: ["{empresa}", "{campo:plan}"] },
        { workspaceName: "Gym", customFields: { plan: "Anual" } },
      ),
    ).toEqual({ ok: true, params: ["Gym", "Anual"] });
  });
});

// ── 3.6 client_no_reply y eventos para flujos ─────────────────────────────

describe("client_no_reply", () => {
  const OUT = "2026-10-19T15:00:00.000Z";
  let caseId: string;

  function setNoReplyTriggers(...minutes: number[]) {
    fake.seed("flows", [{ id: "flow-1", workspace_id: WS, name: "Seguimiento", status: "published" }]);
    fake.seed(
      "triggers",
      minutes.map((m) => ({ flow_id: "flow-1", type: "client_no_reply", config: { minutes: m }, is_active: true })),
    );
  }

  const detect = (now: string) => detectClientNoReply(db(), { deadline: deadline(), now: new Date(now) });

  beforeEach(async () => {
    await setup();
    const r = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: minutesAfter(OUT, -10) }))!;
    caseId = r.caseId;
    // El asesor respondió: sin espera del cliente y con un saliente sin respuesta.
    Object.assign(caseById(caseId), { waiting_since: null, last_outbound_at: OUT });
    flowEvents.mockClear();
  });

  it("emite un evento por umbral y por mensaje saliente, sin repetir", async () => {
    setNoReplyTriggers(30, 120);

    expect((await detect(minutesAfter(OUT, 20))).emitted).toBe(0);

    expect((await detect(minutesAfter(OUT, 40))).emitted).toBe(1);
    expect(caseById(caseId)).toMatchObject({ no_reply_event_outbound_at: OUT, no_reply_event_minutes: 30 });
    expect(emitted("client_no_reply")).toEqual([
      { type: "client_no_reply", workspaceId: WS, caseId, contactId, caseTypeId: caseById(caseId).case_type_id, stageId: caseById(caseId).stage_id },
    ]);

    // Otra vuelta con el mismo umbral: nada.
    expect((await detect(minutesAfter(OUT, 50))).emitted).toBe(0);

    // Llega el segundo umbral.
    expect((await detect(minutesAfter(OUT, 130))).emitted).toBe(1);
    expect(caseById(caseId).no_reply_event_minutes).toBe(120);
    expect((await detect(minutesAfter(OUT, 600))).emitted).toBe(0);
    expect(emitted("client_no_reply")).toHaveLength(2);
  });

  it("un mensaje saliente nuevo reinicia la cuenta", async () => {
    setNoReplyTriggers(30);
    await detect(minutesAfter(OUT, 40));
    expect(emitted("client_no_reply")).toHaveLength(1);

    const out2 = minutesAfter(OUT, 100);
    caseById(caseId).last_outbound_at = out2;
    expect((await detect(minutesAfter(out2, 10))).emitted).toBe(0);
    expect((await detect(minutesAfter(out2, 35))).emitted).toBe(1);
    expect(emitted("client_no_reply")).toHaveLength(2);
  });

  it("si el cliente escribió después del último mensaje saliente, no cuenta como sin responder", async () => {
    setNoReplyTriggers(30);
    caseById(caseId).waiting_since = minutesAfter(OUT, 5);
    caseById(caseId).last_inbound_at = minutesAfter(OUT, 5);
    expect((await detect(minutesAfter(OUT, 60))).emitted).toBe(0);
  });

  it("también avisa si el cliente espera respuesta humana (waiting_since) y el último mensaje es del bot", async () => {
    setNoReplyTriggers(30);
    // El cliente escribió y el bot contestó: waiting_since sigue puesto (solo lo limpia una persona).
    Object.assign(caseById(caseId), { waiting_since: minutesAfter(OUT, -10), last_inbound_at: minutesAfter(OUT, -10) });
    expect((await detect(minutesAfter(OUT, 20))).emitted).toBe(0);
    expect((await detect(minutesAfter(OUT, 40))).emitted).toBe(1);
    expect(caseById(caseId)).toMatchObject({ no_reply_event_outbound_at: OUT, no_reply_event_minutes: 30 });
    // No se repite para el mismo mensaje saliente.
    expect((await detect(minutesAfter(OUT, 600))).emitted).toBe(0);
    expect(emitted("client_no_reply")).toHaveLength(1);
    // Y waiting_since no se tocó.
    expect(caseById(caseId).waiting_since).toBe(minutesAfter(OUT, -10));
  });

  it("el aviso se emite aunque el bot esté en pausa (solo la espera del cliente y el mensaje saliente cuentan)", async () => {
    setNoReplyTriggers(30);
    fake.rows("conversations")[0].is_automation_paused = true;
    expect((await detect(minutesAfter(OUT, 40))).emitted).toBe(1);
  });

  it("sin disparadores activos y publicados no emite nada", async () => {
    expect((await detect(minutesAfter(OUT, 600))).emitted).toBe(0);
    setNoReplyTriggers(30);
    fake.rows("flows")[0].status = "draft";
    expect((await detect(minutesAfter(OUT, 600))).emitted).toBe(0);
    fake.rows("flows")[0].status = "published";
    fake.rows("triggers")[0].is_active = false;
    expect((await detect(minutesAfter(OUT, 600))).emitted).toBe(0);
  });

  it("usa 60 minutos si el disparador no indica minutes", async () => {
    fake.seed("flows", [{ id: "flow-1", workspace_id: WS, name: "Seguimiento", status: "published" }]);
    fake.seed("triggers", [{ flow_id: "flow-1", type: "client_no_reply", config: {}, is_active: true }]);
    expect((await detect(minutesAfter(OUT, 50))).emitted).toBe(0);
    expect((await detect(minutesAfter(OUT, 61))).emitted).toBe(1);
  });

  it("funciones puras: minutos y umbral pendiente", () => {
    expect(noReplyMinutes({ minutes: 45 })).toBe(45);
    expect(noReplyMinutes({ minutes: "90" })).toBe(90);
    expect(noReplyMinutes({ minutes: 0 })).toBe(60);
    expect(noReplyMinutes({ minutes: 1.5 })).toBe(60);
    expect(noReplyMinutes(null)).toBe(60);

    const base = { thresholds: [120, 30], lastOutboundAt: OUT, now: new Date(minutesAfter(OUT, 150)) };
    expect(nextNoReplyThreshold({ ...base, stampedOutboundAt: null, stampedMinutes: null })).toBe(30);
    expect(nextNoReplyThreshold({ ...base, stampedOutboundAt: OUT, stampedMinutes: 30 })).toBe(120);
    expect(nextNoReplyThreshold({ ...base, stampedOutboundAt: OUT, stampedMinutes: 120 })).toBeNull();
    // El sello de otro mensaje saliente no cuenta.
    expect(nextNoReplyThreshold({ ...base, stampedOutboundAt: minutesAfter(OUT, -500), stampedMinutes: 120 })).toBe(30);
  });
});

describe("eventos de gestión para los flujos", () => {
  beforeEach(async () => {
    await setup();
  });

  it("una gestión entrante nueva emite case_opened (clasificada según el tipo de contacto) y reutilizarla o reabrirla no", async () => {
    // Prospecto (tipo por defecto): se abre como Venta.
    const first = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId }))!;
    expect(first.opened).toBe(true);
    expect(emitted("case_opened")).toEqual([
      {
        type: "case_opened",
        workspaceId: WS,
        caseId: first.caseId,
        contactId,
        caseTypeId: caseById(first.caseId).case_type_id,
        stageId: caseById(first.caseId).stage_id,
        contactTypeId: fake.rows("contacts")[0].contact_type_id,
      },
    ]);
    expect(caseById(first.caseId).case_type_id).not.toBeNull();

    // Segundo mensaje con la gestión abierta: se reutiliza, no hay evento.
    flowEvents.mockClear();
    await handleInbound(db(), { workspaceId: WS, contactId, conversationId });
    expect(emitted("case_opened")).toHaveLength(0);

    // Cerrada hace menos de 24 h: se reabre (case_stage_changed), no es una gestión nueva.
    await closeCase(db(), { caseId: first.caseId, kind: "won", actorId: ANA });
    flowEvents.mockClear();
    const reopened = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId }))!;
    expect(reopened).toMatchObject({ reopened: true, opened: false });
    expect(emitted("case_opened")).toHaveLength(0);
  });

  it("case_opened de un cliente que vuelve: sin tipo de gestión sugerido queda sin clasificar y lleva su tipo de contacto", async () => {
    const customer = fake.rows("contact_types").find((t) => t.name === "Cliente")!;
    fake.rows("contacts")[0].contact_type_id = customer.id;
    const r = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId }))!;
    expect(r.opened).toBe(true);
    expect(caseById(r.caseId).case_type_id).toBeNull();
    expect(emitted("case_opened")).toEqual([
      { type: "case_opened", workspaceId: WS, caseId: r.caseId, contactId, caseTypeId: null, stageId: null, contactTypeId: customer.id },
    ]);
  });

  it("cambiar de etapa emite case_stage_changed con la etapa nueva", async () => {
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId }))!;
    const row = caseById(caseId);
    const next = fake.rows("case_stages").find(
      (s) => s.case_type_id === row.case_type_id && s.kind === "open" && s.id !== row.stage_id,
    )!;
    flowEvents.mockClear();
    expect(await changeStage(db(), { caseId, stageId: next.id as string, actorId: ANA })).toMatchObject({ ok: true });
    expect(emitted()).toEqual([
      {
        type: "case_stage_changed",
        workspaceId: WS,
        caseId,
        contactId,
        caseTypeId: row.case_type_id,
        stageId: next.id,
      },
    ]);
    // La misma etapa no emite.
    flowEvents.mockClear();
    await changeStage(db(), { caseId, stageId: next.id as string, actorId: ANA });
    expect(emitted()).toHaveLength(0);
  });

  it("cerrar emite case_stage_changed y case_closed con el resultado", async () => {
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId }))!;
    flowEvents.mockClear();
    expect(await closeCase(db(), { caseId, kind: "won", actorId: ANA })).toMatchObject({ ok: true });
    const closed = emitted("case_closed");
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ workspaceId: WS, caseId, contactId, outcome: "won" });
    expect(closed[0].stageId).toBe(caseById(caseId).stage_id);
    expect(emitted("case_stage_changed")).toHaveLength(1);
  });

  it("un error de los flujos no frena la acción del usuario", async () => {
    const { caseId } = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId }))!;
    flowEvents.mockRejectedValue(new Error("flujo roto"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await closeCase(db(), { caseId, kind: "won", actorId: ANA })).toMatchObject({ ok: true });
      await new Promise((r) => setTimeout(r, 0));
      expect(caseById(caseId).status).toBe("won");
    } finally {
      quiet.mockRestore();
    }
  });
});

// ── 3.7 Fecha clave ───────────────────────────────────────────────────────

describe("scheduleCasesForKeyDate", () => {
  const NOW = new Date("2026-10-18T15:00:00.000Z");

  beforeEach(async () => {
    await setup("gym");
  });

  const renovacionId = () => fake.rows("case_types").find((t) => t.name === "Renovación")!.id as string;

  it("programa la Renovación 7 días antes de la fecha clave (09:00 de Lima)", async () => {
    fake.rows("contacts")[0].key_date = "2026-11-30";
    const r = await scheduleCasesForKeyDate(db(), WS, contactId, { now: NOW });
    expect(r.skipped).toEqual([]);
    expect(r.scheduled).toMatchObject([
      { caseTypeId: renovacionId(), scheduledFor: "2026-11-23T14:00:00.000Z", rescheduled: false },
    ]);
    expect(fake.rows("cases")).toMatchObject([
      { status: "scheduled", origin: "proactive", case_type_id: renovacionId(), scheduled_for: "2026-11-23T14:00:00.000Z" },
    ]);
  });

  it("al repetirse mueve la misma gestión programada, sin duplicarla", async () => {
    fake.rows("contacts")[0].key_date = "2026-11-30";
    await scheduleCasesForKeyDate(db(), WS, contactId, { now: NOW });
    fake.rows("contacts")[0].key_date = "2026-12-15";
    const r = await scheduleCasesForKeyDate(db(), WS, contactId, { now: NOW });
    expect(r.scheduled).toMatchObject([{ rescheduled: true, scheduledFor: "2026-12-08T14:00:00.000Z" }]);
    expect(fake.rows("cases")).toHaveLength(1);
  });

  it("sin fecha clave o con la fecha ya pasada no programa nada", async () => {
    expect(await scheduleCasesForKeyDate(db(), WS, contactId, { now: NOW })).toEqual({
      scheduled: [],
      skipped: [{ caseTypeId: null, reason: "no_key_date" }],
    });
    fake.rows("contacts")[0].key_date = "2026-09-01";
    expect(await scheduleCasesForKeyDate(db(), WS, contactId, { now: NOW })).toEqual({
      scheduled: [],
      skipped: [{ caseTypeId: null, reason: "key_date_passed" }],
    });
    expect(fake.rows("cases")).toHaveLength(0);
  });

  it("dentro de la ventana de aviso se activa en la siguiente vuelta del cron", async () => {
    fake.rows("contacts")[0].key_date = "2026-10-22";
    const r = await scheduleCasesForKeyDate(db(), WS, contactId, { now: NOW });
    expect(r.scheduled).toMatchObject([{ scheduledFor: NOW.toISOString() }]);
  });

  it("si ya hay una gestión abierta de ese tipo no la duplica", async () => {
    fake.rows("contacts")[0].key_date = "2026-11-30";
    fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, case_type_id: renovacionId(), status: "open" }]);
    const r = await scheduleCasesForKeyDate(db(), WS, contactId, { now: NOW });
    expect(r.scheduled).toEqual([]);
    expect(r.skipped).toEqual([{ caseTypeId: renovacionId(), reason: "open_case_exists" }]);
    expect(fake.rows("cases")).toHaveLength(1);
  });

  it("un contacto de otro espacio no se toca", async () => {
    fake.rows("contacts")[0].key_date = "2026-11-30";
    const r = await scheduleCasesForKeyDate(db(), "ws-otro", contactId, { now: NOW });
    expect(r.scheduled).toEqual([]);
    expect(fake.rows("cases")).toHaveLength(0);
  });
});

describe("R2-12: sin avisos de madrugada si todos están ausentes", () => {
  beforeEach(async () => {
    await setup();
    setSettings({ business_hours: WEEKDAYS });
  });

  it("fuera de horario y sin nadie disponible no avisa «sin asignar»", async () => {
    for (const m of fake.rows("workspace_members")) m.availability = "away";
    const result = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: SUNDAY_10AM }))!;
    expect(result.assignment).toMatchObject({ status: "unassigned", reason: "off_hours" });
    expect(notifications("case_unassigned")).toHaveLength(0);
  });
});
