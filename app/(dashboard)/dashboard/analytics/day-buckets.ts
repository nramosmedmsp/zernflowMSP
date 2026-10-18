// Agrupación de la analítica por día calendario en hora de Lima.
//
// Antes los días se calculaban con `toISOString().split("T")[0]` (UTC), de modo
// que un evento a las 21:00 en Lima caía en el día siguiente. Aquí todo se
// agrupa y se rotula con el día de America/Lima.

import { APP_TIME_ZONE, formatDate } from "@/lib/format";

const DAY_MS = 86_400_000;

// Lima no usa horario de verano: siempre es UTC-5.
const LIMA_UTC_OFFSET = "-05:00";

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día calendario en Lima como "YYYY-MM-DD". */
export function limaDayKey(value: string | number | Date): string {
  const parts = dayKeyFormat.formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Todos los días de Lima entre dos instantes, ambos incluidos. */
export function limaDayKeys(startIso: string, endIso: string): string[] {
  const first = Date.parse(`${limaDayKey(startIso)}T00:00:00Z`);
  const last = Date.parse(`${limaDayKey(endIso)}T00:00:00Z`);
  const keys: string[] = [];
  for (let t = first; t <= last; t += DAY_MS) {
    keys.push(new Date(t).toISOString().slice(0, 10));
  }
  return keys;
}

/** Rango [inicio del primer día, fin del último día] en hora de Lima, como ISO. */
export function limaRangeFromDays(
  startDay: string,
  endDay: string,
): { start: string; end: string } {
  return {
    start: new Date(`${startDay}T00:00:00.000${LIMA_UTC_OFFSET}`).toISOString(),
    end: new Date(`${endDay}T23:59:59.999${LIMA_UTC_OFFSET}`).toISOString(),
  };
}

/** Rótulo en español ("18 oct 2026") de un día "YYYY-MM-DD" de Lima. */
export function formatDayKey(dayKey: string): string {
  // Mediodía UTC cae el mismo día en Lima (07:00), sin riesgo de saltar de día.
  return formatDate(`${dayKey}T12:00:00Z`);
}
