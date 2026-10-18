// Horarios de atención (docs/FASE-2-TECNICO.md 2). Puro, sin E/S, probado
// con vitest. Todo en hora de Lima (UTC-5 todo el año, sin horario de verano).
//
// - Sin horario configurado (null, o sin ningún tramo) = 24 horas todos los
//   días; en ese caso los feriados no aplican (cierran un horario, no lo crean).
// - Un día ausente o con [] está cerrado.
// - Un tramo cuyo fin es menor que el inicio cruza la medianoche y termina al
//   día siguiente; ese tramo pertenece al día en que empieza (si ese día es
//   feriado, no se atiende ninguna parte del tramo). "24:00" es fin de día.
// - Los tramos que se solapan (incluido uno nocturno con el primero del día
//   siguiente) se unen: nunca se cuenta dos veces el mismo minuto.

import type {
  BusinessHours,
  OffHoursReplySettings,
  TimeRange,
  Weekday,
} from "@/lib/types/database";

export type { BusinessHours, OffHoursReplySettings, TimeRange, Weekday };

/** Orden lunes a domingo (como se muestran). */
export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "lunes",
  tue: "martes",
  wed: "miércoles",
  thu: "jueves",
  fri: "viernes",
  sat: "sábado",
  sun: "domingo",
};

/** getUTCDay() (0 = domingo) → clave. */
const DAY_BY_INDEX: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export const MAX_RANGES_PER_DAY = 6;
export const OFF_HOURS_REPLY_MAX = 1000;
export const MAX_REASSIGN_MINUTES = 43_200; // 30 días
export const MAX_MIN_HOURS_BETWEEN = 720; // 30 días

const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000; // medianoche de Lima = 05:00 UTC
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Cuántos días adelante se busca la próxima apertura. */
const SEARCH_DAYS = 400;
/** Tope de días al medir minutos hábiles (10 años). */
const MAX_SPAN_DAYS = 3660;

const START_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const END_RE = /^(?:([01]\d|2[0-3]):([0-5]\d)|(24):(00))$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Feriados: fechas "YYYY-MM-DD" (lista o conjunto). */
export type HolidayDates = readonly string[] | ReadonlySet<string>;

type Interval = [number, number];

// ── Fechas de Lima ──────────────────────────────────────────────────────────

/** Día calendario de Lima ("YYYY-MM-DD") de un instante. */
function limaDate(ms: number): string {
  return new Date(ms - LIMA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instante (ms) de la medianoche de Lima de una fecha "YYYY-MM-DD". */
function limaMidnight(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) + LIMA_OFFSET_MS;
}

function shiftDate(date: string, days: number): string {
  return limaDate(limaMidnight(date) + days * DAY_MS);
}

function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number);
  return DAY_BY_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function toMs(at: Date | string | number): number {
  return at instanceof Date ? at.getTime() : new Date(at).getTime();
}

function toSet(holidays: HolidayDates | null | undefined): ReadonlySet<string> {
  if (!holidays) return new Set();
  return holidays instanceof Set ? holidays : new Set(holidays as readonly string[]);
}

// ── Lectura y validación ────────────────────────────────────────────────────

function minutesOf(value: string, re: RegExp): number | null {
  const m = re.exec(value);
  if (!m) return null;
  const h = Number(m[1] ?? m[3]);
  const min = Number(m[2] ?? m[4]);
  return h * 60 + min;
}

/** [inicio, fin] en minutos desde la medianoche del día; fin > inicio (+1440 si cruza la medianoche). */
function rangeMinutes(range: unknown): [number, number] | null {
  if (!Array.isArray(range) || range.length !== 2) return null;
  const [a, b] = range;
  if (typeof a !== "string" || typeof b !== "string") return null;
  const start = minutesOf(a, START_RE);
  const end = minutesOf(b, END_RE);
  if (start === null || end === null || start === end) return null;
  return [start, end > start ? end : end + 1440];
}

/** ¿Tiene al menos un tramo? (si no, se considera "sin horario" = 24 horas). */
export function hasSchedule(hours: BusinessHours | null | undefined): hours is BusinessHours {
  if (!hours) return false;
  return WEEKDAYS.some((d) => (hours[d]?.length ?? 0) > 0);
}

/**
 * Lee un horario guardado (teams.business_hours o settings.business_hours).
 * Descarta los tramos mal formados; si no queda ninguno, devuelve null (24 h).
 */
export function parseBusinessHours(raw: unknown): BusinessHours | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const result: BusinessHours = {};
  for (const day of WEEKDAYS) {
    const ranges = source[day];
    if (!Array.isArray(ranges)) continue;
    const valid = ranges
      .filter((r) => rangeMinutes(r) !== null)
      .map((r) => [r[0], r[1]] as TimeRange)
      .slice(0, MAX_RANGES_PER_DAY);
    if (valid.length > 0) result[day] = valid;
  }
  return hasSchedule(result) ? result : null;
}

export type BusinessHoursValidation =
  | { ok: true; value: BusinessHours | null }
  | { ok: false; error: string };

