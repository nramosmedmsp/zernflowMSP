// Cálculo completo de las métricas de la pantalla (docs/FASE-3-TECNICO.md 3).
// Recibe filas ya leídas con el cliente de la persona (RLS) y devuelve objetos
// listos para mostrar. Puro.

import { hasSchedule } from "@/lib/business-hours";
import { complianceOf, type ComplianceReport } from "./compliance";
import { dayRange } from "./day";
import { buildFunnel, type FunnelType } from "./funnel";
import { buildOverdue, type OverdueItem } from "./overdue";
import { inRange, periodRange, type PeriodRange } from "./period";
import { buildResults, isFinalStatus, type ResultsReport } from "./results";
import {
  dualStats,
  firstResponseSamples,
  replySamples,
  resolutionSamples,
  type TimeSample,
} from "./samples";
import { pct } from "./stats";
import { groupActivityByCase } from "./timeline";
import type { DualStats, MetricCase, MetricFilters, MetricsInput } from "./types";
import { buildVolume, type VolumeReport } from "./volume";

export interface AgentRow {
  userId: string | null;
  name: string;
  /** Gestiones con actividad en el periodo (abiertas o cerradas en él). */
  attended: number;
  firstResponse: DualStats;
  reply: DualStats;
  resolution: DualStats;
  won: number;
  lost: number;
  resolved: number;
  /** ganadas / (ganadas + perdidas). */
  closeRatePct: number | null;
  /** % de primeras respuestas dentro del objetivo. */
  compliancePct: number | null;
}

export interface MetricsSummary {
  firstResponse: DualStats;
  reply: DualStats;
  resolution: DualStats;
  compliance: ComplianceReport;
  won: number;
  lost: number;
  resolved: number;
  newCases: number;
  overdue: number;
}

export interface MetricsReport {
  range: PeriodRange;
  summary: MetricsSummary;
  agents: AgentRow[];
  funnel: FunnelType[];
  results: ResultsReport;
  overdue: OverdueItem[];
  volume: VolumeReport;
  /** Hay horario configurado en alguna parte (si no, "en horario" = reloj). */
  hasSchedule: boolean;
}

/** Aplica los cortes a las gestiones (no al periodo). */
export function filterCases(
  cases: readonly MetricCase[],
  filters: MetricFilters,
  platformByContact: ReadonlyMap<string, string>,
): MetricCase[] {
  return cases.filter((c) => {
    if (filters.caseTypeId && c.case_type_id !== filters.caseTypeId) return false;
    if (filters.teamId && c.team_id !== filters.teamId) return false;
    if (filters.assigneeId && c.assignee_id !== filters.assigneeId) return false;
    if (filters.origin && c.origin !== filters.origin) return false;
    if (filters.contactTypeId && c.contact_type_id !== filters.contactTypeId) return false;
    if (filters.channel && platformByContact.get(c.contact_id) !== filters.channel) return false;
    return true;
  });
}

function sampleAssignee(s: TimeSample, caseById: ReadonlyMap<string, MetricCase>): string | null {
  return s.actorId ?? caseById.get(s.caseId)?.assignee_id ?? null;
}

export function computeMetrics(input: MetricsInput, filters: MetricFilters): MetricsReport {
  const nowMs = input.now.getTime();
  const range = periodRange(filters, input.now);
  const cases = filterCases(input.cases, filters, input.platformByContact);
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const activityByCase = groupActivityByCase(input.activity);

  const firstResponses = firstResponseSamples(cases, activityByCase, input.scheduleFor, range);
  const replies = replySamples(cases, activityByCase, input.scheduleFor, range);
  const resolutions = resolutionSamples(cases, input.scheduleFor, range);
  const compliance = complianceOf(firstResponses, resolutions, caseById, input.caseTypes);

  const days = dayRange(range.startDay, range.endDay);
  const results = buildResults(cases, input.reasons, input.caseTypes, range, days);

  const newCases = cases.filter(
    (c) => c.opened_at && c.status !== "scheduled" && c.status !== "cancelled" && inRange(c.opened_at, range),
  );
  const overdue = buildOverdue(cases, activityByCase, input.stages, input.caseTypes, input.staleStageDays, nowMs);
  const funnel = buildFunnel(newCases, activityByCase, input.stages, input.caseTypes, input.scheduleFor, nowMs);

  // Mensajes entrantes: solo se corta por canal (el evento no guarda asesor ni tipo).
  const inbound = filters.channel ? input.inbound.filter((e) => e.platform === filters.channel) : input.inbound;
  const volume = buildVolume(inbound, newCases, range);

  // Por asesor.
  const names = new Map(input.members.map((m) => [m.userId, m.name]));
  const groups = new Map<string | null, MetricCase[]>();
  for (const c of cases) {
    const touched =
      (c.opened_at && c.status !== "scheduled" && c.status !== "cancelled" && inRange(c.opened_at, range)) ||
      (isFinalStatus(c.status) && inRange(c.closed_at, range));
    if (!touched) continue;
    const list = groups.get(c.assignee_id);
    if (list) list.push(c);
    else groups.set(c.assignee_id, [c]);
  }
  for (const s of [...firstResponses, ...replies]) {
    const id = sampleAssignee(s, caseById);
    if (!groups.has(id)) groups.set(id, []);
  }
  const agents: AgentRow[] = [...groups.entries()].map(([userId, list]) => {
    const mine = <T extends TimeSample>(xs: T[]) => xs.filter((s) => sampleAssignee(s, caseById) === userId);
    const fr = mine(firstResponses);
    const closed = list.filter((c) => isFinalStatus(c.status) && inRange(c.closed_at, range));
    const won = closed.filter((c) => c.status === "won").length;
    const lost = closed.filter((c) => c.status === "lost").length;
    const own = complianceOf(fr, [], caseById, input.caseTypes);
    return {
      userId,
      name: userId ? (names.get(userId) ?? "Persona eliminada") : "Sin asignar",
      attended: list.length,
      firstResponse: dualStats(fr),
      reply: dualStats(mine(replies)),
      resolution: dualStats(resolutions.filter((s) => caseById.get(s.caseId)?.assignee_id === userId)),
      won,
      lost,
      resolved: closed.filter((c) => c.status === "resolved").length,
      closeRatePct: pct(won, won + lost),
      compliancePct: own.firstResponse.pct,
    };
  });
  agents.sort((a, b) => b.attended - a.attended || a.name.localeCompare(b.name, "es"));

  const anySchedule =
    hasSchedule(input.scheduleFor(null).hours) || input.teams.some((t) => hasSchedule(input.scheduleFor(t.id).hours));

  return {
    range,
    summary: {
      firstResponse: dualStats(firstResponses),
      reply: dualStats(replies),
      resolution: dualStats(resolutions),
      compliance,
      won: results.won,
      lost: results.lost,
      resolved: results.resolved,
      newCases: newCases.length,
      overdue: overdue.length,
    },
    agents,
    funnel,
    results,
    overdue,
    volume,
    hasSchedule: anySchedule,
  };
}
