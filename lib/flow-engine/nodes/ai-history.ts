// Historial que recibe el nodo "Respuesta con IA". En los canales reales los
// mensajes del chat los guarda Zernio (no la tabla `messages`), así que el
// historial sale de su lista; en los canales de prueba sale de la tabla local.
// Siempre termina con el mensaje que el cliente acaba de escribir.

import { mapZernioMessage, sortMessages, type ZernioListMessage } from "@/lib/inbox-messages";

export type AiMessage = { role: "user" | "assistant"; content: string };

/** Texto que usa la IA cuando el nodo no define sus instrucciones. */
export const DEFAULT_AI_SYSTEM_PROMPT =
  "Eres un asistente de atención al cliente amable y claro. Responde siempre en español, de forma breve y útil. " +
  "Si no sabes algo o el cliente pide hablar con una persona, dilo con honestidad y no inventes datos.";

/** Mensajes de la lista de Zernio (en cualquier orden) → los últimos `limit`, del más antiguo al más nuevo. */
export function aiMessagesFromZernio(raw: readonly ZernioListMessage[], limit: number): AiMessage[] {
  const mapped = raw
    .map((m) => mapZernioMessage(m, ""))
    .filter((m): m is NonNullable<typeof m> => m !== null && !!m.text?.trim());
  return sortMessages(mapped)
    .slice(-Math.max(1, limit))
    .map((m) => ({ role: m.direction === "inbound" ? "user" : "assistant", content: m.text as string }));
}

/** Filas de `messages` (más recientes primero) → del más antiguo al más nuevo. */
export function aiMessagesFromLocal(
  rows: ReadonlyArray<{ direction: string; text: string | null }>,
): AiMessage[] {
  return [...rows]
    .reverse()
    .filter((m) => !!m.text?.trim())
    .map((m) => ({ role: m.direction === "inbound" ? "user" : "assistant", content: m.text as string }));
}

/**
 * Agrega el mensaje que el cliente acaba de escribir si el historial todavía no
 * lo trae (Zernio puede tardar en listarlo). Sin mensajes, la IA no puede responder.
 */
export function withCurrentMessage(history: AiMessage[], incomingText: string | undefined | null): AiMessage[] {
  const text = incomingText?.trim();
  if (!text) return history;
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  if (lastUser && lastUser.content.trim() === text) return history;
  return [...history, { role: "user", content: text }];
}
