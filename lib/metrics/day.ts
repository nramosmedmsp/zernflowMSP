// Días y horas de Lima (UTC-5 todo el año). Puro.

import { addDays, limaDateOf } from "@/lib/cases/dates";

const LIMA_OFFSET_MS = 5 * 3_600_000;

/** Día de Lima "YYYY-MM-DD" de un instante. */
export function limaDayKey(value: string | number | Date): string {
  return limaDateOf(new Date(value));
}

/** Días de Lima entre dos días, ambos incluidos. */
export function dayRange(startDay: string, endDay: string): string[] {
  const out: string[] = [];
  for (let d = startDay; d <= endDay && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Día de la semana (0 = lunes ... 6 = domingo) y hora (0-23) en Lima. */
export function limaWeekdayHour(value: string | number | Date): { weekday: number; hour: number } {
  const shifted = new Date(new Date(value).getTime() - LIMA_OFFSET_MS);
  return { weekday: (shifted.getUTCDay() + 6) % 7, hour: shifted.getUTCHours() };
}

/** "dd/mm/aaaa" en hora de Lima (para CSV); "" si no es fecha. */
export function formatDmy(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "";
  const [y, m, d] = limaDayKey(t).split("-");
  return `${d}/${m}/${y}`;
}
