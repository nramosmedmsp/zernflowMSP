// Fechas del motor de gestiones, en hora de Lima (UTC-5 todo el año, sin
// horario de verano). Puras, para probarlas con vitest.

const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Hora del día (Lima) a la que se activan las gestiones programadas por fecha. */
export const SCHEDULE_HOUR_LIMA = 9;

/** Ventana para reabrir una gestión cerrada cuando el cliente vuelve a escribir. */
export const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es una fecha "YYYY-MM-DD" real (no 2026-02-30)? */
export function isDateString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Día calendario de Lima ("YYYY-MM-DD") de un instante. */
export function limaDateOf(at: Date): string {
  return new Date(at.getTime() + LIMA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Suma (o resta) días a una fecha "YYYY-MM-DD". */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Instante ISO de esa fecha a la hora indicada en Lima (por defecto 09:00). */
export function limaDateTimeIso(date: string, hour: number = SCHEDULE_HOUR_LIMA): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour) - LIMA_OFFSET_MS).toISOString();
}

/**
 * Fecha en la que se activa una gestión programada: `date` a las 09:00 de
 * Lima, o `now` si eso ya pasó (se activa en la siguiente vuelta del cron).
 */
export function scheduleInstant(date: string, now: Date): string {
  const iso = limaDateTimeIso(date);
  return new Date(iso).getTime() <= now.getTime() ? now.toISOString() : iso;
}

/**
 * Interpreta la fecha elegida por el asesor al cerrar (`overrides.schedule_at`):
 * "YYYY-MM-DD" (a las 09:00 de Lima) o un instante ISO completo. Null si no es
 * válida.
 */
export function parseScheduleAt(value: unknown, now: Date): string | null {
  if (isDateString(value)) return scheduleInstant(value, now);
  if (typeof value !== "string" || !value.includes("T")) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime() <= now.getTime() ? now.toISOString() : date.toISOString();
}

/** Instante ISO válido o null. */
export function parseInstant(value: unknown): string | null {
  if (isDateString(value)) return limaDateTimeIso(value);
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
