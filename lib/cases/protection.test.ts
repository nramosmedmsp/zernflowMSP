import { describe, expect, it } from "vitest";
import {
  claimBadge,
  closeGate,
  closeRequestToJson,
  complaintStillPending,
  formatSpan,
  isCaseSupervisor,
  parseCloseRequest,
  reopenWindowMs,
  solutionDueAt,
  solutionScheduleFor,
  solutionState,
} from "./protection";

const HOUR = 3_600_000;

describe("isCaseSupervisor", () => {
  const agent = { role: "member" as const, memberships: [{ teamId: "t1", role: "agent" as const }] };
  const sup = { role: "member" as const, memberships: [{ teamId: "t1", role: "supervisor" as const }] };
  it("administrador y dueño siempre; supervisor solo del equipo de la gestión", () => {
    expect(isCaseSupervisor({ role: "owner", memberships: [] }, "t1")).toBe(true);
    expect(isCaseSupervisor({ role: "admin", memberships: [] }, null)).toBe(true);
    expect(isCaseSupervisor(sup, "t1")).toBe(true);
    expect(isCaseSupervisor(sup, "t2")).toBe(false);
    expect(isCaseSupervisor(sup, null)).toBe(false);
    expect(isCaseSupervisor(agent, "t1")).toBe(false);
  });
});

describe("solutionState", () => {
  const open = { status: "open", openedAt: "2026-10-28T10:00:00Z", solutionStatus: null, solutionNote: null, nextActionAt: null };
  const at = (iso: string) => new Date(iso);

  it("sin plazo no hay estado", () => {
    expect(solutionState(open, null, at("2026-10-28T11:00:00Z"))).toEqual({ kind: "none" });
    expect(solutionDueAt(open, 0)).toBeNull();
  });
  it("pendiente y atrasada", () => {
    expect(solutionState(open, 24, at("2026-10-28T11:00:00Z"))).toEqual({
      kind: "pending",
      dueAt: "2026-10-29T10:00:00.000Z",
      msLeft: 23 * HOUR,
    });
    expect(solutionState(open, 24, at("2026-10-29T12:00:00Z"))).toMatchObject({ kind: "overdue", msLate: 2 * HOUR });
  });
  it("el reloj de reapertura manda sobre opened_at", () => {
    const reopened = { ...open, solutionClockAt: "2026-10-29T09:00:00Z" };
    expect(solutionState(reopened, 24, at("2026-10-29T12:00:00Z")).kind).toBe("pending");
  });
  it("solución en proceso, con compromiso vencido o no", () => {
    const progress = { ...open, solutionStatus: "in_progress", solutionNote: "Reenvío", nextActionAt: "2026-10-30T00:00:00Z" };
    expect(solutionState(progress, 24, at("2026-10-29T12:00:00Z"))).toMatchObject({ kind: "in_progress", commitmentOverdue: false });
    expect(solutionState(progress, 24, at("2026-10-30T02:00:00Z"))).toMatchObject({
      kind: "in_progress",
      commitmentOverdue: true,
      msLate: 2 * HOUR,
    });
  });
  it("una gestión cerrada no tiene plazo", () => {
    expect(solutionState({ ...open, status: "resolved" }, 24, at("2026-11-30T00:00:00Z"))).toEqual({ kind: "none" });
  });
});

describe("formatSpan", () => {
  it.each([
    [10_000, "menos de 1 min"],
    [40 * 60_000, "40 min"],
    [2 * HOUR + 30 * 60_000, "2 h 30 min"],
    [2 * HOUR, "2 h"],
    [5 * HOUR + 59 * 60_000, "5 h"],
    [47 * HOUR, "47 h"],
    [48 * HOUR, "2 días"],
    [24 * 7 * HOUR, "7 días"],
  ])("%d ms → %s", (ms, text) => expect(formatSpan(ms)).toBe(text));
});

describe("formatSpan hacia arriba", () => {
  it("lo que queda se redondea hacia arriba", () => {
    expect(formatSpan(4 * HOUR + 59 * 60_000, { round: "up" })).toBe("5 h");
    expect(formatSpan(19 * HOUR, { round: "up" })).toBe("19 h");
    expect(formatSpan(40 * 60_000 + 1, { round: "up" })).toBe("41 min");
  });
});

