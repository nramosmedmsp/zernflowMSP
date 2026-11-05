// Reglas puras de la pantalla de Horarios (docs/FASE-2-TECNICO.md 8): edición
// del borrador semanal, validación (misma regla que is_valid_business_hours,
// vía lib/business-hours.ts) y fusión con el resto de `workspaces.settings`.
// Sin E/S ni React: probado con vitest.

import {
  MAX_RANGES_PER_DAY,
  PERU_HOLIDAYS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  isHolidayDate,
  parseBusinessHours,
  validateBusinessHours,
  type BusinessHours,
  type TimeRange,
  type Weekday,
} from "@/lib/business-hours";

/** Borrador en pantalla: todos los días presentes; [] = cerrado. */
export type HoursDraft = Record<Weekday, TimeRange[]>;

export const DEFAULT_RANGE: TimeRange = ["09:00", "18:00"];
export const HOLIDAY_NAME_MAX = 200;

export function emptyDraft(): HoursDraft {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

/** Borrador a partir de lo guardado (descarta tramos mal formados). */
export function draftFromHours(raw: unknown): HoursDraft {
  const parsed = parseBusinessHours(raw);
  const draft = emptyDraft();
  if (!parsed) return draft;
  for (const day of WEEKDAYS) draft[day] = (parsed[day] ?? []).map((r) => [r[0], r[1]] as TimeRange);
  return draft;
}

/** Lo que se envía al servidor: solo los días con tramos. */
export function draftToPayload(draft: HoursDraft): BusinessHours {
  const out: BusinessHours = {};
  for (const day of WEEKDAYS) {
    if (draft[day].length > 0) out[day] = draft[day].map((r) => [r[0], r[1]] as TimeRange);
  }
  return out;
}

export function draftHasRanges(draft: HoursDraft): boolean {
  return WEEKDAYS.some((d) => draft[d].length > 0);
}

/** B-8: ¿algún tramo empieza y termina a la misma hora? (no se puede guardar). */
export function draftHasInvalidRange(draft: HoursDraft): boolean {
  return WEEKDAYS.some((d) => draft[d].some((r) => r[0] === r[1]));
}

/** Copia los tramos de un día a otros (reemplaza lo que tuvieran). */
export function copyDay(draft: HoursDraft, from: Weekday, to: readonly Weekday[]): HoursDraft {
  const next: HoursDraft = { ...draft };
  const source = draft[from].map((r) => [r[0], r[1]] as TimeRange);
  for (const day of to) {
    if (day === from) continue;
    next[day] = source.map((r) => [r[0], r[1]] as TimeRange);
  }
  return next;
}

/**
 * Agrega un tramo: empieza donde termina el último (hasta 4 horas, sin pasar
 * de las 24:00) o, si no cabe, usa el tramo por defecto.
 */
export function addRange(draft: HoursDraft, day: Weekday): HoursDraft {
  if (draft[day].length >= MAX_RANGES_PER_DAY) return draft;
  const last = draft[day][draft[day].length - 1];
  let range: TimeRange = [DEFAULT_RANGE[0], DEFAULT_RANGE[1]];
  if (last && last[0] < last[1] && last[1] !== "24:00") {
    const [h, m] = last[1].split(":").map(Number);
    const start = h * 60 + m;
    if (start < 23 * 60) {
      const end = Math.min(start + 4 * 60, 24 * 60);
      range = [last[1], end === 24 * 60 ? "24:00" : formatClock(end)];
    }
  }
  return { ...draft, [day]: [...draft[day], range] };
}

function formatClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function updateRange(draft: HoursDraft, day: Weekday, index: number, range: TimeRange): HoursDraft {
  return { ...draft, [day]: draft[day].map((r, i) => (i === index ? range : r)) };
}

export function removeRange(draft: HoursDraft, day: Weekday, index: number): HoursDraft {
  return { ...draft, [day]: draft[day].filter((_, i) => i !== index) };
}

/** Marca un día como cerrado, o lo abre con el tramo por defecto. */
export function setDayClosed(draft: HoursDraft, day: Weekday, closed: boolean): HoursDraft {
  if (closed) return { ...draft, [day]: [] };
  return draft[day].length > 0 ? draft : { ...draft, [day]: [[...DEFAULT_RANGE] as TimeRange] };
}

/** Si no hay ningún tramo, abre de lunes a viernes con el tramo por defecto. */
export function openWeekdaysIfEmpty(draft: HoursDraft): HoursDraft {
  if (draftHasRanges(draft)) return draft;
  const next = { ...draft };
  for (const day of ["mon", "tue", "wed", "thu", "fri"] as const) next[day] = [[DEFAULT_RANGE[0], DEFAULT_RANGE[1]]];
  return next;
}

export function sameDraft(a: HoursDraft, b: HoursDraft): boolean {
  return JSON.stringify(draftToPayload(a)) === JSON.stringify(draftToPayload(b));
}

export type HoursScope = "company" | "team";

export type HoursCheck = { ok: true; value: BusinessHours | null } | { ok: false; error: string };

/**
 * Valida lo que llega del navegador. Empresa: sin tramos = 24 horas (null).
 * Equipo: null = "usar el horario de la empresa"; un horario propio necesita
 * al menos un tramo.
 */
export function checkHoursInput(raw: unknown, scope: HoursScope): HoursCheck {
  const checked = validateBusinessHours(raw);
  if (!checked.ok) return checked;
  if (scope === "team" && raw !== null && raw !== undefined && checked.value === null) {
    return {
      ok: false,
      error: "Agrega al menos un tramo de atención o elige usar el horario de la empresa.",
    };
  }
  return checked;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Settings nuevos: los actuales con solo `business_hours` cambiado (se quita si es null). */
export function mergeBusinessHoursSettings(current: unknown, hours: BusinessHours | null): Record<string, unknown> {
  const next = { ...asRecord(current) };
  if (hours) next.business_hours = hours;
  else delete next.business_hours;
  return next;
}

/** Texto corto de un día para el resumen ("09:00-13:00, 14:00-19:00" o "Cerrado"). */
export function describeDay(ranges: readonly TimeRange[]): string {
  if (ranges.length === 0) return "Cerrado";
  return ranges.map((r) => `${r[0]}-${r[1]}`).join(", ");
}

export function dayLabel(day: Weekday): string {
  const label = WEEKDAY_LABELS[day];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ── Feriados ───────────────────────────────────────────────────────────────

export function cleanHolidayName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, HOLIDAY_NAME_MAX) : "";
}

export type HolidayCheck = { ok: true; date: string; name: string } | { ok: false; error: string };

export function checkHolidayInput(date: unknown, name: unknown): HolidayCheck {
  if (!isHolidayDate(date)) return { ok: false, error: "Elige una fecha válida." };
  const clean = cleanHolidayName(name);
  if (!clean) return { ok: false, error: "Escribe el nombre del feriado." };
  return { ok: true, date, name: clean };
}

export const MIN_HOLIDAY_YEAR = 2000;
export const MAX_HOLIDAY_YEAR = 2100;

export function isHolidayYear(year: unknown): year is number {
  return Number.isInteger(year) && (year as number) >= MIN_HOLIDAY_YEAR && (year as number) <= MAX_HOLIDAY_YEAR;
}

/** Feriados de Perú del año que todavía no existen (por fecha) en la lista dada. */
export function missingPeruHolidays(
  year: number,
  existingDates: readonly string[],
): { date: string; name: string }[] {
  const have = new Set(existingDates.map((d) => d.slice(0, 10)));
  return PERU_HOLIDAYS(year).filter((h) => !have.has(h.date));
}
