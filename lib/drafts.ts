// Borradores de la caja de texto: lo escrito y no enviado se guarda por
// persona, empresa, chat y modo (mensaje o nota) en el navegador, y vence a
// los 7 días. Como varias personas pueden usar la misma PC, la clave incluye
// al usuario y los borradores se borran al cerrar sesión.

export type DraftMode = "message" | "note";

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export const DRAFT_PREFIX = "zf:draft:v1:";
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface DraftScope {
  userId: string;
  workspaceId: string;
}

function draftKey(scope: DraftScope, conversationId: string, mode: DraftMode): string {
  return `${DRAFT_PREFIX}${scope.userId}:${scope.workspaceId}:${conversationId}:${mode}`;
}

interface Stored {
  text: string;
  at: number;
}

function parse(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Stored;
    return typeof v?.text === "string" && typeof v?.at === "number" ? v : null;
  } catch {
    return null;
  }
}

// El almacenamiento puede no existir o fallar (modo privado, cuota): nunca rompe la caja.
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function readDraft(
  storage: DraftStorage | null,
  scope: DraftScope,
  conversationId: string,
  mode: DraftMode,
  now = Date.now(),
): string {
  if (!storage) return "";
  return safe(() => {
    const key = draftKey(scope, conversationId, mode);
    const v = parse(storage.getItem(key));
    if (!v) return "";
    if (now - v.at > DRAFT_TTL_MS) {
      storage.removeItem(key);
      return "";
    }
    return v.text;
  }, "");
}

export function writeDraft(
  storage: DraftStorage | null,
  scope: DraftScope,
  conversationId: string,
  mode: DraftMode,
  text: string,
  now = Date.now(),
): void {
  if (!storage) return;
  safe(() => {
    const key = draftKey(scope, conversationId, mode);
    if (text.trim()) storage.setItem(key, JSON.stringify({ text, at: now } satisfies Stored));
    else storage.removeItem(key);
  }, undefined);
}

function keysWithPrefix(storage: DraftStorage, prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  return keys;
}

/** Chats de esta persona con borrador de mensaje (para marcarlos en la lista). */
export function draftConversationIds(storage: DraftStorage | null, scope: DraftScope, now = Date.now()): Map<string, string> {
  const result = new Map<string, string>();
  if (!storage) return result;
  return safe(() => {
    const prefix = `${DRAFT_PREFIX}${scope.userId}:${scope.workspaceId}:`;
    for (const key of keysWithPrefix(storage, prefix)) {
      if (!key.endsWith(":message")) continue;
      const v = parse(storage.getItem(key));
      if (!v || now - v.at > DRAFT_TTL_MS || !v.text.trim()) continue;
      result.set(key.slice(prefix.length, -":message".length), v.text);
    }
    return result;
  }, result);
}

/** Al cerrar sesión: borra los borradores de esa persona. */
export function clearUserDrafts(storage: DraftStorage | null, userId: string): void {
  if (!storage) return;
  safe(() => {
    for (const key of keysWithPrefix(storage, `${DRAFT_PREFIX}${userId}:`)) storage.removeItem(key);
  }, undefined);
}
