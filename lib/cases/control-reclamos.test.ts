// Control de reclamos (Postventa protegida): bloqueo del tipo, plazo de la
// solución, pedido de cierre con aprobación, detector de reclamos y ventana de
// reapertura. Sobre la base en memoria (fake-db).

import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.test-helper";
import {
  alertUnhandledComplaints,
  approveCloseRequest,
  classifyCase,
  closeOrRequestClose,
  dismissComplaint,
  flagComplaint,
  handleInbound,
  notifyCommitmentsOverdue,
  notifySolutionDeadlines,
  openComplaintCase,
  registerSolutionInProgress,
  rejectCloseRequest,
  runCaseTasks,
  setNextAction,
} from "./index";

type Row = Record<string, unknown>;

const WS = "ws-1";
const OWNER = "u-0-owner";
const ANA = "u-1-ana"; // asesora del equipo
const SUP = "u-2-sup"; // supervisor del equipo
const SUP2 = "u-3-sup2"; // otro supervisor del equipo
const OUT = "u-4-out"; // supervisor de OTRO equipo
const TEAM = "team-1";
const OTHER_TEAM = "team-2";

const NOW = new Date("2026-10-20T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);
const deadline = () => Date.now() + 5000;

let fake: FakeDb;
let contactId: string;
let conversationId: string;
let postventa: Row;
let venta: Row;

const db = () => fake.asDb();
const row = (table: string, id: unknown): Row => fake.rows(table).find((r) => r.id === id)!;
const activity = (type: string, caseId?: string) =>
  fake.rows("activity").filter((a) => a.type === type && (!caseId || a.case_id === caseId));
const notes = (type: string) => fake.rows("notifications").filter((n) => n.type === type);
const usersOf = (type: string) => notes(type).map((n) => n.user_id as string).sort();

function stage(typeId: unknown, name: string, kind: string, position: number): Row {
  return fake.seed("case_stages", [{ case_type_id: typeId, name, kind, position }])[0];
}

function setup() {
  fake = new FakeDb();
  fake.users.set(ANA, { id: ANA, email: "ana@tienda.pe", user_metadata: { full_name: "Ana" } });
  fake.users.set(SUP, { id: SUP, email: "luis@tienda.pe", user_metadata: { full_name: "Luis" } });
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: SUP, role: "member" },
    { workspace_id: WS, user_id: SUP2, role: "member" },
    { workspace_id: WS, user_id: OUT, role: "member" },
  ]);
  fake.seed("teams", [
    { id: TEAM, workspace_id: WS, name: "Postventa" },
    { id: OTHER_TEAM, workspace_id: WS, name: "Ventas" },
  ]);
  fake.seed("team_members", [
    { team_id: TEAM, user_id: ANA, role: "agent" },
    { team_id: TEAM, user_id: SUP, role: "supervisor" },
    { team_id: TEAM, user_id: SUP2, role: "supervisor" },
    { team_id: OTHER_TEAM, user_id: OUT, role: "supervisor" },
  ]);
  [postventa] = fake.seed("case_types", [
    {
      workspace_id: WS,
      name: "Postventa",
      position: 1,
      protected: true,
      solution_deadline_hours: 24,
      reopen_window_days: 7,
      require_outcome_reason: true,
      routing: "fixed_team",
      fixed_team_id: TEAM,
    },
  ]);
  [venta] = fake.seed("case_types", [{ workspace_id: WS, name: "Venta", position: 2 }]);
  stage(postventa.id, "Nueva", "open", 0);
  stage(postventa.id, "En gestión", "open", 1);
  stage(postventa.id, "Resuelta", "resolved", 2);
  stage(postventa.id, "Sin solución", "lost", 3);
  stage(venta.id, "Nuevo", "open", 0);
  stage(venta.id, "Pagado", "won", 1);
  stage(venta.id, "No compró", "lost", 2);
  fake.seed("case_outcome_reasons", [
    { case_type_id: postventa.id, name: "Cliente no responde", kind: "lost" },
    { case_type_id: postventa.id, name: "Reembolso", kind: "resolved" },
  ]);
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María" }]);
  const [conv] = fake.seed("conversations", [{ workspace_id: WS, contact_id: contact.id, channel_id: "ch" }]);
  contactId = contact.id as string;
  conversationId = conv.id as string;
}

