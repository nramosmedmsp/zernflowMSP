// Gestiones atrasadas: próxima acción vencida o demasiados días en la misma
// etapa. Puro.

import { buildStageTimeline } from "./timeline";
import type { MetricActivity, MetricCase, MetricCaseType, MetricStage } from "./types";

export const DEFAULT_STALE_STAGE_DAYS = 7;
export const MAX_STALE_STAGE_DAYS = 365;

export type OverdueReason = "next_action" | "stale_stage";

export interface OverdueItem {
  caseId: string;
  contactId: string;
  contactName: string | null;
  typeName: string | null;
  stageName: string | null;
  assigneeId: string | null;
  nextActionAt: string | null;
  /** Días enteros desde que venció la próxima acción (0 si no venció). */
  daysOverdue: number;
  daysInStage: number;
  reasons: OverdueReason[];
}

const DAY_MS = 86_400_000;

/** `stale_stage_days` de `workspaces.settings`; por defecto 7. */
export function staleStageDaysFromSettings(settings: unknown): number {
  const raw =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).stale_stage_days
      : undefined;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= MAX_STALE_STAGE_DAYS
    ? raw
    : DEFAULT_STALE_STAGE_DAYS;
}

export function buildOverdue(
  cases: readonly MetricCase[],
  activityByCase: ReadonlyMap<string, MetricActivity[]>,
  stages: readonly MetricStage[],
  caseTypes: readonly MetricCaseType[],
  staleDays: number,
  nowMs: number,
): OverdueItem[] {
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const typeName = new Map(caseTypes.map((t) => [t.id, t.name]));
  const items: OverdueItem[] = [];

  for (const c of cases) {
    if (c.status !== "open") continue;
    const reasons: OverdueReason[] = [];

    const next = c.next_action_at ? Date.parse(c.next_action_at) : null;
    const nextOverdue = next !== null && !Number.isNaN(next) && next < nowMs;
    if (nextOverdue) reasons.push("next_action");

    const segments = buildStageTimeline(c, activityByCase.get(c.id) ?? [], nowMs);
    const current = segments[segments.length - 1];
    const daysInStage = current ? Math.floor((nowMs - current.startMs) / DAY_MS) : 0;
    if (current && nowMs - current.startMs >= staleDays * DAY_MS) reasons.push("stale_stage");

    if (reasons.length === 0) continue;
    items.push({
      caseId: c.id,
      contactId: c.contact_id,
      contactName: c.contact_name ?? null,
      typeName: c.case_type_id ? (typeName.get(c.case_type_id) ?? null) : null,
      stageName: c.stage_id ? (stageName.get(c.stage_id) ?? null) : null,
      assigneeId: c.assignee_id,
      nextActionAt: c.next_action_at,
      daysOverdue: nextOverdue ? Math.floor((nowMs - (next as number)) / DAY_MS) : 0,
      daysInStage,
      reasons,
    });
  }

  // Primero las que más tiempo llevan atrasadas.
  return items.sort((a, b) => Math.max(b.daysOverdue, b.daysInStage) - Math.max(a.daysOverdue, a.daysInStage));
}
