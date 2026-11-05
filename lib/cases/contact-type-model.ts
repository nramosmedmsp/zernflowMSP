// Tipo de contacto: lógica pura (sin base de datos) para la pregunta única del
// chat, el historial de cambios y la inactividad automática. Se usa en el
// servidor, en el cron y en los componentes del navegador, y se prueba con
// vitest. Las operaciones con la base viven en contact-type.ts.

/** De dónde viene un cambio de tipo. null en el historial = nunca (siempre se sabe). */
export type ContactTypeSource = "manual" | "rule" | "inactividad" | "import" | "sistema";

export const CONTACT_TYPE_SOURCES: readonly ContactTypeSource[] = ["manual", "rule", "inactividad", "import", "sistema"];

/** "Preguntar después" calla la pregunta de un contacto durante estos días. */
export const PROMPT_SNOOZE_DAYS = 7;

export const INACTIVITY_MIN_DAYS = 7;
export const INACTIVITY_MAX_DAYS = 3650;
export const INACTIVITY_DEFAULT_DAYS = 90;

/** Largo máximo de la descripción corta de un tipo (coincide con el check de 00036). */
export const DESCRIPTION_MAX = 200;

const DAY_MS = 86_400_000;
const TZ = "America/Lima";

// ── Tipos que viajan a la interfaz ────────────────────────────────────────

export interface ContactTypeOption {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  isDefault: boolean;
  archived?: boolean;
}

/** Un cambio de tipo, leído de `activity` (type = 'contact_type_changed'). */
export interface TypeChange {
  id: string;
  at: string;
  fromId: string | null;
  toId: string | null;
  /** Quién lo hizo; null = automático. */
  actorId: string | null;
  source: ContactTypeSource;
  /** Texto legible del motivo ("2.ª compra ganada"). */
  reasonText: string | null;
  caseId: string | null;
}

/** Lo que la ficha y el chat saben del tipo de un contacto. */
export interface ContactTypeInfo {
  confirmedAt: string | null;
  confirmedBy: string | null;
  snoozedUntil: string | null;
  /** El contacto ya tiene una gestión ganada (la pregunta no corresponde). */
  hasWonCase: boolean;
  /** Más reciente primero. Sin las asignaciones silenciosas del tipo por defecto. */
  history: TypeChange[];
}

// ── Pregunta única del chat ───────────────────────────────────────────────

/**
 * ¿Hay que preguntar "¿Ya nos compró antes?"? Solo si el tipo nunca se
 * confirmó, no se pidió "Preguntar después" (o ya pasaron los 7 días) y el
 * contacto no tiene ninguna gestión ganada (ya compró: es un cliente).
 */
export function shouldAskContactType(
  info: Pick<ContactTypeInfo, "confirmedAt" | "snoozedUntil" | "hasWonCase">,
  now: Date,
): boolean {
  if (info.confirmedAt) return false;
  if (info.hasWonCase) return false;
  if (info.snoozedUntil) {
    const until = new Date(info.snoozedUntil).getTime();
    if (!Number.isNaN(until) && until > now.getTime()) return false;
  }
  return true;
}

/** Instante (ISO) hasta el que se calla la pregunta. */
export function snoozeUntil(now: Date): string {
  return new Date(now.getTime() + PROMPT_SNOOZE_DAYS * DAY_MS).toISOString();
}

/** Primer nombre para hablarle al agente de "María" y no de "María Fernanda Rojas". */
export function firstName(displayName: string | null | undefined): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return first || "este contacto";
}

const MAX_QUESTION_BUTTONS = 3;

/**
 * Botones de la pregunta: primero el tipo por defecto ("Es nuevo · Prospecto"),
 * luego los siguientes por orden; lo que no cabe va en "Otro".
 */