function stageId(typeId: unknown, name: string): string {
  return fake.rows("case_stages").find((s) => s.case_type_id === typeId && s.name === name)!.id as string;
}
function reasonId(name: string): string {
  return fake.rows("case_outcome_reasons").find((r) => r.name === name)!.id as string;
}

/** Postventa abierta del contacto, asignada a Ana. */
function openPostventa(extra: Row = {}): Row {
  return fake.seed("cases", [
    {
      workspace_id: WS,
      contact_id: contactId,
      case_type_id: postventa.id,
      stage_id: stageId(postventa.id, "Nueva"),
      team_id: TEAM,
      assignee_id: ANA,
      status: "open",
      opened_at: hoursAgo(2),
      ...extra,
    },
  ])[0];
}

beforeEach(setup);

// ── Bloqueo del tipo ───────────────────────────────────────────────────────

describe("bloqueo del tipo de una gestión protegida", () => {
  it("el asesor no puede cambiarlo, aunque pueda editar la gestión", async () => {
    const c = openPostventa();
    const r = await classifyCase(db(), { caseId: c.id as string, caseTypeId: venta.id as string, actorId: ANA });
    expect(r).toEqual({ error: "Solo el supervisor puede cambiar el tipo de una Postventa." });
    expect(row("cases", c.id).case_type_id).toBe(postventa.id);
    expect(notes("protected_type_changed")).toHaveLength(0);
  });

  it("el supervisor del equipo sí, y los demás supervisores se enteran (no él)", async () => {
    const c = openPostventa();
    const r = await classifyCase(db(), { caseId: c.id as string, caseTypeId: venta.id as string, actorId: SUP });
    expect(r).toMatchObject({ ok: true });
    expect(row("cases", c.id).case_type_id).toBe(venta.id);
    expect(usersOf("protected_type_changed")).toEqual([SUP2]);
    expect(notes("protected_type_changed")[0]).toMatchObject({
      title: "Luis cambió el tipo de una Postventa: María",
      body: "Postventa → Venta",
    });
  });

  it("un supervisor de otro equipo no puede; el dueño sí", async () => {
    const c = openPostventa();
    expect(await classifyCase(db(), { caseId: c.id as string, caseTypeId: venta.id as string, actorId: OUT })).toHaveProperty("error");
    expect(await classifyCase(db(), { caseId: c.id as string, caseTypeId: venta.id as string, actorId: OWNER })).toMatchObject({ ok: true });
    expect(usersOf("protected_type_changed")).toEqual([SUP, SUP2]);
  });

  it("los flujos (sin persona) no tienen el límite", async () => {
    const c = openPostventa();
    expect(await classifyCase(db(), { caseId: c.id as string, caseTypeId: venta.id as string, actorId: null })).toMatchObject({ ok: true });
  });

  it("clasificar una gestión sin tipo como Postventa lo puede hacer el asesor", async () => {
    const [c] = fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, assignee_id: ANA, status: "open", opened_at: hoursAgo(1) }]);
    expect(await classifyCase(db(), { caseId: c.id as string, caseTypeId: postventa.id as string, actorId: ANA })).toMatchObject({ ok: true });
  });

  it("un tipo que no es protegido se cambia como siempre", async () => {
    const [c] = fake.seed("cases", [
      { workspace_id: WS, contact_id: contactId, case_type_id: venta.id, stage_id: stageId(venta.id, "Nuevo"), assignee_id: ANA, status: "open", opened_at: hoursAgo(1) },
    ]);
    expect(await classifyCase(db(), { caseId: c.id as string, caseTypeId: postventa.id as string, actorId: ANA })).toMatchObject({ ok: true });
    expect(notes("protected_type_changed")).toHaveLength(0);
  });
});

// ── Cierre con aprobación ──────────────────────────────────────────────────

