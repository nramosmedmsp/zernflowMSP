// Cumplimiento de objetivos de tiempo. Puro. Solo cuentan los tipos que tienen
// objetivo; se mide en horas hábiles.

import { pct } from "./stats";
import type { TimeSample } from "./samples";
import type { MetricCase, MetricCaseType } from "./types";

export interface ComplianceStat {
  within: number;
  total: number;
  pct: number | null;
}

export interface ComplianceReport {
  firstResponse: ComplianceStat;
  resolution: ComplianceStat;
}

function finish(within: number, total: number): ComplianceStat {
  return { within, total, pct: pct(within, total) };
}

export function complianceOf(
  firstResponses: readonly TimeSample[],
  resolutions: readonly TimeSample[],
  caseById: ReadonlyMap<string, MetricCase>,
  caseTypes: readonly MetricCaseType[],
): ComplianceReport {
  const typeById = new Map(caseTypes.map((t) => [t.id, t]));
  let frWithin = 0;
  let frTotal = 0;
  for (const s of firstResponses) {
    const target = typeById.get(caseById.get(s.caseId)?.case_type_id ?? "")?.sla_first_response_minutes;
    if (!target) continue;
    frTotal += 1;
    if (s.businessSeconds <= target * 60) frWithin += 1;
  }
  let rsWithin = 0;
  let rsTotal = 0;
  for (const s of resolutions) {
    const target = typeById.get(caseById.get(s.caseId)?.case_type_id ?? "")?.sla_resolution_hours;
    if (!target) continue;
    rsTotal += 1;
    if (s.businessSeconds <= target * 3600) rsWithin += 1;
  }
  return { firstResponse: finish(frWithin, frTotal), resolution: finish(rsWithin, rsTotal) };
}
