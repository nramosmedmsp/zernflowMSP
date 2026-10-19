// Fase 3 (docs/FASE-3-TECNICO.md 1 y 2): actividad human_reply en cada
// respuesta humana que cierra una espera y alertas por objetivo de tiempo del
// cron. Sobre la base en memoria (fake-db).
//
// Calendario (hora de Lima = UTC-5): el 16/10/2026 es viernes y el 19 lunes.

import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.test-helper";
import {
  handleHumanOutboundForConversation,
  handleInbound,
  notifySlaBreaches,
  runCaseTasks,
  stampBotOutbound,
} from "./index";

type Row = Record<string, unknown>;

const WS = "ws-1";
const OWNER = "u-0-owner";
const ANA = "u-1-ana";
const SUP = "u-2-sup";
const TEAM = "team-1";

const WEEKDAYS = {
  mon: [["09:00", "18:00"]],
  tue: [["09:00", "18:00"]],
  wed: [["09:00", "18:00"]],
  thu: [["09:00", "18:00"]],
  fri: [["09:00", "18:00"]],
};

const FRIDAY_530PM = "2026-10-16T22:30:00.000Z";
const MONDAY_905AM = "2026-10-19T14:05:00.000Z";

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
function minutesAfter(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function setup(settings: Row = {}) {
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: SUP, role: "member" },
  ]);
  fake.seed("channels", [{ id: "ch", workspace_id: WS, platform: "whatsapp", late_account_id: "acc-1" }]);
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María" }]);
  const [conversation] = fake.seed("conversations", [
    { workspace_id: WS, contact_id: contact.id, channel_id: "ch", late_conversation_id: "conv-1" },
  ]);
  contactId = contact.id as string;
  conversationId = conversation.id as string;
}

// ── human_reply ────────────────────────────────────────────────────────────

describe("human_reply", () => {
  beforeEach(() => setup());

  async function openWaiting(at: string): Promise<string> {
    const r = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at }))!;
    return r.caseId;
  }
  const reply = (at: string) => handleHumanOutboundForConversation(db(), { conversationId, userId: ANA, at });

  it("la primera respuesta registra first_response y human_reply con los mismos segundos", async () => {
    const caseId = await openWaiting("2026-10-18T15:00:00.000Z");
    await reply("2026-10-18T15:05:00.000Z");

    expect(activity("first_response", caseId)[0].meta).toMatchObject({ seconds: 300 });
    const replies = activity("human_reply", caseId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      actor_id: ANA,
      meta: { seconds: 300, business_seconds: 300, waiting_since: "2026-10-18T15:00:00.000Z" },
    });
  });

  it("cada respuesta que cierra una espera registra human_reply; sin espera no registra", async () => {
    const caseId = await openWaiting("2026-10-18T15:00:00.000Z");
    await reply("2026-10-18T15:05:00.000Z");
    // Segunda respuesta sin que el cliente haya escrito: no hay espera que cerrar.
    await reply("2026-10-18T15:06:00.000Z");
    expect(activity("human_reply", caseId)).toHaveLength(1);

    // El cliente vuelve a escribir y la persona responde: segunda espera.
    await handleInbound(db(), { workspaceId: WS, contactId, at: "2026-10-18T15:10:00.000Z" });
    await reply("2026-10-18T15:12:00.000Z");
    const replies = activity("human_reply", caseId);
    expect(replies).toHaveLength(2);
    expect(replies[1].meta).toMatchObject({ seconds: 120, waiting_since: "2026-10-18T15:10:00.000Z" });
    // first_response solo la primera vez.
    expect(activity("first_response", caseId)).toHaveLength(1);
  });

  it("el bot no cuenta", async () => {
    const caseId = await openWaiting("2026-10-18T15:00:00.000Z");
    await stampBotOutbound(db(), { contactId, at: "2026-10-18T15:01:00.000Z" });
    expect(activity("human_reply", caseId)).toHaveLength(0);
    expect(caseById(caseId).waiting_since).toBe("2026-10-18T15:00:00.000Z");
  });

  it("business_seconds usa el horario de la empresa y es menor que los segundos de reloj", async () => {
    setup({ business_hours: WEEKDAYS });
    // Viernes 17:30 (Lima); responde el lunes 9:05: 30 min del viernes + 5 del lunes.
    const caseId = await openWaiting(FRIDAY_530PM);
    await reply(MONDAY_905AM);
    const meta = activity("human_reply", caseId)[0].meta as Row;
    expect(meta.business_seconds).toBe(35 * 60);
    expect(meta.seconds).toBe((new Date(MONDAY_905AM).getTime() - new Date(FRIDAY_530PM).getTime()) / 1000);
  });

  it("business_seconds usa el horario del equipo cuando lo tiene", async () => {
    setup({ business_hours: WEEKDAYS });
    // El equipo atiende todo el día (sin tramos de la empresa): lunes 24 h.
    fake.seed("teams", [
      { id: TEAM, workspace_id: WS, name: "Ventas", business_hours: { fri: [["00:00", "23:59"]], mon: [["00:00", "23:59"]] } },
    ]);
    const caseId = await openWaiting("2026-10-19T14:00:00.000Z");
    caseById(caseId).team_id = TEAM;
    await reply("2026-10-19T14:30:00.000Z");
    expect(activity("human_reply", caseId)[0].meta).toMatchObject({ seconds: 1800, business_seconds: 1800 });
  });
});

