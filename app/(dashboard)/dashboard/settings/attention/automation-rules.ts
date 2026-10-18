// Reglas puras de la parte automática de Atención (docs/FASE-2-TECNICO.md 3 y
// 8): respuesta fuera de horario y reasignación por espera. Valida lo que
// llega del navegador, lo mezcla con el resto de `workspaces.settings` sin
// pisar otras claves y arma la vista previa con la próxima apertura real.

import {
  MAX_MIN_HOURS_BETWEEN,
  MAX_REASSIGN_MINUTES,
  OFF_HOURS_REPLY_MAX,
  formatOpening,
  isWithinHours,
  nextOpening,
  parseOffHoursReply,
  parseReassignAfterMinutes,
  type HolidayDates,
} from "@/lib/business-hours";
import type { BusinessHours, OffHoursReplySettings } from "@/lib/types/database";

export const OFF_HOURS_VARIABLES: readonly { token: string; label: string; hint: string }[] = [
  { token: "{nombre}", label: "Nombre", hint: "El primer nombre del contacto" },
  { token: "{empresa}", label: "Empresa", hint: "El nombre de tu espacio de trabajo" },
  { token: "{apertura}", label: "Apertura", hint: "La próxima apertura, por ejemplo «lunes 9:00»" },
];

export const DEFAULT_OFF_HOURS_TEXT =
  "Hola {nombre}, gracias por escribir a {empresa}. Ahora estamos fuera de horario; te responderemos {apertura}.";

/** Estado de los campos en pantalla (los números como texto, para poder dejarlos vacíos). */
export interface AutomationForm {
  offHoursEnabled: boolean;
  offHoursText: string;
  /** Vacío = una sola vez por gestión. */
  minHoursBetween: string;
  /** Vacío = reasignación desactivada. */
  reassignMinutes: string;
}

export interface AutomationValue {
  offHoursReply: OffHoursReplySettings;
  reassignAfterMinutes: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Lee la configuración automática de `workspaces.settings` con valores por defecto. */
export function automationFromSettings(settings: unknown): AutomationForm {
  const s = asRecord(settings);
  const reply = parseOffHoursReply(s.off_hours_reply);
  const reassign = parseReassignAfterMinutes(s.reassign_after_minutes);
  return {
    offHoursEnabled: reply?.enabled ?? false,
    offHoursText: reply?.text ? reply.text : DEFAULT_OFF_HOURS_TEXT,
    minHoursBetween: reply?.min_hours_between ? String(reply.min_hours_between) : "",
    reassignMinutes: reassign !== null ? String(reassign) : "",
  };
}

/** Variables entre llaves del texto que no existen. */
export function unknownVariables(text: string): string[] {
  const known = new Set(OFF_HOURS_VARIABLES.map((v) => v.token));
  const found = text.match(/\{[^{}\s]*\}/g) ?? [];
  return [...new Set(found.filter((t) => !known.has(t)))];
}

function optionalInt(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isInteger(raw) ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : undefined;
}

/** Valida lo que llega del navegador; devuelve el motivo en español si algo no sirve. */
export function parseAutomationInput(input: unknown): { value: AutomationValue } | { error: string } {
  const i = asRecord(input);
  if (typeof i.offHoursEnabled !== "boolean") return { error: "La opción de respuesta fuera de horario no es válida." };
  const text = typeof i.offHoursText === "string" ? i.offHoursText.trim() : "";
  if (text.length > OFF_HOURS_REPLY_MAX) {
    return { error: `El texto puede tener hasta ${OFF_HOURS_REPLY_MAX} caracteres.` };
  }
  if (i.offHoursEnabled && !text) return { error: "Escribe el texto de la respuesta fuera de horario." };
  const unknown = unknownVariables(text);
  if (unknown.length > 0) {
    return {
      error: `${unknown.join(", ")} no ${unknown.length === 1 ? "es una variable válida" : "son variables válidas"}. Usa {nombre}, {empresa} o {apertura}.`,
    };
  }

  const between = optionalInt(i.minHoursBetween);
  if (between === undefined || (between !== null && (between < 1 || between > MAX_MIN_HOURS_BETWEEN))) {
    return {
      error: `Las horas entre envíos deben ser un número entero de 1 a ${MAX_MIN_HOURS_BETWEEN}, o vacío para enviarla una sola vez por gestión.`,
    };
  }

  const reassign = optionalInt(i.reassignMinutes);
  if (reassign === undefined || (reassign !== null && (reassign < 1 || reassign > MAX_REASSIGN_MINUTES))) {
    return {
      error: `Los minutos de espera deben ser un número entero de 1 a ${MAX_REASSIGN_MINUTES}, o vacío para desactivar la reasignación.`,
    };
  }

  return {
    value: {
      offHoursReply: { enabled: i.offHoursEnabled, text, min_hours_between: between },
      reassignAfterMinutes: reassign,
    },
  };
}

/**
 * Settings nuevos: los actuales con solo `off_hours_reply` y
 * `reassign_after_minutes` cambiados. Conserva el resto de las claves.
 */
export function mergeAutomationSettings(current: unknown, next: AutomationValue): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...asRecord(current), off_hours_reply: next.offHoursReply };
  if (next.reassignAfterMinutes === null) delete merged.reassign_after_minutes;
  else merged.reassign_after_minutes = next.reassignAfterMinutes;
  return merged;
}

/** Reemplaza las variables del texto con valores de ejemplo. */
export function renderOffHoursPreview(
  text: string,
  values: { nombre: string; empresa: string; apertura: string },
): string {
  return text
    .replaceAll("{nombre}", values.nombre)
    .replaceAll("{empresa}", values.empresa)
    .replaceAll("{apertura}", values.apertura);
}

const STEP_MS = 15 * 60_000;
const SCAN_STEPS = 8 * 24 * 4;

/**
 * Cuándo abre la próxima vez que se cierre: si ahora está cerrado, la próxima
 * apertura; si está abierto, la apertura posterior al próximo cierre (lo que
 * vería alguien que escribe fuera de horario). null si no hay horario (24
 * horas) o no vuelve a abrir.
 */
export function previewOpening(
  now: Date,
  hours: BusinessHours | null,
  holidays?: HolidayDates | null,
): string | null {
  if (!hours) return null;
  let at = now.getTime();
  if (isWithinHours(at, hours, holidays)) {
    let closedAt: number | null = null;
    for (let step = 1; step <= SCAN_STEPS; step++) {
      const t = at + step * STEP_MS;
      if (!isWithinHours(t, hours, holidays)) {
        closedAt = t;
        break;
      }
    }
    if (closedAt === null) return null;
    at = closedAt;
  }
  const opening = nextOpening(at, hours, holidays);
  return opening ? formatOpening(opening, now) : null;
}
