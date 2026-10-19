// Volumen: mensajes entrantes y gestiones nuevas por día y por hora. Puro.

import { dayRange, limaDayKey, limaWeekdayHour } from "./day";
import { inRange, type PeriodRange } from "./period";
import type { MetricCase, MetricInboundEvent } from "./types";

export const WEEKDAY_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

/** 7 filas (lunes a domingo) por 24 columnas (horas). */
export type HeatMatrix = number[][];

export interface VolumeDay {
  day: string;
  messages: number;
  cases: number;
}

export interface VolumeReport {
  daily: VolumeDay[];
  messagesMatrix: HeatMatrix;
  casesMatrix: HeatMatrix;
  totalMessages: number;
  totalCases: number;
  /** Máximo de cada matriz (para escalar el color). */
  maxMessages: number;
  maxCases: number;
}

export function emptyMatrix(): HeatMatrix {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

function maxOf(m: HeatMatrix): number {
  return m.reduce((acc, row) => Math.max(acc, ...row), 0);
}

export function buildVolume(
  inbound: readonly MetricInboundEvent[],
  newCases: readonly MetricCase[],
  range: PeriodRange,
): VolumeReport {
  const days = dayRange(range.startDay, range.endDay);
  const daily = new Map<string, VolumeDay>(days.map((d) => [d, { day: d, messages: 0, cases: 0 }]));
  const messagesMatrix = emptyMatrix();
  const casesMatrix = emptyMatrix();
  let totalMessages = 0;
  let totalCases = 0;

  for (const e of inbound) {
    if (!inRange(e.created_at, range)) continue;
    const row = daily.get(limaDayKey(e.created_at));
    if (row) row.messages += 1;
    const { weekday, hour } = limaWeekdayHour(e.created_at);
    messagesMatrix[weekday][hour] += 1;
    totalMessages += 1;
  }
  for (const c of newCases) {
    if (!c.opened_at || !inRange(c.opened_at, range)) continue;
    const row = daily.get(limaDayKey(c.opened_at));
    if (row) row.cases += 1;
    const { weekday, hour } = limaWeekdayHour(c.opened_at);
    casesMatrix[weekday][hour] += 1;
    totalCases += 1;
  }

  return {
    daily: [...daily.values()],
    messagesMatrix,
    casesMatrix,
    totalMessages,
    totalCases,
    maxMessages: maxOf(messagesMatrix),
    maxCases: maxOf(casesMatrix),
  };
}