describe("cierre de una gestión protegida", () => {
  const lost = () => ({ stageId: null as string | null, kind: "lost" as const, outcomeReasonId: reasonId("Cliente no responde") });

  it("resuelta o ganada exige la nota; con nota cierra y avisa a los supervisores (no a quien cerró)", async () => {
    const c = openPostventa();
    const base = { caseId: c.id as string, kind: "resolved" as const, outcomeReasonId: reasonId("Reembolso"), actorId: ANA };
    expect(await closeOrRequestClose(db(), base, { actorIsSupervisor: false })).toEqual({
      error: "Cuenta qué se hizo antes de cerrar la Postventa.",
    });
    expect(row("cases", c.id).status).toBe("open");

    const ok = await closeOrRequestClose(db(), { ...base, note: "Se reenvió el pedido" }, { actorIsSupervisor: false });
    expect(ok).toMatchObject({ ok: true, requested: false, status: "resolved" });
    expect(row("cases", c.id)).toMatchObject({ status: "resolved", closed_by: ANA });
    expect(usersOf("protected_closed")).toEqual([SUP, SUP2]);
    expect(notes("protected_closed")[0].title).toBe("Postventa cerrada como «Resuelta»: María");
  });

  it("un asesor que cierra «sin solución» deja un pedido: la gestión sigue abierta", async () => {
    const c = openPostventa();
    const r = await closeOrRequestClose(
      db(),
      { caseId: c.id as string, ...lost(), note: "No contesta hace días", actorId: ANA },
      { actorIsSupervisor: false },
    );
    expect(r).toEqual({ ok: true, requested: true });
    const saved = row("cases", c.id);
    expect(saved.status).toBe("open");
    expect(saved.close_request).toMatchObject({
      stage_id: stageId(postventa.id, "Sin solución"),
      reason_id: reasonId("Cliente no responde"),
      note: "No contesta hace días",
      requested_by: ANA,
    });
    expect(activity("close_requested", c.id as string)).toHaveLength(1);
    expect(usersOf("close_requested")).toEqual([SUP, SUP2]);
    expect(notes("close_requested")[0]).toMatchObject({
      title: "Ana pide cerrar como «Sin solución» la Postventa de María",
      body: "Cliente no responde · No contesta hace días",
    });
  });

  it("mientras haya un pedido el asesor no puede pedir otro", async () => {
    const c = openPostventa();
    const input = { caseId: c.id as string, ...lost(), actorId: ANA };
    await closeOrRequestClose(db(), input, { actorIsSupervisor: false });
    const again = await closeOrRequestClose(db(), input, { actorIsSupervisor: false });
    expect(again).toHaveProperty("error");
    expect(activity("close_requested")).toHaveLength(1);
  });

  it("el pedido se valida: sin motivo no se guarda", async () => {
    const c = openPostventa();
    const r = await closeOrRequestClose(db(), { caseId: c.id as string, kind: "lost", actorId: ANA }, { actorIsSupervisor: false });
    expect(r).toHaveProperty("error");
    expect(row("cases", c.id).close_request).toBeNull();
  });

  it("el supervisor cierra «sin solución» directo", async () => {
    const c = openPostventa();
    const r = await closeOrRequestClose(db(), { caseId: c.id as string, ...lost(), actorId: SUP }, { actorIsSupervisor: true });
    expect(r).toMatchObject({ ok: true, requested: false, status: "lost" });
    expect(row("cases", c.id)).toMatchObject({ status: "lost", closed_by: SUP, close_request: null });
    expect(activity("close_requested")).toHaveLength(0);
  });

  it("aprobar cierra con lo que pidió el asesor, a nombre del supervisor, y avisa a quien lo pidió", async () => {
    const c = openPostventa();
    await closeOrRequestClose(db(), { caseId: c.id as string, ...lost(), note: "Sin respuesta", actorId: ANA }, { actorIsSupervisor: false });
    const r = await approveCloseRequest(db(), { caseId: c.id as string, actorId: SUP });
    expect(r).toMatchObject({ ok: true, status: "lost" });
    expect(row("cases", c.id)).toMatchObject({
      status: "lost",
      closed_by: SUP,
      outcome_note: "Sin respuesta",
      outcome_reason_id: reasonId("Cliente no responde"),
      stage_id: stageId(postventa.id, "Sin solución"),
      close_request: null,
    });
    expect(activity("case_closed", c.id as string)[0].meta).toMatchObject({
      approved_by: SUP,
      close_request: { requested_by: ANA },
    });
    expect(activity("close_request_approved", c.id as string)).toHaveLength(1);
    expect(usersOf("close_request_approved")).toEqual([ANA]);
    // El otro supervisor se entera del cierre; quien aprobó no.
    expect(usersOf("protected_closed")).toEqual([SUP2]);
  });

  it("rechazar limpia el pedido, deja la gestión abierta y avisa con el comentario", async () => {
    const c = openPostventa();
    await closeOrRequestClose(db(), { caseId: c.id as string, ...lost(), actorId: ANA }, { actorIsSupervisor: false });
    const r = await rejectCloseRequest(db(), { caseId: c.id as string, actorId: SUP, comment: "Llámalo primero" });
    expect(r).toMatchObject({ ok: true });
    expect(row("cases", c.id)).toMatchObject({ status: "open", close_request: null });
    expect(activity("close_request_rejected", c.id as string)[0]).toMatchObject({ actor_id: SUP, meta: { comment: "Llámalo primero" } });
    expect(usersOf("close_request_rejected")).toEqual([ANA, SUP2]);
    expect(notes("close_request_rejected").find((n) => n.user_id === ANA)).toMatchObject({
      title: "Luis rechazó cerrar la Postventa de María",
      body: "Llámalo primero",
    });
    // Tras el rechazo puede pedir de nuevo.
    expect(
      await closeOrRequestClose(db(), { caseId: c.id as string, ...lost(), actorId: ANA }, { actorIsSupervisor: false }),
    ).toEqual({ ok: true, requested: true });
  });

  it("sin pedido pendiente no hay nada que aprobar ni rechazar", async () => {
    const c = openPostventa();
    expect(await approveCloseRequest(db(), { caseId: c.id as string, actorId: SUP })).toHaveProperty("error");
    expect(await rejectCloseRequest(db(), { caseId: c.id as string, actorId: SUP })).toHaveProperty("error");
  });

  it("un tipo que no es protegido se cierra como siempre, sin nota ni aprobación", async () => {
    const [c] = fake.seed("cases", [
      { workspace_id: WS, contact_id: contactId, case_type_id: venta.id, stage_id: stageId(venta.id, "Nuevo"), assignee_id: ANA, status: "open", opened_at: hoursAgo(1) },
    ]);
    const r = await closeOrRequestClose(db(), { caseId: c.id as string, kind: "lost", actorId: ANA }, { actorIsSupervisor: false });
    expect(r).toMatchObject({ ok: true, requested: false, status: "lost" });
    expect(notes("protected_closed")).toHaveLength(0);
  });

  it("cerrar la gestión borra un pedido pendiente", async () => {
    const c = openPostventa();
    await closeOrRequestClose(db(), { caseId: c.id as string, ...lost(), actorId: ANA }, { actorIsSupervisor: false });
    await closeOrRequestClose(
      db(),
      { caseId: c.id as string, kind: "resolved", outcomeReasonId: reasonId("Reembolso"), note: "Resuelto", actorId: SUP },
      { actorIsSupervisor: true },
    );
    expect(row("cases", c.id).close_request).toBeNull();
  });
});

