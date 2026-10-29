// Mensajes del chat de la bandeja: de la lista de Zernio (canales reales) o de
// la tabla local (canales de prueba), en un mismo formato. Zernio es la fuente
// de verdad; aquí solo se traduce y se ordena.

import type { Database, MessageMediaKind, MessageMediaStatus, MessageStatus } from "@/lib/types/database";
import { kindFromAttachmentType, needsProxy } from "@/lib/chat-media";
import { deliveryErrorText, type DeliveryErrorLike } from "@/lib/delivery-errors";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

export type InboxMessageStatus = MessageStatus;

/** Un archivo del mensaje, listo para mostrar. */
export interface InboxMedia {
  kind: MessageMediaKind;
  name: string | null;
  mime: string | null;
  size: number | null;
  /** "stored": copia propia; "remote": enlace de la plataforma; "expired": pasaron los 2 meses. */
  status: MessageMediaStatus | "remote";
  /** Dónde verlo (null si ya no está disponible). */
  url: string | null;
  /** Vista previa local (envío en curso desde este navegador). */
  localUrl?: string | null;
}

/** Columnas internas de `messages` que la bandeja no usa tal cual. */
type InternalColumns = "status" | "client_message_id" | "status_at" | "error_code" | "error_text";

export type InboxMessage = Omit<MessageRow, InternalColumns> & {
  status: InboxMessageStatus;
  /** Motivo en español cuando la plataforma no entregó el mensaje. */
  error: string | null;
  /** Instagram: el cliente respondió a una historia o la mencionó. */
  story: "reply" | "mention" | null;
  /** Archivos del mensaje (fotos, PDF, audios…), si tiene. */
  media?: InboxMedia[] | null;
  /** Nombre del flujo que lo envió (mensajes del bot). */
  flow_name?: string | null;
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
  // Las plantillas de WhatsApp llegan como un adjunto "template": no son archivos.
  const files = Array.isArray(raw.attachments)
    ? raw.attachments.filter((a) => (a as { type?: unknown } | null)?.type !== "template")
    : [];
  const attachments = files.length > 0 ? files : null;
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
  return { ...row, error: row.status === "failed" ? (row.error_text ?? null) : null, story: null };
}

/**
 * Envíos del bot que Zernio rechazó (M-10): no existen en la lista de Zernio,
 * solo en `messages`, y sin esto el asesor nunca vería que el cliente no recibió
 * el mensaje. Con páginas anteriores pendientes, solo entran los posteriores al
 * mensaje más antiguo ya cargado (los demás salen al pedir esas páginas).
 */
