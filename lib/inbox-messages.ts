// Mensajes del chat de la bandeja: de la lista de Zernio (canales reales) o de
// la tabla local (canales de prueba), en un mismo formato. Zernio es la fuente
// de verdad; aquí solo se traduce y se ordena.

import type { Database, MessageStatus } from "@/lib/types/database";
import { deliveryErrorText, type DeliveryErrorLike } from "@/lib/delivery-errors";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

export type InboxMessageStatus = MessageStatus | "read";

export type InboxMessage = Omit<MessageRow, "status"> & {
  status: InboxMessageStatus;
  /** Motivo en español cuando la plataforma no entregó el mensaje. */
  error: string | null;
  /** Instagram: el cliente respondió a una historia o la mencionó. */
  story: "reply" | "mention" | null;
};

/** Página de mensajes que devuelve GET /api/v1/messages. */
export interface MessagesPage {
  messages: InboxMessage[];
  /** Cursor para pedir los mensajes anteriores; null si no hay más. */
  olderCursor: string | null;
  hasMore: boolean;
}

/** Lo que usa la bandeja de un mensaje de getInboxConversationMessages. */
export interface ZernioListMessage {
  id?: string;
  message?: string | null;
  text?: string | null;
  direction?: string | null;
  createdAt?: string | null;
  sentAt?: string | null;
  attachments?: unknown[] | null;
  storyReply?: unknown;
  isStoryMention?: boolean | null;
  deliveryStatus?: string | null;
  deliveryError?: DeliveryErrorLike | null;
}

const OUTGOING = new Set(["outgoing", "outbound"]);

function statusOf(raw: ZernioListMessage, outbound: boolean): InboxMessageStatus {
  if (!outbound) return "sent";
  switch (raw.deliveryStatus) {
    case "delivered":
      return "delivered";
    case "read":
    case "played":
      return "read";
    case "failed":
      return "failed";
    default:
      return "sent";
  }
}

/**
 * Traduce un mensaje de Zernio. Su `id` es el id de la plataforma (wamid en
 * WhatsApp, mid en Instagram y Messenger), el mismo que devuelve el envío.
 */
export function mapZernioMessage(raw: ZernioListMessage, conversationId: string): InboxMessage | null {
  if (!raw?.id) return null;
  const outbound = OUTGOING.has(String(raw.direction ?? "").toLowerCase());
  const status = statusOf(raw, outbound);
  const attachments = Array.isArray(raw.attachments) && raw.attachments.length > 0 ? raw.attachments : null;
  const story = raw.isStoryMention ? "mention" : raw.storyReply ? "reply" : null;
  return {
    id: raw.id,
    conversation_id: conversationId,
    direction: outbound ? "outbound" : "inbound",
    text: raw.message ?? raw.text ?? null,
    attachments: attachments as InboxMessage["attachments"],
    quick_reply_payload: null,
    postback_payload: null,
    callback_data: null,
    platform_message_id: raw.id,
    sent_by_flow_id: null,
    sent_by_node_id: null,
    sent_by_user_id: null,
    status,
    error: status === "failed" ? deliveryErrorText(raw.deliveryError) : null,
    story,
    created_at: raw.sentAt ?? raw.createdAt ?? new Date().toISOString(),
  };
}

/** Fila local (canales de prueba y envíos del bot) en el formato de la bandeja. */
export function fromLocalMessage(row: MessageRow): InboxMessage {
  return { ...row, error: null, story: null };
}

function byTime(a: InboxMessage, b: InboxMessage): number {
  const ta = new Date(a.created_at).getTime() || 0;
  const tb = new Date(b.created_at).getTime() || 0;
  return ta - tb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Del más antiguo al más nuevo. */
export function sortMessages(list: InboxMessage[]): InboxMessage[] {
  return [...list].sort(byTime);
}

/**
 * Une lo ya cargado con una página nueva por id: lo nuevo reemplaza al
 * anterior (trae el estado más reciente) y nada de lo cargado se pierde.
 */
export function mergeMessages(existing: InboxMessage[], incoming: InboxMessage[]): InboxMessage[] {
  const byId = new Map<string, InboxMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return sortMessages([...byId.values()]);
}

/** Límite de mensajes por página: por defecto 50, entre 1 y 100 (máximo de Zernio). */
export function pageLimit(value: string | null): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(1, n));
}