// ── Plazo de la solución ───────────────────────────────────────────────────

describe("registrar la solución en proceso", () => {
  const commitment = new Date(NOW.getTime() + 2 * 86_400_000).toISOString();

  it("guarda la solución y deja la fecha compromiso como próximo contacto", async () => {
    const c = openPostventa();
    const r = await registerSolutionInProgress(db(), { caseId: c.id as string, note: " Cambio de producto ", commitmentAt: commitment, actorId: ANA }, NOW);
    expect(r).toMatchObject({ ok: true, commitmentAt: commitment });
    expect(row("cases", c.id)).toMatchObject({
      solution_status: "in_progress",
      solution_note: "Cambio de producto",
      solution_at: NOW.toISOString(),
      solution_by: ANA,
      next_action_at: commitment,
      next_action_note: "Compromiso: Cambio de producto",
    });
    expect(activity("solution_registered", c.id as string)[0].meta).toMatchObject({ note: "Cambio de producto", commitment_at: commitment });
  });

  it("exige la solución, una fecha futura y un tipo con plazo", async () => {
    const c = openPostventa();
    const base = { caseId: c.id as string, note: "x", commitmentAt: commitment, actorId: ANA };
    expect(await registerSolutionInProgress(db(), { ...base, note: "  " }, NOW)).toHaveProperty("error");
    expect(await registerSolutionInProgress(db(), { ...base, commitmentAt: "" }, NOW)).toHaveProperty("error");
    expect(await registerSolutionInProgress(db(), { ...base, commitmentAt: hoursAgo(1) }, NOW)).toEqual({
      error: "La fecha compromiso tiene que ser futura.",
    });
    const [sale] = fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, case_type_id: venta.id, status: "open", opened_at: hoursAgo(1) }]);
    expect(await registerSolutionInProgress(db(), { ...base, caseId: sale.id as string }, NOW)).toHaveProperty("error");
    expect(fake.rows("cases").every((r) => r.solution_status === null)).toBe(true);
  });

  it("no se registra en una gestión cerrada", async () => {
    const c = openPostventa({ status: "resolved", closed_at: hoursAgo(1) });
    expect(await registerSolutionInProgress(db(), { caseId: c.id as string, note: "x", commitmentAt: commitment, actorId: ANA }, NOW)).toHaveProperty("error");
  });
});

