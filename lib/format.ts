// Formateo de fechas y números para Perú.
//
// Siempre se fija `timeZone: APP_TIME_ZONE` para que el servidor (UTC en
// Vercel) y el navegador muestren exactamente lo mismo. La salida se arma con
// `formatToParts` para no depender de los separadores que emita cada versión de
// ICU ("oct." con punto, "p. m.", espacios no separables, etc.).

export const APP_LOCALE = "es-PE";
export const APP_TIME_ZONE = "America/Lima";

export type DateInput = string | number | Date | null | undefined;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

const dateFormat = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeFormat = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dayFormat = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "numeric",
  year: "numeric",
});

const numberFormat = new Intl.NumberFormat(APP_LOCALE);

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined) return null;
  // M-4: una fecha de calendario ("2026-10-30") es un día, no la medianoche UTC
  // (que en Lima sería el día anterior): se toma el mediodía de Lima.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = new Date(`${value}T12:00:00-05:00`);
    return Number.isNaN(day.getTime()) ? null : day;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pick(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

function dateText(date: Date): string {
  const parts = dateFormat.formatToParts(date);
  // Sin punto final y en minúsculas: "oct." -> "oct".
  const month = pick(parts, "month").replace(/\.$/, "").toLowerCase();
  return `${pick(parts, "day")} ${month} ${pick(parts, "year")}`;
}

function timeText(date: Date): string {
  const parts = timeFormat.formatToParts(date);
  return `${pick(parts, "hour").padStart(2, "0")}:${pick(parts, "minute").padStart(2, "0")}`;
}

/** "18 oct 2026" */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  return date ? dateText(date) : "";
}

/** "18 oct 2026, 14:35" (24 horas) */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  return date ? `${dateText(date)}, ${timeText(date)}` : "";
}

/** "14:35" */
export function formatTime(value: DateInput): string {
  const date = toDate(value);
  return date ? timeText(date) : "";
}

/** Número de día calendario en America/Lima (para comparar días, no horas). */
function limaDayNumber(date: Date): number {
  const parts = dayFormat.formatToParts(date);
  return Math.round(
    Date.UTC(
      Number(pick(parts, "year")),
      Number(pick(parts, "month")) - 1,
      Number(pick(parts, "day")),
    ) / DAY_MS,
  );
}

/**
 * Fecha relativa a `now`, simétrica para pasado y futuro.
 *
 * - menos de 1 min: "ahora"
 * - menos de 1 h: "hace 5 min" / "en 5 min"
 * - mismo día calendario en Lima: "hace 2 h" / "en 2 h"
 * - otro día: "ayer" / "mañana" (por día calendario, no por 24 h)
 * - 2 a 6 días: "hace 3 días" / "en 3 días"
 * - desde 7 días: fecha absoluta (`formatDate`)
 */
export function formatRelative(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  const ref = toDate(now);
  if (!date || !ref) return "";

  const diffMs = date.getTime() - ref.getTime();
  const abs = Math.abs(diffMs);
  const future = diffMs > 0;

  if (abs < MINUTE_MS) return "ahora";

  if (abs < HOUR_MS) {
    const min = Math.floor(abs / MINUTE_MS);
    return future ? `en ${min} min` : `hace ${min} min`;
  }

  const dayDiff = limaDayNumber(date) - limaDayNumber(ref);

  if (dayDiff === 0) {
    const h = Math.floor(abs / HOUR_MS);
    return future ? `en ${h} h` : `hace ${h} h`;
  }

  if (dayDiff === -1) return "ayer";
  if (dayDiff === 1) return "mañana";

  const days = Math.abs(dayDiff);
  if (days >= 7) return dateText(date);
  return future ? `en ${days} días` : `hace ${days} días`;
}

/** "1 contacto" / "2 contactos": el sustantivo concuerda con la cantidad. */
export function pluralize(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** Número con separadores es-PE; "" si no es un número finito. */
export function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (typeof n === "string" && n.trim() === "") return "";
  const num = Number(n);
  return Number.isFinite(num) ? numberFormat.format(num) : "";
}

/**
 * Teléfono para mostrar: "+51 987 654 321" para celulares de Perú, "+" y los
 * dígitos para el resto. "" si no parece un teléfono (por ejemplo, el id que
 * WhatsApp usa cuando el cliente oculta su número).
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value || /[a-z]/i.test(value)) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  if (digits.length === 11 && digits.startsWith("519")) {
    return `+51 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  if (digits.length === 9 && digits.startsWith("9")) {
    return `+51 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return `+${digits}`;
}