export function failedBotMessages(
  rows: readonly MessageRow[],
  loaded: readonly InboxMessage[],
  hasOlder: boolean,
): InboxMessage[] {
  const oldest = loaded.length ? Math.min(...loaded.map((m) => new Date(m.created_at).getTime() || Infinity)) : -Infinity;
  return rows
    .filter(
      (r) =>
        r.direction === "outbound" &&
        r.status === "failed" &&
        !r.platform_message_id &&
        !!r.sent_by_flow_id &&
        (!hasOlder || new Date(r.created_at).getTime() >= oldest),
    )
    .map(fromLocalMessage);
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

// ── Archivos ────────────────────────────────────────────────────────────────

/** Fila de message_media que usa la bandeja. */
export interface MediaRow {
  id: string;
  platform_message_id: string;
  attachment_index: number;
  kind: MessageMediaKind;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: MessageMediaStatus;
}

interface RawAttachment {
  type?: string | null;
  url?: string | null;
  filename?: string | null;
}

function rawAttachments(message: InboxMessage): RawAttachment[] {
  return Array.isArray(message.attachments) ? (message.attachments as unknown as RawAttachment[]) : [];
}

/**
 * Une cada mensaje con sus archivos: la copia propia (message_media) si existe;
 * si no, el enlace de la plataforma. Los de Zernio (WhatsApp) y Telegram pasan
 * por nuestra ruta (piden la clave o esconden un token); los demás (Instagram,
 * Facebook, archivos de los flujos) usan su enlace directo.
 */
export function attachMedia(
  messages: InboxMessage[],
  rows: MediaRow[],
  ctx: { conversationId: string },
): InboxMessage[] {
  const byMessage = new Map<string, MediaRow[]>();
  for (const row of rows) {
    const list = byMessage.get(row.platform_message_id) ?? [];
    list.push(row);
    byMessage.set(row.platform_message_id, list);
  }

  return messages.map((message) => {
    const raw = rawAttachments(message);
    const stored = (byMessage.get(message.id) ?? []).sort((a, b) => a.attachment_index - b.attachment_index);
    const count = Math.max(raw.length, stored.length ? stored[stored.length - 1].attachment_index + 1 : 0);
    if (count === 0) return message;

    const media: InboxMedia[] = [];
    for (let index = 0; index < count; index++) {
      const row = stored.find((r) => r.attachment_index === index);
      const att = raw[index];
      if (row?.status === "stored") {
        media.push({ kind: row.kind, name: row.file_name, mime: row.mime_type, size: row.size_bytes, status: "stored", url: `/api/v1/media/${row.id}` });
        continue;
      }
      if (row?.status === "expired") {
        media.push({ kind: row.kind, name: row.file_name, mime: row.mime_type, size: row.size_bytes, status: "expired", url: null });
        continue;
      }
      const url = att?.url ?? null;
      const kind = row?.kind ?? kindFromAttachmentType(att?.type);
      const remote =
        url && /^https:\/\//i.test(url)
          ? needsProxy(url)
            ? `/api/v1/media/remote?${new URLSearchParams({ c: ctx.conversationId, m: message.id, i: String(index), u: url })}`
            : url
          : null;
      media.push({
        kind,
        name: row?.file_name ?? att?.filename ?? null,
        mime: row?.mime_type ?? null,
        size: row?.size_bytes ?? null,
        status: remote ? "remote" : (row?.status ?? "failed"),
        url: remote,
      });
    }
    return { ...message, media };
  });
}

// ── Autor y estado registrados en la base ──────────────────────────────────

/** Lo que guarda `messages` de un envío (autor, estado del webhook). */
export interface LocalMeta {
  platform_message_id: string | null;
  sent_by_user_id: string | null;
  sent_by_flow_id: string | null;
  /** "sequence:<nombre>" cuando lo envió una secuencia. */
  sent_by_node_id?: string | null;
  status: MessageStatus;
  error_text: string | null;
}

const STATUS_RANK: Record<InboxMessageStatus, number> = { pending: 0, sent: 1, delivered: 2, failed: 3, read: 4 };

/**
 * El estado más avanzado de dos: leído gana a todo, no entregado gana a
 * enviado y entregado. Así un dato viejo nunca hace retroceder los ticks.
 */
export function strongerStatus(a: InboxMessageStatus, b: InboxMessageStatus): InboxMessageStatus {
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

/**
 * Une la lista de Zernio con lo registrado en `messages` (por id de
 * plataforma): quién lo envió (asesor o flujo) y el último estado que avisó el
 * webhook, si es más avanzado que el de la lista.
 */
export function attachLocalMeta(
  messages: InboxMessage[],
  rows: LocalMeta[],
  flowNames: Readonly<Record<string, string>> = {},
): InboxMessage[] {
  const byId = new Map<string, LocalMeta>();
  for (const row of rows) if (row.platform_message_id) byId.set(row.platform_message_id, row);
  if (byId.size === 0) return messages;
  return messages.map((m) => {
    const row = byId.get(m.id);
    if (!row) return m;
    const outbound = m.direction === "outbound";
    const status = outbound ? strongerStatus(m.status, row.status) : m.status;
    const flowId = m.sent_by_flow_id ?? row.sent_by_flow_id;
    return {
      ...m,
      sent_by_user_id: m.sent_by_user_id ?? row.sent_by_user_id,
      sent_by_flow_id: flowId,
      sent_by_node_id: m.sent_by_node_id ?? row.sent_by_node_id ?? null,
      flow_name: flowId ? (flowNames[flowId] ?? m.flow_name ?? null) : (m.flow_name ?? null),
      status,
      error: status === "failed" ? (m.error ?? row.error_text ?? null) : null,
    };
  });
}

/** Cambio de estado que llega en vivo (Realtime de `messages`). */
export function applyStatusUpdate(
  messages: InboxMessage[],
  update: { platform_message_id: string | null; status: MessageStatus; error_text?: string | null },
): InboxMessage[] {
  if (!update.platform_message_id) return messages;
  let changed = false;
  const next = messages.map((m) => {
    if (m.id !== update.platform_message_id || m.direction !== "outbound") return m;
    const status = strongerStatus(m.status, update.status);
    if (status === m.status) return m;
    changed = true;
    return { ...m, status, error: status === "failed" ? (update.error_text ?? m.error ?? null) : null };
  });
  return changed ? next : messages;
}
