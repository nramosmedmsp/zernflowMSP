// Palabras clave globales del espacio (baja, alta). Puro: lo usan la entrada de
// mensajes (inbound-pipeline), Configuración y el laboratorio de conversaciones.
//
// Formato guardado en workspaces.global_keywords: lista de objetos
// `{ keyword, action }`, con action "unsubscribe" (baja) o "subscribe" (alta).
// Los datos viejos o dañados se toleran al leer (normalizeGlobalKeywords): un
// texto suelto se entiende como una palabra de baja, y lo que no sirve se descarta.

export type GlobalKeywordAction = "unsubscribe" | "subscribe";

export interface GlobalKeyword {
  keyword: string;
  action?: string;
  flowId?: string;
}

export type GlobalKeywordResult =
  /** Coincidió una palabra con acción de baja o alta: el mensaje no sigue a los flujos. */
  | { handled: true; action: GlobalKeywordAction; keyword: string }
  /** Coincidió una palabra sin acción conocida, o ninguna: el mensaje sigue su camino. */
  | { handled: false; keyword?: string };

/** Acción de las palabras guardadas como texto suelto (formato anterior de Configuración). */
export const DEFAULT_KEYWORD_ACTION: GlobalKeywordAction = "unsubscribe";

export function isKeywordAction(value: unknown): value is GlobalKeywordAction {
  return value === "unsubscribe" || value === "subscribe";
}

/**
 * Convierte lo que haya guardado (textos, objetos, mezcla o basura) en una lista
 * de palabras válida. Nunca lanza: lo que no es texto ni objeto con `keyword`
 * de texto se descarta. Sin repetidos (gana la primera).
 */
export function normalizeGlobalKeywords(raw: unknown): GlobalKeyword[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: GlobalKeyword[] = [];
  for (const item of raw) {
    let entry: GlobalKeyword | null = null;
    if (typeof item === "string") {
      entry = { keyword: item.trim(), action: DEFAULT_KEYWORD_ACTION };
    } else if (item && typeof item === "object" && typeof (item as { keyword?: unknown }).keyword === "string") {
      const obj = item as { keyword: string; action?: unknown; flowId?: unknown };
      entry = { keyword: obj.keyword.trim() };
      if (typeof obj.action === "string") entry.action = obj.action;
      if (typeof obj.flowId === "string") entry.flowId = obj.flowId;
    }
    if (!entry || !entry.keyword) continue;
    const key = entry.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * El texto (sin mayúsculas ni espacios en los extremos) tiene que ser igual a
 * la palabra. Se mira la primera que coincide: si su acción no es de baja ni
 * de alta, el mensaje sigue su camino sin mirar las demás. Tolera ambos
 * formatos guardados y datos corruptos sin lanzar.
 */
export function resolveGlobalKeyword(
  text: string | undefined,
  keywords: unknown,
): GlobalKeywordResult {
  if (typeof text !== "string" || !text) return { handled: false };
  const normalizedText = text.toLowerCase().trim();
  if (!normalizedText) return { handled: false };

  for (const kw of normalizeGlobalKeywords(keywords)) {
    if (normalizedText === kw.keyword.toLowerCase()) {
      if (kw.action === "unsubscribe") return { handled: true, action: "unsubscribe", keyword: kw.keyword };
      if (kw.action === "subscribe") return { handled: true, action: "subscribe", keyword: kw.keyword };
      return { handled: false, keyword: kw.keyword };
    }
  }

  return { handled: false };
}
