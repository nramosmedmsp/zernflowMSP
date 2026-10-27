// Respuestas guardadas (docs/PLAN-CRM.md 7.4): reglas puras, sin dependencias
// de servidor, para probarlas con vitest y usarlas en la bandeja, el
// selector y las acciones del servidor.

import { APP_LOCALE, APP_TIME_ZONE } from "@/lib/format";
import { firstName } from "@/lib/names";

export type SavedReplyScopeKey = "workspace" | "team" | "personal";

/** Datos para reemplazar las variables de una respuesta. */
export interface ReplyContext {
  contactName?: string;
  agentName?: string;
  /** Nombre del equipo (`{sede}`). */
  teamName?: string;
  workspaceName?: string;
  /** Campos personalizados del contacto, por slug (`{campo:slug}`). */
  customFields?: Record<string, string>;
  /** Momento de pegar la respuesta (`{saludo}` y `{hoy}`, en hora de Lima). */
  now?: Date;
}

export interface ReplyVariable {
  token: string;
  label: string;
}

/** Variables que se pueden insertar desde el formulario. */
export const REPLY_VARIABLES: readonly ReplyVariable[] = [
  { token: "{primer_nombre}", label: "Primer nombre del contacto" },
  { token: "{saludo}", label: "Buenos días, Buenas tardes o Buenas noches según la hora de Lima" },
  { token: "{nombre}", label: "Nombre completo del contacto" },
  { token: "{asesor}", label: "Tu nombre" },
  { token: "{sede}", label: "Sede o equipo" },
  { token: "{empresa}", label: "Empresa" },
  { token: "{hoy}", label: "Fecha de hoy, por ejemplo «lunes 27 de octubre»" },
];

export const SAVED_REPLY_TITLE_MAX = 200;
export const SAVED_REPLY_BODY_MAX = 4000;
export const SHORTCUT_MAX = 30;

const EMPTY = "\u0000";
const VARIABLE_RE = /\{(nombre|primer_nombre|asesor|sede|empresa|saludo|hoy|campo:([a-z0-9_-]+))\}/gi;