// ── Alertas por objetivo ───────────────────────────────────────────────────

describe("alertas por objetivo de tiempo", () => {
  let typeId: string;

  function seedType(over: Row = {}) {
    const [t] = fake.seed("case_types", [
      { workspace_id: WS, name: "Consulta", sla_first_response_minutes: 30, sla_resolution_hours: null, ...over },
    ]);
    typeId = t.id as string;
  }

  function seedCase(over: Row = {}): string {
    const [c] = fake.seed("cases", [
      { workspace_id: WS, contact_id: contactId, case_type_id: typeId, status: "open", assignee_id: ANA, ...over },
    ]);
    return c.id as string;
  }

  const run = (now: string) => notifySlaBreaches(db(), { deadline: deadline(), now: new Date(now) });

  describe("primera respuesta", () => {
    beforeEach(() => {
      setup();
      seedType();
    });

    it("no avisa antes del objetivo", async () => {
      const caseId = seedCase({ waiting_since: "2026-10-18T15:00:00.000Z", opened_at: "2026-10-18T15:00:00.000Z" });
      expect((await run(minutesAfter("2026-10-18T15:00:00.000Z", 29))).alerted).toBe(0);
      expect(caseById(caseId).sla_first_response_breached_at).toBeNull();
      expect(notifications("sla_breached")).toHaveLength(0);
    });

    it("al superarlo sella, registra la actividad y avisa al responsable y a los administradores", async () => {
      const caseId = seedCase({ waiting_since: "2026-10-18T15:00:00.000Z", opened_at: "2026-10-18T15:00:00.000Z" });
      const now = minutesAfter("2026-10-18T15:00:00.000Z", 31);
      expect((await run(now)).alerted).toBe(1);

      expect(caseById(caseId).sla_first_response_breached_at).toBe(now);
      expect(caseById(caseId).sla_resolution_breached_at).toBeNull();
      expect(activity("sla_breached", caseId)).toMatchObject([{ meta: { kind: "first_response" } }]);
      const sent = notifications("sla_breached");
      expect(sent.map((n) => n.user_id).sort()).toEqual([ANA, OWNER].sort());
      expect(sent[0]).toMatchObject({ title: "Gestión fuera de tiempo" });
      expect(String(sent[0].body)).toContain("María");
      expect(String(sent[0].body)).toContain("Consulta");
      expect(String(sent[0].link)).toContain(caseId);
    });

    it("una sola vez por gestión", async () => {
      seedCase({ waiting_since: "2026-10-18T15:00:00.000Z" });
      await run(minutesAfter("2026-10-18T15:00:00.000Z", 40));
      const again = await run(minutesAfter("2026-10-18T15:00:00.000Z", 90));
      expect(again.alerted).toBe(0);
      expect(notifications("sla_breached")).toHaveLength(2); // responsable + administrador, una vez
      expect(activity("sla_breached")).toHaveLength(1);
    });

    it("ignora las ya respondidas, las sin espera, las cerradas y los tipos sin objetivo", async () => {
      seedCase({ waiting_since: "2026-10-18T15:00:00.000Z", first_response_at: "2026-10-18T15:10:00.000Z" });
      seedCase({ waiting_since: null });
      seedCase({ waiting_since: "2026-10-18T15:00:00.000Z", status: "won" });
      const [free] = fake.seed("case_types", [{ workspace_id: WS, name: "Sin objetivo" }]);
      seedCase({ waiting_since: "2026-10-18T15:00:00.000Z", case_type_id: free.id });
      expect((await run("2026-10-19T15:00:00.000Z")).alerted).toBe(0);
    });

    it("cuenta minutos hábiles: de noche no avisa, el lunes sí", async () => {
      setup({ business_hours: WEEKDAYS });
      seedType();
      const caseId = seedCase({ waiting_since: FRIDAY_530PM, opened_at: FRIDAY_530PM });
      // Sábado: muchos minutos de reloj, solo 30 hábiles (exactamente el objetivo, no lo supera).
      expect((await run("2026-10-17T15:00:00.000Z")).alerted).toBe(0);
      // Lunes 9:05: 35 minutos hábiles.
      expect((await run(MONDAY_905AM)).alerted).toBe(1);
      expect(caseById(caseId).sla_first_response_breached_at).toBe(MONDAY_905AM);
    });

    it("con equipo avisa al supervisor del equipo y al responsable, no a los administradores", async () => {
      fake.seed("teams", [{ id: TEAM, workspace_id: WS, name: "Ventas" }]);
      fake.seed("team_members", [
        { team_id: TEAM, user_id: SUP, role: "supervisor" },
        { team_id: TEAM, user_id: ANA, role: "agent" },
      ]);
      seedCase({ waiting_since: "2026-10-18T15:00:00.000Z", team_id: TEAM });
      await run(minutesAfter("2026-10-18T15:00:00.000Z", 45));
      expect(
        notifications("sla_breached")
          .map((n) => n.user_id)
          .sort(),
      ).toEqual([ANA, SUP].sort());
    });

    it("sin responsable ni equipo avisa a los administradores", async () => {
      seedCase({ waiting_since: "2026-10-18T15:00:00.000Z", assignee_id: null });
      await run(minutesAfter("2026-10-18T15:00:00.000Z", 45));
      expect(notifications("sla_breached").map((n) => n.user_id)).toEqual([OWNER]);
    });
  });

  describe("resolución", () => {
    beforeEach(() => {
      setup();
      seedType({ sla_first_response_minutes: null, sla_resolution_hours: 24 });
    });

    it("avisa al pasar las horas desde la apertura y no antes", async () => {
      const opened = "2026-10-18T15:00:00.000Z";
      const caseId = seedCase({ opened_at: opened });
      expect((await run(minutesAfter(opened, 24 * 60 - 1))).alerted).toBe(0);
      const now = minutesAfter(opened, 24 * 60 + 1);
      expect((await run(now)).alerted).toBe(1);
      expect(caseById(caseId).sla_resolution_breached_at).toBe(now);
      expect(caseById(caseId).sla_first_response_breached_at).toBeNull();
      expect(activity("sla_breached", caseId)).toMatchObject([{ meta: { kind: "resolution" } }]);
      expect(notifications("sla_breached")).toHaveLength(2);
      // Una sola vez.
      expect((await run(minutesAfter(opened, 72 * 60))).alerted).toBe(0);
    });

    it("no avisa en gestiones cerradas", async () => {
      seedCase({ opened_at: "2026-10-18T15:00:00.000Z", status: "resolved" });
      expect((await run("2026-10-25T15:00:00.000Z")).alerted).toBe(0);
    });
  });

  it("primera respuesta y resolución se alertan por separado y runCaseTasks las ejecuta", async () => {
    setup();
    seedType({ sla_first_response_minutes: 30, sla_resolution_hours: 1 });
    const caseId = seedCase({ waiting_since: "2026-10-18T15:00:00.000Z", opened_at: "2026-10-18T15:00:00.000Z" });
    const stats = await runCaseTasks(db(), { deadline: deadline(), now: new Date("2026-10-18T17:00:00.000Z") });
    expect(stats.slaAlerts).toBe(2);
    expect(activity("sla_breached", caseId).map((a) => (a.meta as Row).kind).sort()).toEqual(["first_response", "resolution"]);
  });
});