describe("cron: plazo para registrar la solución", () => {
  it("avisa una sola vez a los supervisores cuando vence el plazo", async () => {
    const late = openPostventa({ opened_at: hoursAgo(25) });
    const onTime = openPostventa({ opened_at: hoursAgo(23) });

    const first = await notifySolutionDeadlines(db(), { deadline: deadline(), now: NOW });
    expect(first.alerted).toBe(1);
    expect(row("cases", late.id).deadline_alerted_at).toBe(NOW.toISOString());
    expect(row("cases", onTime.id).deadline_alerted_at).toBeNull();
    expect(usersOf("solution_overdue")).toEqual([SUP, SUP2]);
    expect(notes("solution_overdue")[0].title).toBe("Postventa sin solución registrada: María");
    expect(activity("solution_overdue", late.id as string)).toHaveLength(1);

    // Segunda vuelta: nada nuevo.
    const second = await notifySolutionDeadlines(db(), { deadline: deadline(), now: new Date(NOW.getTime() + 60_000) });
    expect(second.alerted).toBe(0);
    expect(notes("solution_overdue")).toHaveLength(2);

    // Más tarde le toca a la otra.
    const later = await notifySolutionDeadlines(db(), { deadline: deadline(), now: new Date(NOW.getTime() + 2 * 3_600_000) });
    expect(later.alerted).toBe(1);
  });

  it("no avisa si ya registraron la solución, si está cerrada o si el tipo no tiene plazo", async () => {
    openPostventa({ opened_at: hoursAgo(30), solution_status: "in_progress", solution_note: "x" });
    openPostventa({ opened_at: hoursAgo(30), status: "resolved", closed_at: hoursAgo(1) });
    fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, case_type_id: venta.id, status: "open", opened_at: hoursAgo(300) }]);
    const r = await notifySolutionDeadlines(db(), { deadline: deadline(), now: NOW });
    expect(r.alerted).toBe(0);
    expect(notes("solution_overdue")).toHaveLength(0);
  });

  it("una gestión reabierta cuenta el plazo desde la reapertura", async () => {
    openPostventa({ opened_at: daysAgo(3), solution_clock_at: hoursAgo(2) });
    expect((await notifySolutionDeadlines(db(), { deadline: deadline(), now: NOW })).alerted).toBe(0);
  });

  it("sin supervisores en el equipo avisa a los administradores", async () => {
    fake.tables.team_members = fake.rows("team_members").filter((m) => m.role !== "supervisor" || m.team_id !== TEAM);
    openPostventa({ opened_at: hoursAgo(26) });
    await notifySolutionDeadlines(db(), { deadline: deadline(), now: NOW });
    expect(usersOf("solution_overdue")).toEqual([OWNER]);
  });
});

