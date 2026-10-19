// Periodos y filtros de las métricas (hora de Lima).

import { addDays, isDateString, limaDateOf, limaDateTimeIso } from "@/lib/cases/dates";
import type { MetricFilters, MetricOrigin, MetricPeriod } from "./types";

export const PERIOD_OPTIONS: readonly { value: MetricPeriod; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "7d", label: "Últimos 7 días" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "90d", label: "Últimos 90 días" },
  { value: "custom", label: "Personalizado" },
];

export const DEFAULT_PERIOD: MetricPeriod = "30d";
/** Máximo de días de un periodo personalizado. */
export const MAX_CUSTOM_DAYS = 366;

export interface PeriodRange {
  /** Inicio (inclusive) y fin (exclusivo) como ISO. */
  startIso: string;
  endIso: string;
  /** Días de Lima, ambos incluidos. */
  startDay: string;
  endDay: string;
  days: number;
}

const DAYS_BY_PERIOD: Record<Exclude<MetricPeriod, "custom">, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Rango de un periodo. Un periodo personalizado inválido cae al de por defecto. */
export function periodRange(filters: Pick<MetricFilters, "period" | "from" | "to">, now: Date): PeriodRange {
  const today = limaDateOf(now);
  let startDay: string;
  let endDay: string;
  if (
    filters.period === "custom" &&
    isDateString(filters.from) &&
    isDateString(filters.to) &&
    filters.from <= filters.to &&
    dayDiff(filters.from, filters.to) < MAX_CUSTOM_DAYS
  ) {
    startDay = filters.from;
    endDay = filters.to;
  } else {
    const n = filters.period === "custom" ? DAYS_BY_PERIOD[DEFAULT_PERIOD as "30d"] : DAYS_BY_PERIOD[filters.period];
    endDay = today;
    startDay = addDays(today, -(n - 1));
  }
  return {
    startIso: limaDateTimeIso(startDay, 0),
    endIso: limaDateTimeIso(addDays(endDay, 1), 0),
    startDay,
    endDay,
    days: dayDiff(startDay, endDay) + 1,
  };
}

export function inRange(iso: string | null | undefined, range: Pick<PeriodRange, "startIso" | "endIso">): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= Date.parse(range.startIso) && t < Date.parse(range.endIso);
}

const PERIODS: readonly string[] = ["today", "7d", "30d", "90d", "custom"];
const ORIGINS: readonly string[] = ["inbound", "proactive", "manual"];

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

/** Filtros desde los parámetros de la URL; lo inválido se ignora. */
export function parseMetricFilters(params: Record<string, string | string[] | undefined>): MetricFilters {
  const period = first(params.period);
  const origin = first(params.origin);
  return {
    period: period && PERIODS.includes(period) ? (period as MetricPeriod) : DEFAULT_PERIOD,
    from: first(params.from),
    to: first(params.to),
    caseTypeId: first(params.type),
    teamId: first(params.team),
    assigneeId: first(params.agent),
    channel: first(params.channel),
    origin: origin && ORIGINS.includes(origin) ? (origin as MetricOrigin) : undefined,
    contactTypeId: first(params.ctype),
  };
}
