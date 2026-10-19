// Resultados (ganadas, perdidas, resueltas), motivos y tasas de recompra y
// renovación. Puro.

import { limaDayKey } from "./day";
import { inRange, type PeriodRange } from "./period";
import type { MetricCase, MetricCaseType, MetricReason } from "./types";

export interface OutcomeDay {
  day: string;
  won: number;
  lost: number;
  resolved: number;
}

export interface ReasonCount {
  reasonId: string | null;
  name: string;
  kind: "won" | "lost" | "resolved";
  count: number;
}

export interface ProactiveRate {
  typeId: string;
  typeName: string;
  activated: number;
  won: number;
  lost: number;
  /** ganadas / activadas. */
  ratePct: number | null;
}

export interface ResultsReport {
  won: number;
  lost: number;
  resolved: number;
  /** ganadas / (ganadas + perdidas). */
  closeRatePct: number | null;
  byDay: OutcomeDay[];
  reasons: ReasonCount[];
  proactive: ProactiveRate[];
}

export function isFinalStatus(s: MetricCase["status"]): s is "won" | "lost" | "resolved" {
  return s === "won" || s === "lost" || s === "resolved";
}

export function buildResults(
  cases: readonly MetricCase[],
  reasons: readonly MetricReason[],
  caseTypes: readonly MetricCaseType[],
  range: PeriodRange,
  days: readonly string[],
): ResultsReport {
  const closed = cases.filter((c) => isFinalStatus(c.status) && inRange(c.closed_at, range));
  const count = (s: string) => closed.filter((c) => c.status === s).length;
  const won = count("won");
  const lost = count("lost");
  const resolved = count("resolved");

  const byDayMap = new Map<string, OutcomeDay>(days.map((d) => [d, { day: d, won: 0, lost: 0, resolved: 0 }]));
  for (const c of closed) {
    const row = byDayMap.get(limaDayKey(c.closed_at as string));
    if (row && isFinalStatus(c.status)) row[c.status] += 1;
  }

  const reasonName = new Map(reasons.map((r) => [r.id, r.name]));
  const reasonMap = new Map<string, ReasonCount>();
  for (const c of closed) {
    if (!isFinalStatus(c.status)) continue;
    const key = `${c.status}:${c.outcome_reason_id ?? ""}`;
    const prev = reasonMap.get(key);
    if (prev) prev.count += 1;
    else
      reasonMap.set(key, {
        reasonId: c.outcome_reason_id,
        name: c.outcome_reason_id ? (reasonName.get(c.outcome_reason_id) ?? "Motivo eliminado") : "Sin motivo",
        kind: c.status,
        count: 1,
      });
  }

  // Recompra y renovación: gestiones de tipos proactivos activadas en el periodo.
  const proactive: ProactiveRate[] = [];
  for (const t of caseTypes.filter((x) => x.is_proactive)) {
    const activated = cases.filter(
      (c) =>
        c.case_type_id === t.id && c.status !== "scheduled" && c.status !== "cancelled" && inRange(c.opened_at, range),
    );
    if (activated.length === 0) continue;
    const w = activated.filter((c) => c.status === "won").length;
    const l = activated.filter((c) => c.status === "lost").length;
    proactive.push({
      typeId: t.id,
      typeName: t.name,
      activated: activated.length,
      won: w,
      lost: l,
      ratePct: Math.round((w / activated.length) * 100),
    });
  }

  return {
    won,
    lost,
    resolved,
    closeRatePct: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
    byDay: [...byDayMap.values()],
    reasons: [...reasonMap.values()].sort((a, b) => b.count - a.count),
    proactive,
  };
}