/**
 * Valida un horario escrito en la pantalla de Horarios. Devuelve el horario
 * normalizado (días en orden, tramos ordenados por inicio) o el error en
 * español. Un horario sin tramos es válido y significa "sin horario".
 */
export function validateBusinessHours(raw: unknown): BusinessHoursValidation {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "El horario no tiene un formato válido." };
  }
  const source = raw as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!(WEEKDAYS as readonly string[]).includes(key)) {
      return { ok: false, error: `"${key}" no es un día válido.` };
    }
  }
  const value: BusinessHours = {};
  for (const day of WEEKDAYS) {
    const ranges = source[day];
    if (ranges === undefined || ranges === null) continue;
    const label = WEEKDAY_LABELS[day];
    if (!Array.isArray(ranges)) return { ok: false, error: `El horario del ${label} no es válido.` };
    if (ranges.length > MAX_RANGES_PER_DAY) {
      return { ok: false, error: `El ${label} admite hasta ${MAX_RANGES_PER_DAY} tramos.` };
    }
    const parsed: { range: TimeRange; minutes: [number, number] }[] = [];
    for (const r of ranges) {
      const minutes = rangeMinutes(r);
      if (!minutes) {
        return {
          ok: false,
          error: `Revisa el horario del ${label}: cada tramo necesita inicio y fin distintos en formato HH:MM.`,
        };
      }
      parsed.push({ range: [r[0], r[1]], minutes });
    }
    parsed.sort((a, b) => a.minutes[0] - b.minutes[0]);
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i].minutes[0] < parsed[i - 1].minutes[1]) {
        return { ok: false, error: `Los tramos del ${label} se superponen.` };
      }
    }
    if (parsed.length > 0) value[day] = parsed.map((p) => p.range);
  }
  return { ok: true, value: hasSchedule(value) ? value : null };
}

/** Horario efectivo: el del equipo si tiene uno; si no, el de la empresa. */
export function effectiveBusinessHours(teamHours: unknown, workspaceHours: unknown): BusinessHours | null {
  return parseBusinessHours(teamHours) ?? parseBusinessHours(workspaceHours);
}

/** Feriados que aplican a un equipo (los de la empresa más los del equipo). */
export function holidayDatesFor(
  rows: readonly { date: string; team_id: string | null }[],
  teamId: string | null,
): Set<string> {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.team_id === null || (teamId !== null && r.team_id === teamId)) set.add(r.date.slice(0, 10));
  }
  return set;
}

// ── Tramos como intervalos ──────────────────────────────────────────────────

/** Tramos que empiezan en `date` (ms), sin unir. Vacío si es feriado o día cerrado. */
function dayIntervals(date: string, hours: BusinessHours, holidays: ReadonlySet<string>): Interval[] {
  if (holidays.has(date)) return [];
  const ranges = hours[weekdayOf(date)] ?? [];
  const midnight = limaMidnight(date);
  const out: Interval[] = [];
  for (const r of ranges) {
    const minutes = rangeMinutes(r);
    if (minutes) out.push([midnight + minutes[0] * MINUTE_MS, midnight + minutes[1] * MINUTE_MS]);
  }
  return out;
}

function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i[0] <= last[1]) last[1] = Math.max(last[1], i[1]);
    else out.push([i[0], i[1]]);
  }
  return out;
}

/** Intervalos unidos de los tramos que empiezan entre `from` y `to` (fechas de Lima, inclusive). */
function intervalsForDates(from: string, to: string, hours: BusinessHours, holidays: ReadonlySet<string>): Interval[] {
  const all: Interval[] = [];
  let guard = 0;
  for (let d = from; d <= to && guard <= MAX_SPAN_DAYS + 2; d = shiftDate(d, 1), guard++) {
    all.push(...dayIntervals(d, hours, holidays));
  }
  return merge(all);
}

// ── Consultas ───────────────────────────────────────────────────────────────

/** ¿Está abierto en ese instante? Sin horario configurado, siempre. */
export function isWithinHours(
  at: Date | string | number,
  hours: BusinessHours | null | undefined,
  holidays?: HolidayDates | null,
): boolean {
  if (!hasSchedule(hours)) return true;
  const t = toMs(at);
  const today = limaDate(t);
  // El día anterior aporta los tramos que cruzan la medianoche.
  return intervalsForDates(shiftDate(today, -1), today, hours, toSet(holidays)).some(
    ([s, e]) => s <= t && t < e,
  );
}

/**
 * Próxima apertura: `at` si ya está abierto (o no hay horario), o el inicio
 * del siguiente tramo. null si no abre en los próximos 400 días (feriados en
 * todos los días con horario).
 */
export function nextOpening(
  at: Date | string | number,
  hours: BusinessHours | null | undefined,
  holidays?: HolidayDates | null,
): Date | null {
  const t = toMs(at);
  if (!hasSchedule(hours)) return new Date(t);
  const set = toSet(holidays);
  if (isWithinHours(t, hours, set)) return new Date(t);
  const today = limaDate(t);
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const starts = dayIntervals(shiftDate(today, i), hours, set)
      .map(([s]) => s)
      .filter((s) => s > t)
      .sort((a, b) => a - b);
    if (starts.length > 0) return new Date(starts[0]);
  }
  return null;
}

