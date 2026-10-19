// Embudo por tipo de gestión y tiempo en cada etapa. Puro.

import { businessMinutesBetween } from "@/lib/business-hours";
import { timeStats } from "./stats";
import { buildStageTimeline } from "./timeline";
import type {
  MetricActivity,
  MetricCase,
  MetricCaseType,
  MetricStage,
  ScheduleResolver,
  TimeStats,
} from "./types";

export interface FunnelStage {
  stageId: string;
  name: string;
  /** Gestiones que llegaron hasta esta etapa (o más allá). */
  reached: number;
  /** % de las que llegaron a la etapa anterior y pasaron a esta (null en la primera). */
  passPct: number | null;
  /** % sobre el total de gestiones del tipo. */
  ofTotalPct: number | null;
  /** Tiempo en la etapa, de los tramos ya terminados. */
  clock: TimeStats;
  business: TimeStats;
}

export interface FunnelType {
  typeId: string;
  typeName: string;
  total: number;
  won: number;
  lost: number;
  resolved: number;
  /** Abiertas, programadas o canceladas (sin resultado). */
  other: number;
  stages: FunnelStage[];
}

/**
 * `cases` es la cohorte (gestiones abiertas en el periodo). Una gestión
 * "llegó" a la etapa i si pasó por esa etapa o por una posterior de las
 * abiertas; así el embudo nunca crece de una etapa a la siguiente.
 */
export function buildFunnel(
  cases: readonly MetricCase[],
  activityByCase: ReadonlyMap<string, MetricActivity[]>,
  stages: readonly MetricStage[],
  caseTypes: readonly MetricCaseType[],
  scheduleFor: ScheduleResolver,
  nowMs: number,
): FunnelType[] {
  const result: FunnelType[] = [];
  for (const type of caseTypes) {
    const typeCases = cases.filter((c) => c.case_type_id === type.id);
    if (typeCases.length === 0) continue;
    const openStages = stages
      .filter((s) => s.case_type_id === type.id && s.kind === "open")
      .sort((a, b) => a.position - b.position);
    const indexById = new Map(openStages.map((s, i) => [s.id, i]));

    const reached = openStages.map(() => 0);
    const clockBy = openStages.map(() => [] as number[]);
    const businessBy = openStages.map(() => [] as number[]);

    for (const c of typeCases) {
      const segments = buildStageTimeline(c, activityByCase.get(c.id) ?? [], nowMs);
      let maxIdx = -1;
      for (const seg of segments) {
        const idx = indexById.get(seg.stageId);
        if (idx === undefined) continue;
        maxIdx = Math.max(maxIdx, idx);
        if (seg.ongoing) continue;
        clockBy[idx].push((seg.endMs - seg.startMs) / 1000);
        const sch = scheduleFor(c.team_id);
        businessBy[idx].push(businessMinutesBetween(seg.startMs, seg.endMs, sch.hours, sch.holidays) * 60);
      }
      for (let i = 0; i <= maxIdx; i++) reached[i] += 1;
    }

    const count = (s: MetricCase["status"]) => typeCases.filter((c) => c.status === s).length;
    const won = count("won");
    const lost = count("lost");
    const resolved = count("resolved");
    result.push({
      typeId: type.id,
      typeName: type.name,
      total: typeCases.length,
      won,
      lost,
      resolved,
      other: typeCases.length - won - lost - resolved,
      stages: openStages.map((s, i) => ({
        stageId: s.id,
        name: s.name,
        reached: reached[i],
        passPct: i === 0 ? null : reached[i - 1] > 0 ? Math.round((reached[i] / reached[i - 1]) * 100) : null,
        ofTotalPct: typeCases.length > 0 ? Math.round((reached[i] / typeCases.length) * 100) : null,
        clock: timeStats(clockBy[i]),
        business: timeStats(businessBy[i]),
      })),
    });
  }
  return result;
}
