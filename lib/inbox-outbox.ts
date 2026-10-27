// Mensajes que el asesor envió desde la bandeja y que todavía no aparecen en la
// lista de Zernio. Viven en la vista de la bandeja (no en el chat abierto) para
// que un envío que falla después de cambiar de chat no se pierda.

import type { InboxMessage } from "@/lib/inbox-messages";

export type OutboxStatus = "sending" | "failed" | "sent";

export interface OutboxItem {
  /** Id del navegador; también es la Idempotency-Key del envío. */
  clientId: string;
  conversationId: string;
  contactName: string | null;
  text: string;
  createdAt: string;
  status: OutboxStatus;
  error: string | null;
  /**
   * La falla no dice si el mensaje salió (sin red, 5xx, envío en curso): antes
   * de reintentar hay que revisar si ya está en el chat.
   */
  ambiguous: boolean;
  /** Id de plataforma que devolvió el envío. */
  confirmedId: string | null;
}

export type OutboxAction =
  | { type: "queued"; item: OutboxItem }
  | { type: "retrying"; clientId: string }
  | { type: "sent"; clientId: string; confirmedId: string | null }
  | { type: "failed"; clientId: string; error: string; ambiguous: boolean }
  | { type: "settled"; clientIds: string[] };

export function outboxReducer(items: OutboxItem[], action: OutboxAction): OutboxItem[] {
  switch (action.type) {
    case "queued":
      return [...items, action.item];
    case "retrying":
      return items.map((i) => (i.clientId === action.clientId ? { ...i, status: "sending", error: null } : i));
    case "sent":
      return items.map((i) =>
        i.clientId === action.clientId ? { ...i, status: "sent", error: null, ambiguous: false, confirmedId: action.confirmedId } : i,
      );
    case "failed":
      return items.map((i) =>
        i.clientId === action.clientId ? { ...i, status: "failed", error: action.error, ambiguous: action.ambiguous } : i,
      );
    case "settled": {
      if (action.clientIds.length === 0) return items;
      const done = new Set(action.clientIds);
      return items.filter((i) => !done.has(i.clientId));
    }
  }
}

/** Cómo tratar una respuesta fallida del envío (HTTP). */
export function classifySendFailure(status: number | null): { ambiguous: boolean } {
  // Sin respuesta (red caída), envío en curso o error del servidor: no sabemos si salió.
  if (status === null || status === 409 || (status >= 500 && status !== 502)) return { ambiguous: true };
  // 400, 401, 404, 502 (Zernio o la plataforma lo rechazó): no salió.
  return { ambiguous: false };
}

const TOLERANCE_MS = 60_000;

/**
 * Busca en los mensajes del servidor uno propio con el mismo texto, enviado
 * desde poco antes del intento: así se sabe si un envío dudoso sí salió.
 */
export function findLikelyDelivered(item: OutboxItem, serverMessages: InboxMessage[]): InboxMessage | null {
  const since = new Date(item.createdAt).getTime() - TOLERANCE_MS;
  const text = item.text.trim();
  return (
    serverMessages.find(
      (m) =>
        m.direction === "outbound" &&
        (m.text ?? "").trim() === text &&
        (new Date(m.created_at).getTime() || 0) >= since,
    ) ?? null
  );
}

/** Envíos confirmados que ya aparecen en la lista del servidor: se pueden quitar. */
export function settledIds(items: OutboxItem[], conversationId: string, serverMessages: InboxMessage[]): string[] {
  const ids = new Set(serverMessages.map((m) => m.id));
  return items
    .filter(
      (i) =>
        i.conversationId === conversationId &&
        i.status === "sent" &&
        (i.confirmedId ? ids.has(i.confirmedId) : !!findLikelyDelivered(i, serverMessages)),
    )
    .map((i) => i.clientId);
}

/** Lo que el chat muestra de la bandeja de salida, como mensajes. */
export function outboxMessages(items: OutboxItem[], conversationId: string): InboxMessage[] {
  return items
    .filter((i) => i.conversationId === conversationId)
    .map((i) => ({
      id: `outbox-${i.clientId}`,
      conversation_id: i.conversationId,
      direction: "outbound" as const,
      text: i.text,
      attachments: null,
      quick_reply_payload: null,
      postback_payload: null,
      callback_data: null,
      platform_message_id: i.confirmedId,
      sent_by_flow_id: null,
      sent_by_node_id: null,
      sent_by_user_id: null,
      status: i.status === "sending" ? "pending" : i.status === "failed" ? "failed" : "sent",
      error: i.error,
      story: null,
      created_at: i.createdAt,
    }));
}

/** Chats con un envío fallido (para marcarlos en la lista). */
export function failedConversationIds(items: OutboxItem[]): Set<string> {
  return new Set(items.filter((i) => i.status === "failed").map((i) => i.conversationId));
}
