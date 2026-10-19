// Muestras de tiempos de respuesta y de resolución (reloj y en horario). Puras.

import { businessMinutesBetween } from "@/lib/business-hours";
import { inRange, type PeriodRange } from "./period";
import { timeStats } from "./stats";
import type { DualStats, MetricActivity, MetricCase, ScheduleResolver } from "./types";

export interface TimeSample {
  caseId: string;
  actorId: string | null;
  atMs: number;
  clockSeconds: number;
  businessSeconds: number;
}

function meta(a: MetricActivity): Record<string, unknown> {
  return a.meta && typeof a.meta === "object" && !Array.isArray(a.meta) ? (a.meta as Record<string, unknown>) : {};
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function businessBetween(fromIso: string, toIso: string, c: MetricCase | undefined, scheduleFor: ScheduleResolver): number {
  const s = scheduleFor(c?.team_id ?? null);
  return businessMinutesBetween(fromIso, toIso, s.hours, s.holidays) * 60;
}

/** Muestra de una actividad de respuesta (`first_response` o `human_reply`); null si no hay datos. */
function sampleFromActivity(
  a: MetricActivity,
  c: MetricCase | undefined,
  scheduleFor: ScheduleResolver,
): TimeSample | null {
  if (!a.case_id) return null;
  const m = meta(a);
  const waiting = typeof m.waiting_since === "string" ? m.waiting_since : null;
  let clock = num(m.seconds);
  if (clock === null && waiting) clock = Math.max(0, (Date.parse(a.created_at) - Date.parse(waiting)) / 1000);
  if (clock === null || Number.isNaN(clock)) return null;
  let business = num(m.business_seconds);
  if (business === null) {
    business = waiting ? businessBetween(waiting, a.created_at, c, scheduleFor) : clock;
  }
  return {
    caseId: a.case_id,
    actorId: a.actor_id,
    atMs: Date.parse(a.created_at),
    clockSeconds: clock,
    businessSeconds: business,
  };
}

/**
 * Primera respuesta de cada gestión. Usa `first_response`; si la gestión no
 * lo tiene, la primera `human_reply`. Solo las ocurridas en el periodo y de
 * las gestiones indicadas.
 */
export function firstResponseSamples(
  cases: readonly MetricCase[],
  activityByCase: ReadonlyMap<string, MetricActivity[]>,
  scheduleFor: ScheduleResolver,
  range: PeriodRange,
): TimeSample[] {
  const out: TimeSample[] = [];
  for (const c of cases) {
    const acts = activityByCase.get(c.id) ?? [];
    const byTime = (x: MetricActivity, y: MetricActivity) => Date.parse(x.created_at) - Date.parse(y.created_at);
    const fr = acts.filter((a) => a.type === "first_response").sort(byTime)[0];
    const source = fr ?? acts.filter((a) => a.type === "human_reply").sort(byTime)[0];
    if (!source || !inRange(source.created_at, range)) continue;
    const s = sampleFromActivity(source, c, scheduleFor);
    if (s) out.push(s);
  }
  return out;
}

/** Todas las respuestas humanas (`human_reply`) del periodo. */
export function replySamples(
  cases: readonly MetricCase[],
  activityByCase: ReadonlyMap<string, MetricActivity[]>,
  scheduleFor: ScheduleResolver,
  range: PeriodRange,
): TimeSample[] {
  const out: TimeSample[] = [];
  for (const c of cases) {
    for (const a of activityByCase.get(c.id) ?? []) {
      if (a.type !== "human_reply" || !inRange(a.created_at, range)) continue;
      const s = sampleFromActivity(a, c, scheduleFor);
      if (s) out.push(s);
    }
  }
  return out;
}

/** Gestiones cerradas en el periodo (sin canceladas) con su tiempo de resolución. */
export function resolutionSamples(
  cases: readonly MetricCase[],
  scheduleFor: ScheduleResolver,
  range: PeriodRange,
): TimeSample[] {
  const out: TimeSample[] = [];
  for (const c of cases) {
    if (c.status !== "won" && c.status !== "lost" && c.status !== "resolved") continue;
    if (!c.closed_at || !c.opened_at || !inRange(c.closed_at, range)) continue;
    const clock = (Date.parse(c.closed_at) - Date.parse(c.opened_at)) / 1000;
    if (!(clock >= 0)) continue;
    out.push({
      caseId: c.id,
      actorId: c.assignee_id,
      atMs: Date.parse(c.closed_at),
      clockSeconds: clock,
      businessSeconds: businessBetween(c.opened_at, c.closed_at, c, scheduleFor),
    });
  }
  return out;
}

export function dualStats(samples: readonly TimeSample[]): DualStats {
  return {
    clock: timeStats(samples.map((s) => s.clockSeconds)),
    business: timeStats(samples.map((s) => s.businessSeconds)),
  };
}