const hourFormat = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, hour: "numeric", hourCycle: "h23" });
const longDayFormat = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** "Buenos días" (5:00 a 11:59), "Buenas tardes" (12:00 a 18:59) o "Buenas noches", en hora de Lima. */
export function greetingFor(now: Date): string {
  const hour = Number(hourFormat.format(now));
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

/** "lunes 27 de octubre", en hora de Lima. */
export function longDayFor(now: Date): string {
  const parts = Object.fromEntries(longDayFormat.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} de ${parts.month}`;
}

function clean(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function customFieldValue(fields: Record<string, string> | undefined, slug: string): string {
  if (!fields) return "";
  const wanted = slug.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(fields, slug)) return clean(fields[slug]);
  for (const key of Object.keys(fields)) {
    if (key.toLowerCase() === wanted) return clean(fields[key]);
  }
  return "";
}

/**
 * Reemplaza las variables de REPLY_VARIABLES y `{campo:slug}`. Las variables
 * sin valor quedan vacías, sin llaves y sin dejar espacios dobles ni espacios
 * antes de la puntuación ("Hola {nombre}, ..." con el nombre vacío queda
 * "Hola, ..."); `empty` dice cuáles fueron, para avisar al asesor. Lo que no
 * es una variable conocida no se toca.
 */
export function applyReplyVariablesDetailed(
  text: string,
  context: ReplyContext = {},
): { text: string; empty: string[] } {
  const empty: string[] = [];
  let result = text.replace(VARIABLE_RE, (match: string, name: string, slug?: string) => {
    let value = "";
    if (slug) value = customFieldValue(context.customFields, slug);
    else {
      switch (name.toLowerCase()) {
        case "nombre":
          value = clean(context.contactName);
          break;
        case "primer_nombre":
          value = firstName(context.contactName);
          break;
        case "asesor":
          value = clean(context.agentName);
          break;
        case "sede":
          value = clean(context.teamName);
          break;
        case "empresa":
          value = clean(context.workspaceName);
          break;
        case "saludo":
          value = greetingFor(context.now ?? new Date());
          break;
        case "hoy":
          value = longDayFor(context.now ?? new Date());
          break;
      }
    }
    if (!value && !empty.includes(match.toLowerCase())) empty.push(match.toLowerCase());
    return value || EMPTY;
  });

  if (!result.includes(EMPTY)) return { text: result, empty };

  // Al inicio de una línea: "{nombre}, hola" -> "hola".
  result = result.replace(/^[ \t]*\u0000[ \t]*[,;:]?[ \t]*/gm, "");
  // Antes de puntuación: "Hola {nombre}!" -> "Hola!".
  result = result.replace(/[ \t]*\u0000(?=[,.;:!?])/g, "");
  // Entre espacios: "a {x} b" -> "a b".
  result = result.replace(/([ \t])\u0000[ \t]+/g, "$1");
  // Al final de una línea: "Hola {nombre}" -> "Hola".
  result = result.replace(/[ \t]*\u0000[ \t]*$/gm, "");
  return { text: result.replace(/\u0000/g, ""), empty };
}

/** Igual que applyReplyVariablesDetailed, solo el texto. */
export function applyReplyVariables(text: string, context: ReplyContext = {}): string {
  return applyReplyVariablesDetailed(text, context).text;
}

/**
 * Llaves que quedaron en un mensaje ("{nombre}", "{precio}"): el cliente las
 * vería tal cual. Para avisar antes de enviar.
 */
export function findUnresolvedPlaceholders(text: string): string[] {
  const found = text.match(/\{[a-z_][a-z0-9_:-]*\}/gi) ?? [];
  return [...new Set(found)];
}

/**
 * Búsqueda de respuesta en curso: el texto entre una "/" (al inicio o tras un
 * espacio) y el cursor, sin saltos de línea. null si no hay.
 */
export function slashQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const slash = before.lastIndexOf("/");
  if (slash < 0) return null;
  if (slash > 0 && !/\s/.test(before[slash - 1])) return null;
  const query = before.slice(slash + 1);
  if (/^\s/.test(query) || query.includes("\n") || query.length > 40 || /\s{2}/.test(query)) return null;
  return { start: slash, query };
}

/** Reemplaza [start, end) por `insert` y devuelve el texto y la nueva posición del cursor. */
export function replaceRange(text: string, start: number, end: number, insert: string): { value: string; caret: number } {
  return { value: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}

/** Minúsculas y sin tildes, para buscar sin distinguirlas. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export interface SearchableReply {
  id: string;
  title: string;
  shortcut: string | null;
  caseTypeId: string | null;
  /** Texto de la respuesta: también se busca en él, con menor prioridad. */
  body?: string;
}

function shortcutKey(shortcut: string | null | undefined): string {
  return normalizeSearch((shortcut ?? "").replace(/^\/+/, ""));
}

/** 0 = mejor coincidencia, null = no coincide. */
function matchRank(reply: SearchableReply, tokens: string[]): number | null {
  const title = normalizeSearch(reply.title);
  const shortcut = shortcutKey(reply.shortcut);
  const titleWords = title.split(/\s+/);
  let body: string | null = null;
  let worst = 0;

  for (const token of tokens) {
    let rank: number | null = null;
    if (shortcut && shortcut === token) rank = 0;
    else if (shortcut && shortcut.startsWith(token)) rank = 1;
    else if (title.startsWith(token)) rank = 2;
    else if (titleWords.some((w) => w.startsWith(token))) rank = 3;
    else if (shortcut.includes(token) || title.includes(token)) rank = 4;
    else if (reply.body && (body ??= normalizeSearch(reply.body)).includes(token)) rank = 5;
    if (rank === null) return null;
    worst = Math.max(worst, rank);
  }
  return worst;
}

/**
 * Filtra por título, atajo y texto (sin tildes ni mayúsculas; la barra inicial
 * del atajo es opcional; el texto pesa menos). Con `caseTypeId`, las respuestas ligadas a ese tipo de
 * gestión salen primero. Sin búsqueda devuelve todas, en el mismo orden.
 */
export function searchSavedReplies<T extends SearchableReply>(
  replies: readonly T[],
  query: string,
  caseTypeId?: string | null,
): T[] {
  const tokens = normalizeSearch(query.replace(/^\s*\/+/, ""))
    .split(/\s+/)
    .filter(Boolean);

  const ranked: Array<{ reply: T; rank: number; boost: number; title: string }> = [];
  for (const reply of replies) {
    const rank = tokens.length ? matchRank(reply, tokens) : 0;
    if (rank === null) continue;
    ranked.push({
      reply,
      rank,
      boost: caseTypeId && reply.caseTypeId === caseTypeId ? 0 : 1,
      title: normalizeSearch(reply.title),
    });
  }

  ranked.sort((a, b) => a.boost - b.boost || a.rank - b.rank || a.title.localeCompare(b.title));
  return ranked.map((r) => r.reply);
}

export type ShortcutResult = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Normaliza el atajo a `/palabra` (minúsculas, sin tildes, letras, números,
 * guion y guion bajo). Vacío = sin atajo.
 */
export function normalizeShortcut(raw: string | null | undefined): ShortcutResult {
  const text = normalizeSearch(raw ?? "").replace(/^\/+/, "");
  if (!text) return { ok: true, value: null };
  if (!/^[a-z0-9_-]+$/.test(text)) {
    return { ok: false, error: "El atajo solo puede tener letras, números, guion y guion bajo (por ejemplo /precios)." };
  }
  if (text.length > SHORTCUT_MAX) {
    return { ok: false, error: `El atajo puede tener hasta ${SHORTCUT_MAX} caracteres.` };
  }
  return { ok: true, value: `/${text}` };
}

export interface SavedReplyInput {
  title: string;
  shortcut?: string | null;
  body: string;
  caseTypeId?: string | null;
  /** Con archivo (foto o PDF) el texto es opcional. */
  hasAttachment?: boolean;
}

export type SavedReplyValidation =
  | { ok: true; value: { title: string; shortcut: string | null; body: string; caseTypeId: string | null } }
  | { ok: false; error: string };

export function validateSavedReplyInput(input: SavedReplyInput): SavedReplyValidation {
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, error: "Escribe un título." };
  if (title.length > SAVED_REPLY_TITLE_MAX) {
    return { ok: false, error: `El título puede tener hasta ${SAVED_REPLY_TITLE_MAX} caracteres.` };
  }
  const body = (input.body ?? "").trim();
  if (!body && !input.hasAttachment) return { ok: false, error: "Escribe el texto de la respuesta o adjunta un archivo." };
  if (body.length > SAVED_REPLY_BODY_MAX) {
    return { ok: false, error: `El texto puede tener hasta ${SAVED_REPLY_BODY_MAX} caracteres.` };
  }
  const shortcut = normalizeShortcut(input.shortcut);
  if (!shortcut.ok) return shortcut;
  const caseTypeId = input.caseTypeId && input.caseTypeId.trim() ? input.caseTypeId.trim() : null;
  return { ok: true, value: { title, shortcut: shortcut.value, body, caseTypeId } };
}

/** ¿Ya hay otra respuesta con este atajo en el mismo alcance? */
export function hasShortcutConflict(
  shortcut: string | null,
  others: ReadonlyArray<{ id: string; shortcut: string | null }>,
  ignoreId?: string,
): boolean {
  if (!shortcut) return false;
  const wanted = shortcutKey(shortcut);
  return others.some((o) => o.id !== ignoreId && shortcutKey(o.shortcut) === wanted);
}