describe("closeGate", () => {
  const base = { isProtected: true, typeName: "Postventa", isSupervisor: false, note: "Hecho", hasPendingRequest: false };
  it("tipo no protegido: cierra sin condiciones", () => {
    expect(closeGate({ ...base, isProtected: false, kind: "lost", note: null })).toEqual({ action: "close" });
  });
  it("resuelta o ganada exige nota", () => {
    expect(closeGate({ ...base, kind: "resolved", note: " " })).toEqual({ error: "Cuenta qué se hizo antes de cerrar la Postventa." });
    expect(closeGate({ ...base, kind: "won", note: null })).toHaveProperty("error");
    expect(closeGate({ ...base, kind: "resolved" })).toEqual({ action: "close" });
    expect(closeGate({ ...base, kind: "resolved", isSupervisor: true, note: null })).toHaveProperty("error");
  });
  it("perdida: supervisor cierra, asesor pide, un pedido a la vez", () => {
    expect(closeGate({ ...base, kind: "lost", isSupervisor: true })).toEqual({ action: "close" });
    expect(closeGate({ ...base, kind: "lost" })).toEqual({ action: "request" });
    expect(closeGate({ ...base, kind: "lost", hasPendingRequest: true })).toHaveProperty("error");
    expect(closeGate({ ...base, kind: "lost", isSupervisor: true, hasPendingRequest: true })).toEqual({ action: "close" });
  });
});

describe("pedido de cierre guardado", () => {
  it("ida y vuelta", () => {
    const request = {
      stageId: "s",
      reasonId: "r",
      note: "n",
      categoryId: null,
      keyDate: null,
      scheduleAt: null,
      skipSchedule: false,
      requestedBy: "u",
      requestedAt: "2026-10-28T10:00:00Z",
    };
    expect(parseCloseRequest(closeRequestToJson(request))).toEqual(request);
  });
  it("guarda la fecha clave y la programación elegidas (B-13)", () => {
    const request = {
      stageId: "s",
      reasonId: null,
      note: null,
      categoryId: null,
      keyDate: "2027-01-15",
      scheduleAt: "2027-02-01",
      skipSchedule: false,
      requestedBy: "u",
      requestedAt: "2026-10-28T10:00:00Z",
    };
    expect(parseCloseRequest(closeRequestToJson(request))).toEqual(request);
    expect(parseCloseRequest(closeRequestToJson({ ...request, scheduleAt: null, skipSchedule: true }))?.skipSchedule).toBe(true);
  });
  it("lo inválido es null", () => {
    expect(parseCloseRequest(null)).toBeNull();
    expect(parseCloseRequest([])).toBeNull();
    expect(parseCloseRequest({ stage_id: "s" })).toBeNull();
  });
});

describe("reopenWindowMs", () => {
  it("días del tipo o 24 horas", () => {
    expect(reopenWindowMs(7)).toBe(7 * 24 * HOUR);
    expect(reopenWindowMs(null)).toBe(24 * HOUR);
    expect(reopenWindowMs(0)).toBe(24 * HOUR);
  });
});

describe("complaintStillPending", () => {
  const flagged = "2026-10-28T10:00:00Z";
  it("sin marca no hay nada pendiente", () => {
    expect(complaintStillPending(null, [])).toBe(false);
  });
  it("pendiente si no hay gestiones protegidas, o solo viejas", () => {
    expect(complaintStillPending(flagged, [])).toBe(true);
    expect(
      complaintStillPending(flagged, [{ status: "resolved", createdAt: "2026-10-01T10:00:00Z", closedAt: "2026-10-02T10:00:00Z" }]),
    ).toBe(true);
  });
  it("atendido si hay una abierta, una abierta después de la marca o una cerrada después", () => {
    expect(complaintStillPending(flagged, [{ status: "open", createdAt: "2026-10-01T10:00:00Z", closedAt: null }])).toBe(false);
    expect(complaintStillPending(flagged, [{ status: "resolved", createdAt: "2026-10-28T11:00:00Z", closedAt: "2026-10-28T12:00:00Z" }])).toBe(false);
    expect(complaintStillPending(flagged, [{ status: "resolved", createdAt: "2026-10-01T10:00:00Z", closedAt: "2026-10-28T10:30:00Z" }])).toBe(false);
  });
});

