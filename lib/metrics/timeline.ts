// Línea de tiempo de etapas de una gestión (docs/FASE-3-TECNICO.md 3):
// `case_opened` + `stage_changed` + cierre. Pura.

import type { MetricActivity, MetricCase } from "./types";

export interface StageSegment {
  stageId: string;
  startMs: number;
  endMs: number;
  /** La gestión sigue en esa etapa (el fin es "ahora"). */
  ongoing: boolean;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Tramos por etapa en orden. La etapa inicial es el `from_value` del primer
 * cambio; sin cambios, la etapa actual de la gestión. Un cambio anterior al
 * inicio se ignora y los tramos nunca tienen duración negativa.
 */
export function buildStageTimeline(
  c: MetricCase,
  activity: readonly MetricActivity[],
  nowMs: number,
): StageSegment[] {
  const openedActivity = activity.find((a) => a.type === "case_opened");
  const start = ms(c.opened_at) ?? ms(openedActivity?.created_at) ?? ms(c.created_at);
  if (start === null) return [];

  const changes = activity
    .filter((a) => a.type === "stage_changed" && ms(a.created_at) !== null)
    .sort((a, b) => (ms(a.created_at) as number) - (ms(b.created_at) as number));

  let current: string | null = changes.length > 0 ? changes[0].from_value : c.stage_id;
  let t = start;
  const out: StageSegment[] = [];

  for (const ch of changes) {
    const at = Math.max(ms(ch.created_at) as number, t);
    if (current) out.push({ stageId: current, startMs: t, endMs: at, ongoing: false });
    current = ch.to_value;
    t = at;
  }

  const closed = ms(c.closed_at);
  const end = closed !== null ? Math.max(closed, t) : Math.max(nowMs, t);
  if (current) out.push({ stageId: current, startMs: t, endMs: end, ongoing: closed === null });
  return out;
}

/** Agrupa la actividad por gestión. */
export function groupActivityByCase(activity: readonly MetricActivity[]): Map<string, MetricActivity[]> {
  const map = new Map<string, MetricActivity[]>();
  for (const a of activity) {
    if (!a.case_id) continue;
    const list = map.get(a.case_id);
    if (list) list.push(a);
    else map.set(a.case_id, [a]);
  }
  return map;
}
