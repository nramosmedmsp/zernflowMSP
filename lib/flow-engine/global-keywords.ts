// Palabras clave globales del espacio (baja, alta). Puro: lo usan la entrada de
// mensajes (inbound-pipeline) y el laboratorio de conversaciones.

export interface GlobalKeyword {
  keyword: string;
  action?: string;
  flowId?: string;
}

export type GlobalKeywordResult =
  /** Coincidió una palabra con acción de baja o alta: el mensaje no sigue a los flujos. */
  | { handled: true; action: "unsubscribe" | "subscribe"; keyword: string }
  /** Coincidió una palabra sin acción conocida, o ninguna: el mensaje sigue su camino. */
  | { handled: false; keyword?: string };

/**
 * El texto (sin mayúsculas ni espacios en los extremos) tiene que ser igual a
 * la palabra. Se mira la primera que coincide: si su acción no es de baja ni
 * de alta, el mensaje sigue su camino sin mirar las demás.
 */
export function resolveGlobalKeyword(
  text: string | undefined,
  keywords: readonly GlobalKeyword[] | null | undefined,
): GlobalKeywordResult {
  if (!text || !keywords) return { handled: false };
  const normalizedText = text.toLowerCase().trim();

  for (const kw of keywords) {
    if (normalizedText === kw.keyword.toLowerCase()) {
      if (kw.action === "unsubscribe") return { handled: true, action: "unsubscribe", keyword: kw.keyword };
      if (kw.action === "subscribe") return { handled: true, action: "subscribe", keyword: kw.keyword };
      return { handled: false, keyword: kw.keyword };
    }
  }

  return { handled: false };
}