export function questionOptions(types: readonly ContactTypeOption[]): {
  buttons: (ContactTypeOption & { label: string })[];
  overflow: ContactTypeOption[];
} {
  const active = types.filter((t) => !t.archived);
  const def = active.find((t) => t.isDefault) ?? null;
  const ordered = def ? [def, ...active.filter((t) => t.id !== def.id)] : active;
  const visible = ordered.length > MAX_QUESTION_BUTTONS ? ordered.slice(0, MAX_QUESTION_BUTTONS) : ordered;
  return {
    buttons: visible.map((t) => ({ ...t, label: def && t.id === def.id ? `Es nuevo · ${t.name}` : t.name })),
    overflow: ordered.slice(visible.length),
  };
}

// ── Fechas legibles (Lima) ────────────────────────────────────────────────

function limaDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** "hoy", "ayer" o "5 nov" (con año si no es el actual). */
export function whenText(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = limaDay(date);
  if (day === limaDay(now)) return "hoy";
  if (day === limaDay(new Date(now.getTime() - DAY_MS))) return "ayer";
  const sameYear = day.slice(0, 4) === limaDay(now).slice(0, 4);
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  })
    .format(date)
    .replace(/\./g, "");
}

// ── Historial ─────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export interface ActivityRowLike {
  id: number | string;
  created_at: string;
  case_id?: string | null;
  actor_id: string | null;
  from_value: string | null;
  to_value: string | null;
  meta: unknown;
}

/** Fila de `activity` → cambio de tipo. Entiende las filas anteriores a 00036 (solo `meta.reason`). */
export function toTypeChange(row: ActivityRowLike): TypeChange {
  const meta = asRecord(row.meta);
  const rawSource = str(meta.source);
  let source: ContactTypeSource;
  if (rawSource && (CONTACT_TYPE_SOURCES as readonly string[]).includes(rawSource)) {
    source = rawSource as ContactTypeSource;
  } else {
    const legacy = str(meta.reason);
    source =
      legacy === "manual"
        ? "manual"
        : legacy === "rule"
          ? "rule"
          : legacy === "default"
            ? "sistema"
            : row.actor_id
              ? "manual"
              : "sistema";
  }
  return {
    id: String(row.id),
    at: row.created_at,
    fromId: row.from_value,
    toId: row.to_value,
    actorId: row.actor_id,
    source,
    reasonText: str(meta.reason_text),
    caseId: row.case_id ?? null,
  };
}

/** Cambios que se muestran: sin la asignación silenciosa del tipo por defecto al llegar. */
export function visibleChanges(changes: readonly TypeChange[]): TypeChange[] {
  return changes.filter((c) => !(c.source === "sistema" && c.fromId === null));
}

/** ¿Se escribe una línea de sistema en el chat? Las manuales no: las hizo una persona a la vista. */
export function isChatLineChange(change: TypeChange): boolean {
  return change.source === "rule" || change.source === "inactividad" || change.source === "import";
}

export type TypeNameLookup = (id: string | null) => string;

/** "María pasó a Cliente frecuente (2.ª compra ganada)". */
export function chatLineText(change: TypeChange, contactName: string | null | undefined, typeName: TypeNameLookup): string {
  const reason = change.reasonText ?? (change.source === "import" ? "importación" : null);
  return `${firstName(contactName)} pasó a ${typeName(change.toId)}${reason ? ` (${reason})` : ""}`;
}

/** Quién hizo el cambio, para el historial: "Ana" o "automático: 2.ª compra ganada". */
export function changeWho(change: TypeChange, personName: (id: string) => string): string {
  if (change.actorId && change.source !== "inactividad" && change.source !== "rule") {
    return change.source === "import" ? `${personName(change.actorId)}, al importar` : personName(change.actorId);
  }
  const reason = change.reasonText;
  return reason ? `automático: ${reason}` : "automático";
}

/** "Prospecto → Cliente (Ana, hoy)" / "(automático: 1.ª compra ganada, hoy)". */
export function historyLineText(
  change: TypeChange,
  typeName: TypeNameLookup,
  personName: (id: string) => string,
  now: Date = new Date(),
): string {
  return `${typeName(change.fromId)} → ${typeName(change.toId)} (${changeWho(change, personName)}, ${whenText(change.at, now)})`;
}

