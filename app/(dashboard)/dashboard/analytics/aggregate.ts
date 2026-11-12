// Armado de las series de Analítica a partir de los conteos que entrega la base
// (analytics_flow_stats y analytics_daily, 00045). Antes se traían las filas y se
// sumaba aquí; con más de 1 000 filas PostgREST las cortaba y el número salía mal.

export interface FlowStatRow {
  flow_id: string;
  starts: number | string;
  completions: number | string;
}

export interface DailyRow {
  day: string;
  sent: number | string;
  failed: number | string;
  new_contacts: number | string;
}

/** Postgres devuelve bigint como número o texto según el cliente. */
export function toCount(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function buildFlowPerformance(stats: readonly FlowStatRow[], names: ReadonlyMap<string, string>, top = 10) {
  return stats
    .map((s) => {
      const starts = toCount(s.starts);
      const completions = toCount(s.completions);
      const dropOffRate = starts > 0 ? Math.round(((starts - completions) / starts) * 100) : 0;
      return { id: s.flow_id, name: names.get(s.flow_id) ?? "Flujo desconocido", starts, completions, dropOffRate };
    })
    .sort((a, b) => b.starts - a.starts)
    .slice(0, top);
}

export function buildDailySeries(rows: readonly DailyRow[], dayKeys: readonly string[]) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return {
    contactGrowth: dayKeys.map((date) => ({ date, count: toCount(byDay.get(date)?.new_contacts) })),
    messageVolume: dayKeys.map((date) => ({
      date,
      sent: toCount(byDay.get(date)?.sent),
      failed: toCount(byDay.get(date)?.failed),
    })),
  };
}