describe("claimBadge", () => {
  const open = { status: "open", openedAt: "2026-10-28T10:00:00Z", solutionStatus: null, solutionNote: null, nextActionAt: null };
  const now = new Date("2026-10-30T10:00:00Z");
  it("sin solución a tiempo, compromiso vencido y cierre por aprobar", () => {
    expect(claimBadge(open, 24, now)).toEqual({ kind: "late", label: "Sin solución a tiempo" });
    expect(claimBadge({ ...open, solutionStatus: "in_progress", nextActionAt: "2026-10-29T10:00:00Z" }, 24, now)).toEqual({
      kind: "commitment",
      label: "Compromiso vencido",
    });
    expect(claimBadge({ ...open, hasCloseRequest: true }, 24, now)).toEqual({ kind: "approval", label: "Cierre por aprobar" });
  });
  it("nada si está al día, sin plazo o cerrada", () => {
    expect(claimBadge({ ...open, solutionStatus: "in_progress", nextActionAt: "2026-10-31T10:00:00Z" }, 24, now)).toBeNull();
    expect(claimBadge(open, null, now)).toBeNull();
    expect(claimBadge({ ...open, status: "resolved" }, 24, now)).toBeNull();
  });
});

describe("R2-10: el plazo de la solución cuenta horas hábiles", () => {
  // Lima = UTC-5. 2026-10-16 es viernes.
  const SPLIT: [string, string][] = [
    ["09:00", "13:00"],
    ["14:00", "19:00"],
  ];
  const WEEK = { mon: SPLIT, tue: SPLIT, wed: SPLIT, thu: SPLIT, fri: SPLIT, sat: [], sun: [] };
  const schedules = { workspaceHours: WEEK, teamHours: { sede: null }, holidays: [] };
  const lima = (date: string, time: string) => `${date}T${time}:00-05:00`;
  const open = (extra = {}) => ({
    status: "open",
    openedAt: new Date(lima("2026-10-16", "17:00")).toISOString(),
    solutionStatus: null,
    solutionNote: null,
    nextActionAt: null,
    solutionSchedule: solutionScheduleFor(schedules, "sede"),
    ...extra,
  });

  it("24 h hábiles abiertas el viernes a las 17:00 vencen el martes, no el sábado", () => {
    // Quedan 2 h el viernes (17-19). Lunes 9 h (9-13 y 14-19), martes hasta cumplir 22 h restantes... total 24.
    const due = solutionDueAt(open(), 24)!;
    const clock = new Date(open().openedAt).getTime() + 24 * 3_600_000;
    expect(due.getTime()).toBeGreaterThan(clock + 24 * 3_600_000);
    expect(due.toISOString()).toBe(new Date(lima("2026-10-21", "13:00")).toISOString());
  });

  it("sin horario (o con horario vacío) siguen siendo horas de reloj", () => {
    const base = open({ solutionSchedule: null });
    expect(solutionDueAt(base, 24)!.getTime()).toBe(new Date(base.openedAt).getTime() + 24 * 3_600_000);
    expect(solutionScheduleFor({ workspaceHours: null, teamHours: {}, holidays: [] }, null)).toBeNull();
    expect(solutionScheduleFor(null, "x")).toBeNull();
  });

  it("el equipo con horario propio manda sobre el de la empresa y suma sus feriados", () => {
    const night = { mon: [["18:00", "22:00"]], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    const s = solutionScheduleFor(
      { workspaceHours: WEEK, teamHours: { noche: night as never }, holidays: [{ date: "2026-10-19", team_id: "noche" }, { date: "2026-10-20", team_id: null }] },
      "noche",
    )!;
    expect(s.hours?.mon).toEqual(night.mon);
    expect(s.holidays.sort()).toEqual(["2026-10-19", "2026-10-20"]);
  });

  it("el estado pendiente informa lo que queda en horas hábiles", () => {
    const now = new Date(lima("2026-10-16", "18:00"));
    const state = solutionState(open(), 24, now);
    expect(state.kind).toBe("pending");
    if (state.kind === "pending") {
      expect(state.businessMsLeft).toBe(23 * 3_600_000);
      expect(state.msLeft).toBeGreaterThan(state.businessMsLeft!);
    }
  });

  it("no está atrasada un sábado aunque hayan pasado más de 24 h de reloj", () => {
    const sat = new Date(lima("2026-10-17", "20:00"));
    expect(solutionState(open(), 24, sat).kind).toBe("pending");
    expect(solutionState(open({ solutionSchedule: null }), 24, sat).kind).toBe("overdue"); // en reloj sí
    const tuesdayLate = new Date(lima("2026-10-21", "14:00"));
    expect(solutionState(open(), 24, tuesdayLate).kind).toBe("overdue");
  });
});