/**
 * Línea de estado del tipo, arriba de la ficha: "Desde 5 nov · por Ana",
 * "Desde hoy · automático (2.ª compra ganada)" o "Sin confirmar · se asignó solo al llegar".
 */
export function typeStatusText(
  info: Pick<ContactTypeInfo, "confirmedAt" | "history">,
  personName: (id: string) => string,
  now: Date = new Date(),
): string {
  const last = visibleChanges(info.history)[0] ?? null;
  if (last) {
    const when = whenText(last.at, now);
    if (last.actorId && last.source !== "rule" && last.source !== "inactividad") {
      return `Desde ${when} · por ${personName(last.actorId)}`;
    }
    return `Desde ${when} · automático${last.reasonText ? ` (${last.reasonText})` : ""}`;
  }
  if (info.confirmedAt) return `Confirmado ${whenText(info.confirmedAt, now)}`;
  return "Sin confirmar · se asignó solo al llegar";
}

// ── Motivos escritos por el motor ─────────────────────────────────────────

/** 1 → "1.ª", 2 → "2.ª". */
export function ordinalFem(n: number): string {
  return `${n}.ª`;
}

/** Motivo de un cambio por regla al cerrar una venta: "2.ª compra ganada". */
export function ruleReasonText(wonCount: number | null | undefined): string {
  return wonCount && wonCount > 0 ? `${ordinalFem(wonCount)} compra ganada` : "regla de la gestión";
}

/** Motivo del cambio por inactividad: "sin compras hace 95 días". */
export function inactivityReasonText(daysSinceLastWin: number): string {
  return `sin compras hace ${daysSinceLastWin} ${daysSinceLastWin === 1 ? "día" : "días"}`;
}

// ── Inactividad automática (ajuste del espacio) ───────────────────────────

export interface InactivitySettings {
  enabled: boolean;
  /** Tipo al que pasa quien no compra. */
  typeId: string | null;
  days: number;
}

export const INACTIVITY_SETTINGS_KEY = "contact_type_inactivity";
/** Día de Lima de la última pasada completa, y dónde seguir si se cortó. */
export const INACTIVITY_RUN_KEY = "contact_type_inactivity_run";

/** Días válidos (entero entre 7 y 3650) o null. */
export function normalizeInactivityDays(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  return n >= INACTIVITY_MIN_DAYS && n <= INACTIVITY_MAX_DAYS ? n : null;
}

/** `workspaces.settings.contact_type_inactivity` → ajuste completo (apagado si falta o está mal). */
export function parseInactivitySettings(settings: unknown): InactivitySettings {
  const raw = asRecord(asRecord(settings)[INACTIVITY_SETTINGS_KEY]);
  const typeId = str(raw.type_id);
  const days = normalizeInactivityDays(raw.days) ?? INACTIVITY_DEFAULT_DAYS;
  return { enabled: raw.enabled === true && typeId !== null, typeId, days };
}

/** Instante a partir del cual una compra ya cuenta como "hace más de N días". */
export function inactivityCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** Días enteros entre dos instantes. */
export function daysBetween(fromIso: string, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - new Date(fromIso).getTime()) / DAY_MS));
}

/**
 * ¿La inactividad puede mover a este contacto? No si ya tiene ese tipo, ni si una
 * persona lo confirmó (a mano) después del corte: respeta la corrección manual
 * durante N días en vez de deshacerla al día siguiente.
 */
export function canMakeInactive(
  contact: { contact_type_id: string | null; contact_type_confirmed_at?: string | null; contact_type_confirmed_by?: string | null },
  inactiveTypeId: string,
  cutoffIso: string,
): boolean {
  if (contact.contact_type_id === inactiveTypeId) return false;
  const at = contact.contact_type_confirmed_at;
  if (contact.contact_type_confirmed_by && at && new Date(at).getTime() > new Date(cutoffIso).getTime()) return false;
  return true;
}