/**
 * Minutos de atención entre `a` y `b` (0 si b <= a). Sin horario, los
 * minutos de reloj. Puede tener decimales (segundos).
 */
export function businessMinutesBetween(
  a: Date | string | number,
  b: Date | string | number,
  hours: BusinessHours | null | undefined,
  holidays?: HolidayDates | null,
): number {
  const from = toMs(a);
  let to = toMs(b);
  if (!(to > from)) return 0;
  if (!hasSchedule(hours)) return (to - from) / MINUTE_MS;
  to = Math.min(to, from + MAX_SPAN_DAYS * DAY_MS);
  const intervals = intervalsForDates(shiftDate(limaDate(from), -1), limaDate(to), hours, toSet(holidays));
  let ms = 0;
  for (const [s, e] of intervals) {
    const overlap = Math.min(e, to) - Math.max(s, from);
    if (overlap > 0) ms += overlap;
  }
  return ms / MINUTE_MS;
}

// ── Texto ───────────────────────────────────────────────────────────────────

function clock(ms: number): string {
  const d = new Date(ms - LIMA_OFFSET_MS);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * Próxima apertura en palabras, en hora de Lima: "hoy 14:00", "mañana 9:00",
 * "lunes 9:00" (dentro de una semana) o "lunes 5 de enero 9:00" (más lejos).
 */
export function formatOpening(at: Date | string | number, now: Date | string | number = new Date()): string {
  const t = toMs(at);
  const date = limaDate(t);
  const today = limaDate(toMs(now));
  const days = Math.round((limaMidnight(date) - limaMidnight(today)) / DAY_MS);
  const time = clock(t);
  if (days === 0) return `hoy ${time}`;
  if (days === 1) return `mañana ${time}`;
  const weekday = WEEKDAY_LABELS[weekdayOf(date)];
  if (days > 1 && days < 7) return `${weekday} ${time}`;
  const [, m, d] = date.split("-").map(Number);
  return `${weekday} ${d} de ${MONTHS[m - 1]} ${time}`;
}

// ── Feriados de Perú ────────────────────────────────────────────────────────

/** Feriados nacionales fijos (alineados con server/calendar.js de Nexo). */
export const PERU_FIXED_HOLIDAYS: readonly { md: string; name: string }[] = [
  { md: "01-01", name: "Año Nuevo" },
  { md: "05-01", name: "Día del Trabajo" },
  { md: "06-07", name: "Batalla de Arica y Día de la Bandera" },
  { md: "06-29", name: "San Pedro y San Pablo" },
  { md: "07-23", name: "Día de la Fuerza Aérea del Perú" },
  { md: "07-28", name: "Fiestas Patrias" },
  { md: "07-29", name: "Fiestas Patrias" },
  { md: "08-06", name: "Batalla de Junín" },
  { md: "08-30", name: "Santa Rosa de Lima" },
  { md: "10-08", name: "Combate de Angamos" },
  { md: "11-01", name: "Día de Todos los Santos" },
  { md: "12-08", name: "Inmaculada Concepción" },
  { md: "12-09", name: "Batalla de Ayacucho" },
  { md: "12-25", name: "Navidad" },
];

/** Domingo de Pascua (algoritmo gregoriano anónimo), "YYYY-MM-DD". */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Feriados nacionales de Perú de un año: los fijos más Jueves y Viernes
 * Santo, ordenados por fecha. Verificar cada año (el gobierno puede agregar
 * días no laborables, que se cargan a mano).
 */
export function PERU_HOLIDAYS(year: number): { date: string; name: string }[] {
  const easter = easterSunday(year);
  const list = [
    ...PERU_FIXED_HOLIDAYS.map((h) => ({ date: `${year}-${h.md}`, name: h.name })),
    { date: shiftDate(easter, -3), name: "Jueves Santo" },
    { date: shiftDate(easter, -2), name: "Viernes Santo" },
  ];
  return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ── Configuración de atención (workspaces.settings) ─────────────────────────

/** ¿Es una fecha "YYYY-MM-DD" válida? */
export function isHolidayDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** settings.off_hours_reply normalizado, o null si no está o no sirve. */
export function parseOffHoursReply(raw: unknown): OffHoursReplySettings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text.trim().slice(0, OFF_HOURS_REPLY_MAX) : "";
  const between = typeof r.min_hours_between === "number" ? r.min_hours_between : Number(r.min_hours_between);
  return {
    enabled: r.enabled === true,
    text,
    min_hours_between:
      Number.isFinite(between) && between > 0 ? Math.min(between, MAX_MIN_HOURS_BETWEEN) : null,
  };
}

/** settings.reassign_after_minutes: entero positivo, o null (desactivada). */
export function parseReassignAfterMinutes(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_REASSIGN_MINUTES) return null;
  return n;
}