describe("cron: compromiso vencido", () => {
  it("avisa una vez por compromiso al responsable y a los supervisores", async () => {
    const c = openPostventa({
      solution_status: "in_progress",
      solution_note: "Reenvío",
      next_action_at: hoursAgo(1),
    });
    const r1 = await notifyCommitmentsOverdue(db(), { deadline: deadline(), now: NOW });
    expect(r1.alerted).toBe(1);
    expect(usersOf("commitment_overdue")).toEqual([ANA, SUP, SUP2]);
    expect(row("cases", c.id).commitment_alerted_at).toBe(NOW.toISOString());

    expect((await notifyCommitmentsOverdue(db(), { deadline: deadline(), now: NOW })).alerted).toBe(0);

    // Un compromiso nuevo vuelve a poder avisar.
    await setNextAction(db(), { caseId: c.id as string, at: hoursAgo(-1), actorId: ANA });
    expect(row("cases", c.id).commitment_alerted_at).toBeNull();
    const later = new Date(NOW.getTime() + 2 * 3_600_000);
    expect((await notifyCommitmentsOverdue(db(), { deadline: deadline(), now: later })).alerted).toBe(1);
  });

  it("no avisa si el compromiso es futuro ni si la gestión se cerró", async () => {
    openPostventa({ solution_status: "in_progress", next_action_at: new Date(NOW.getTime() + 3_600_000).toISOString() });
    openPostventa({ solution_status: "in_progress", next_action_at: hoursAgo(1), status: "resolved" });
    expect((await notifyCommitmentsOverdue(db(), { deadline: deadline(), now: NOW })).alerted).toBe(0);
  });

  it("runCaseTasks corre las tareas nuevas", async () => {
    openPostventa({ opened_at: hoursAgo(30) });
    const stats = await runCaseTasks(db(), { deadline: deadline(), now: NOW });
    expect(stats.solutionAlerts).toBe(1);
  });
});

// ── Reapertura ─────────────────────────────────────────────────────────────

describe("ventana de reapertura por tipo", () => {
  const at = NOW.toISOString();

  it("una Postventa cerrada hace 3 días se reabre (ventana de 7 días) y avisa a quien la cerró y a los supervisores", async () => {
    const closed = openPostventa({
      status: "resolved",
      closed_at: daysAgo(3),
      closed_by: ANA,
      solution_status: "in_progress",
      solution_note: "Reenvío",
      deadline_alerted_at: daysAgo(4),
    });
    const r = await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at });
    expect(r).toMatchObject({ caseId: closed.id, reopened: true, opened: false });
    expect(row("cases", closed.id)).toMatchObject({
      status: "open",
      solution_status: null,
      solution_note: null,
      solution_clock_at: at,
      deadline_alerted_at: null,
    });
    expect(usersOf("protected_reopened")).toEqual([ANA, SUP, SUP2]);
    expect(notes("protected_reopened")[0].title).toBe("Postventa reabierta: María");
    expect(activity("case_reopened", closed.id as string)[0].meta).toMatchObject({ reason: "customer_message" });
  });

  it("pasada la ventana del tipo se abre otra gestión", async () => {
    const closed = openPostventa({ status: "resolved", closed_at: daysAgo(8), closed_by: ANA });
    const r = await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at });
    expect(r).toMatchObject({ reopened: false });
    expect(r!.caseId).not.toBe(closed.id);
  });

  it("un tipo sin ventana propia sigue reabriendo solo dentro de 24 h", async () => {
    const [sale] = fake.seed("cases", [
      { workspace_id: WS, contact_id: contactId, case_type_id: venta.id, stage_id: stageId(venta.id, "Pagado"), status: "won", opened_at: daysAgo(4), closed_at: daysAgo(3) },
    ]);
    const r = await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at });
    expect(r!.caseId).not.toBe(sale.id);
    expect(r).toMatchObject({ opened: true });
    expect(notes("protected_reopened")).toHaveLength(0);
  });

  it("dentro de 24 h reabre la gestión de un tipo sin ventana", async () => {
    const [sale] = fake.seed("cases", [
      { workspace_id: WS, contact_id: contactId, case_type_id: venta.id, stage_id: stageId(venta.id, "Pagado"), status: "won", opened_at: daysAgo(2), closed_at: hoursAgo(5) },
    ]);
    const r = await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at });
    expect(r).toMatchObject({ caseId: sale.id, reopened: true });
    expect(notes("protected_reopened")).toHaveLength(0);
  });

  it("si la última cerrada ya no entra, reabre una anterior cuyo tipo tiene ventana más larga", async () => {
    const pv = openPostventa({ status: "resolved", closed_at: daysAgo(3), closed_by: ANA });
    fake.seed("cases", [
      { workspace_id: WS, contact_id: contactId, case_type_id: venta.id, stage_id: stageId(venta.id, "Pagado"), status: "won", opened_at: daysAgo(2), closed_at: daysAgo(2) },
    ]);
    const r = await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at });
    expect(r).toMatchObject({ caseId: pv.id, reopened: true });
  });
});

