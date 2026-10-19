// Filas de CSV de cada tabla de la pantalla. Los tiempos van en minutos (con
// un decimal) para poder ordenarlos y sumarlos en una hoja de cálculo.

import type { AgentRow } from "./compute";
import { toCsv } from "./csv";
import { formatDmy } from "./day";
import type { FunnelType } from "./funnel";
import type { OverdueItem } from "./overdue";
import type { ReasonCount, ProactiveRate } from "./results";
import type { DualStats, TimeStats } from "./types";
import type { VolumeDay } from "./volume";

export type TimeMode = "business" | "clock";

function minutes(seconds: number | null | undefined): number | null {
  return seconds === null || seconds === undefined ? null : Math.round((seconds / 60) * 10) / 10;
}

function pick(d: DualStats, mode: TimeMode): TimeStats {
  return mode === "business" ? d.business : d.clock;
}

const KIND_LABEL: Record<string, string> = { won: "Ganada", lost: "Perdida", resolved: "Resuelta" };

export function agentsCsv(rows: readonly AgentRow[], mode: TimeMode): string {
  return toCsv(
    [
      "Asesor",
      "Gestiones atendidas",
      "Primera respuesta mediana (min)",
      "Respuesta mediana (min)",
      "Resolución mediana (min)",
      "Ganadas",
      "Perdidas",
      "Resueltas",
      "Tasa de cierre (%)",
      "Cumplimiento primera respuesta (%)",
    ],
    rows.map((r) => [
      r.name,
      r.attended,
      minutes(pick(r.firstResponse, mode).median),
      minutes(pick(r.reply, mode).median),
      minutes(pick(r.resolution, mode).median),
      r.won,
      r.lost,
      r.resolved,
      r.closeRatePct,
      r.compliancePct,
    ]),
  );
}

export function funnelCsv(funnel: readonly FunnelType[], mode: TimeMode): string {
  const rows: (string | number | null)[][] = [];
  for (const t of funnel) {
    for (const s of t.stages) {
      const time = mode === "business" ? s.business : s.clock;
      rows.push([
        t.typeName,
        s.name,
        s.reached,
        s.passPct,
        s.ofTotalPct,
        minutes(time.mean),
        minutes(time.median),
        t.total,
        t.won,
        t.lost,
        t.resolved,
      ]);
    }
  }
  return toCsv(
    [
      "Tipo de gestión",
      "Etapa",
      "Gestiones que llegaron",
      "Paso desde la etapa anterior (%)",
      "Del total (%)",
      "Tiempo promedio en la etapa (min)",
      "Tiempo mediano en la etapa (min)",
      "Total del tipo",
      "Ganadas",
      "Perdidas",
      "Resueltas",
    ],
    rows,
  );
}

export function reasonsCsv(reasons: readonly ReasonCount[]): string {
  return toCsv(
    ["Resultado", "Motivo", "Gestiones"],
    reasons.map((r) => [KIND_LABEL[r.kind] ?? r.kind, r.name, r.count]),
  );
}

export function proactiveCsv(rows: readonly ProactiveRate[]): string {
  return toCsv(
    ["Tipo de gestión", "Activadas", "Ganadas", "Perdidas", "Tasa (%)"],
    rows.map((r) => [r.typeName, r.activated, r.won, r.lost, r.ratePct]),
  );
}

export function overdueCsv(items: readonly OverdueItem[], memberName: (id: string | null) => string): string {
  return toCsv(
    ["Contacto", "Tipo de gestión", "Etapa", "Responsable", "Próxima acción", "Días de atraso", "Días en la etapa", "Motivo"],
    items.map((i) => [
      i.contactName ?? "Sin nombre",
      i.typeName ?? "",
      i.stageName ?? "",
      memberName(i.assigneeId),
      formatDmy(i.nextActionAt),
      i.daysOverdue,
      i.daysInStage,
      i.reasons
        .map((r) => (r === "next_action" ? "Próxima acción vencida" : "Mucho tiempo en la misma etapa"))
        .join(" y "),
    ]),
  );
}

export function volumeCsv(days: readonly VolumeDay[], withMessages: boolean): string {
  return toCsv(
    withMessages ? ["Fecha", "Mensajes entrantes", "Gestiones nuevas"] : ["Fecha", "Gestiones nuevas"],
    days.map((d) => (withMessages ? [formatDmy(`${d.day}T12:00:00-05:00`), d.messages, d.cases] : [formatDmy(`${d.day}T12:00:00-05:00`), d.cases])),
  );
}