// ── Detector de reclamos ───────────────────────────────────────────────────

describe("detector de reclamos", () => {
  const at = NOW.toISOString();
  const flag = (text: string, when = at) =>
    flagComplaint(db(), { workspaceId: WS, contactId, conversationId, text, at: when });

  it("marca la conversación con lo que escribió el cliente", async () => {
    expect(await flag("Hola, el pote LLEGÓ ROTO")).toBe("flagged");
    expect(fake.rows("conversations")[0]).toMatchObject({
      complaint_flagged_at: at,
      complaint_excerpt: "LLEGÓ ROTO",
      complaint_alerted_at: null,
    });
  });

  it("no marca mensajes normales, ni dos veces", async () => {
    expect(await flag("Quiero comprar proteína")).toBe("no_match");
    expect(fake.rows("conversations")[0].complaint_flagged_at).toBeNull();
    expect(await flag("tengo un reclamo")).toBe("flagged");
    expect(await flag("sigo con el reclamo")).toBe("already_flagged");
  });

  it("no hace nada si ningún tipo es protegido", async () => {
    row("case_types", postventa.id).protected = false;
    expect(await flag("tengo un reclamo")).toBe("disabled");
  });

  it("no marca si ya hay una gestión protegida abierta", async () => {
    openPostventa();
    expect(await flag("tengo un reclamo")).toBe("has_protected_case");
    expect(fake.rows("conversations")[0].complaint_flagged_at).toBeNull();
  });

  it("una gestión abierta de otro tipo no impide marcar", async () => {
    fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, case_type_id: venta.id, status: "open", opened_at: hoursAgo(1) }]);
    expect(await flag("tengo un reclamo")).toBe("flagged");
  });

  it("descartado hace menos de 7 días no vuelve a marcar; pasados 7 días sí", async () => {
    await flag("tengo un reclamo");
    const dismissed = await dismissComplaint(db(), { workspaceId: WS, conversationId, actorId: ANA }, NOW);
    expect(dismissed).toMatchObject({ ok: true });
    expect(fake.rows("conversations")[0]).toMatchObject({ complaint_flagged_at: null, complaint_dismissed_at: at });
    expect(activity("complaint_dismissed")[0]).toMatchObject({ actor_id: ANA, conversation_id: conversationId, meta: { excerpt: "reclamo" } });

    expect(await flag("otra queja", new Date(NOW.getTime() + 6 * 86_400_000).toISOString())).toBe("dismissed_recently");
    expect(await flag("otra queja", new Date(NOW.getTime() + 8 * 86_400_000).toISOString())).toBe("flagged");
  });

  it("«Abrir Postventa» clasifica la gestión sin clasificar", async () => {
    await flag("llegó roto");
    const [open] = fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, assignee_id: ANA, status: "open", opened_at: hoursAgo(1) }]);
    const r = await openComplaintCase(db(), { workspaceId: WS, conversationId, actorId: ANA, canClassify: () => true }, NOW);
    expect(r).toEqual({ ok: true, caseId: open.id, classified: true });
    expect(row("cases", open.id).case_type_id).toBe(postventa.id);
    expect(fake.rows("conversations")[0].complaint_flagged_at).toBeNull();
    expect(fake.rows("cases")).toHaveLength(1);
  });

  it("«Abrir Postventa» abre una gestión nueva si la abierta ya tiene otro tipo", async () => {
    await flag("llegó roto");
    const [sale] = fake.seed("cases", [
      { workspace_id: WS, contact_id: contactId, case_type_id: venta.id, stage_id: stageId(venta.id, "Nuevo"), assignee_id: ANA, status: "open", opened_at: hoursAgo(1) },
    ]);
    const r = await openComplaintCase(db(), { workspaceId: WS, conversationId, actorId: ANA, canClassify: () => true }, NOW);
    expect(r).toMatchObject({ ok: true, classified: false });
    const created = fake.rows("cases").find((c) => c.id !== sale.id)!;
    expect(created).toMatchObject({ case_type_id: postventa.id, assignee_id: ANA, status: "open" });
    expect(row("cases", sale.id).case_type_id).toBe(venta.id);
    expect(fake.rows("conversations")[0].complaint_flagged_at).toBeNull();
  });

  it("si la persona no puede editar la gestión sin clasificar, abre una nueva", async () => {
    await flag("llegó roto");
    fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, status: "open", opened_at: hoursAgo(1) }]);
    const r = await openComplaintCase(db(), { workspaceId: WS, conversationId, actorId: ANA, canClassify: () => false }, NOW);
    expect(r).toMatchObject({ ok: true, classified: false });
    expect(fake.rows("cases")).toHaveLength(2);
  });

  describe("aviso a los supervisores", () => {
    it("a los 30 minutos sin atender avisa una sola vez a los supervisores del equipo del contacto", async () => {
      row("contacts", contactId).team_id = TEAM;
      await flag("llegó roto", hoursAgo(1));
      expect(await alertUnhandledComplaints(db(), { deadline: deadline(), now: NOW })).toMatchObject({ alerted: 1 });
      expect(usersOf("complaint_unclassified")).toEqual([SUP, SUP2]);
      expect(notes("complaint_unclassified")[0]).toMatchObject({
        title: "Posible reclamo sin atender: María",
        body: "Escribió «llegó roto» y no hay una Postventa abierta.",
      });
      expect(fake.rows("conversations")[0].complaint_alerted_at).toBe(NOW.toISOString());
      expect(await alertUnhandledComplaints(db(), { deadline: deadline(), now: NOW })).toMatchObject({ alerted: 0 });
      expect(notes("complaint_unclassified")).toHaveLength(2);
    });

    it("sin equipo avisa a los administradores", async () => {
      await flag("llegó roto", hoursAgo(1));
      await alertUnhandledComplaints(db(), { deadline: deadline(), now: NOW });
      expect(usersOf("complaint_unclassified")).toEqual([OWNER]);
    });

    it("antes de 30 minutos no avisa", async () => {
      await flag("llegó roto", new Date(NOW.getTime() - 10 * 60_000).toISOString());
      expect(await alertUnhandledComplaints(db(), { deadline: deadline(), now: NOW })).toMatchObject({ alerted: 0 });
      expect(notes("complaint_unclassified")).toHaveLength(0);
    });

    it("si ya se abrió una Postventa no avisa", async () => {
      await flag("llegó roto", hoursAgo(1));
      openPostventa({ created_at: hoursAgo(0.5) });
      expect(await alertUnhandledComplaints(db(), { deadline: deadline(), now: NOW })).toMatchObject({ alerted: 0 });
      expect(notes("complaint_unclassified")).toHaveLength(0);
    });

    it("«No es un reclamo» lo saca de la lista", async () => {
      await flag("llegó roto", hoursAgo(1));
      await dismissComplaint(db(), { workspaceId: WS, conversationId, actorId: ANA }, NOW);
      expect(await alertUnhandledComplaints(db(), { deadline: deadline(), now: NOW })).toMatchObject({ alerted: 0 });
    });
  });
});
