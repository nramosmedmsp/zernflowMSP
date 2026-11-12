import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { pickChannelBySignature, type ChannelPick } from "@/lib/zernio-webhook";
import { processComment } from "@/lib/comment-processor";
import type { Database } from "@/lib/types/database";
import { inboundPreview } from "@/lib/message-preview";
import {
  buildStoredPayload,
  claimInboundEvent,
  prepareInboundEvent,
  processStoredInbound,
  releaseAfterPrepareFailure,
  type InboundEventRow,
} from "@/lib/inbound-events";
import { storeInboundMedia, type InboundAttachmentInput } from "@/lib/media-store";
import { getLateApiKey } from "@/lib/workspace-secrets";
import { applyDeliveryEvent, type DeliveryEvent } from "@/lib/outbound-log";
import { checkEventAge, webhookEventKey } from "@/lib/webhook-guard";

// Copiar fotos y PDF que llegan puede tardar más que lo normal (hasta 25 MB).
export const maxDuration = 60;

// ── Zernio API webhook payload ───────────────────────────────────────────────

interface WebhookPayload {
  id?: string;
  event: string;
  message: {
    id: string;
    conversationId: string;
    platform: string;
    platformMessageId: string;
    direction: string;
    text: string | null;
    attachments: Array<{ type: string; url: string; filename?: string | null; payload?: unknown }>;
    /** Instagram: respuesta o mención de una historia (si Zernio lo manda). */
    storyReply?: unknown;
    isStoryMention?: boolean | null;
    sender: {
      id: string;
      name: string;
      username: string | null;
      picture: string | null;
    };
    sentAt: string;
    isRead: boolean;
  };
  conversation: {
    id: string;
    platformConversationId: string | null;
    participantId: string;
    participantName: string;
    participantUsername: string | null;
    participantPicture: string | null;
    status: string;
  };
  account: {
    id: string;
    platform: string;
    username: string;
    displayName: string;
  };
  metadata?: {
    quickReplyPayload?: string;
    callbackData?: string;
    postbackPayload?: string;
    postbackTitle?: string;
  };
  timestamp: string;
}

interface CommentWebhookPayload {
  id?: string;
  event: string;
  comment: {
    id: string;
    /** Zernio post ID; null when the comment is on a post not published through Zernio. */
    postId: string | null;
    platformPostId: string;
    platform: string;
    text: string;
    author: { id: string; username?: string; name?: string; picture?: string };
    createdAt: string;
    isReply: boolean;
    parentCommentId: string | null;
  };
  post: { id: string; platformPostId: string };
  account: { id: string; platform: string; username: string };
  timestamp: string;
}

/** message.delivered / message.read / message.failed (estado de un mensaje propio). */
interface DeliveryWebhookPayload {
  id?: string;
  timestamp?: string;
  event: DeliveryEvent;
  message: { conversationId?: string; platformMessageId?: string };
  statusAt?: string;
  error?: { code?: number; title?: string; message?: string; explanation?: string | null } | null;
  conversation?: { id?: string };
  account: { id: string };
}

const DELIVERY_EVENTS = new Set<string>(["message.delivered", "message.read", "message.failed"]);

// ── Webhook handler ─────────────────────────────────────────────────────────

type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];

/**
 * Busca los canales activos de la cuenta de Zernio y elige el que corresponde
 * a la firma (lib/zernio-webhook.ts). Sin secreto o sin firma válida no se
 * procesa nada. Devuelve la respuesta de error lista, o el canal.
 */
async function resolveChannel(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  accountId: string,
  body: string,
  signature: string | null,
): Promise<ChannelPick<ChannelRow>> {
  const { data } = await supabase
    .from("channels")
    .select("*")
    .eq("late_account_id", accountId)
    .eq("is_active", true);
  return pickChannelBySignature(supabase, (data ?? []) as ChannelRow[], body, signature);
}

function rejectResponse(reason: "no_secret" | "bad_signature") {
  if (reason === "no_secret") {
    console.error("[webhook] el espacio no tiene secreto de webhook configurado; se rechaza el evento");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 401 });
  }
  return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  try {
    return await handleWebhook(request);
  } catch (err) {
    // El detalle solo va al registro del servidor: nunca se devuelve a quien llama (SEG-02).
    console.error("Webhook handler error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── Forma mínima del cuerpo (antes de tocar la base) ────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Un cuerpo incompleto se rechaza con 400 genérico, sin lanzar ni consultar la base. */
function isMessagePayload(p: Record<string, unknown>): boolean {
  const { message, conversation, account } = p;
  return (
    isObj(message) &&
    isObj(message.sender) &&
    isStr(message.sender.id) &&
    isObj(conversation) &&
    isStr(conversation.id) &&
    isObj(account) &&
    isStr(account.id)
  );
}

function isCommentPayload(p: Record<string, unknown>): boolean {
  return isObj(p.comment) && isStr(p.comment.id) && isObj(p.account) && isStr(p.account.id);
}

/** Estado de entrega: necesita la cuenta (para elegir el canal por firma) y el bloque del mensaje. */
function isDeliveryPayload(p: Record<string, unknown>): boolean {
  return isObj(p.account) && isStr(p.account.id) && (p.message === undefined || isObj(p.message));
}

const invalidPayload = () => NextResponse.json({ error: "Invalid payload" }, { status: 400 });

/**
 * SEG-03: reenvío viejo de un evento firmado. La fecha sale del cuerpo ya
 * verificado (`timestamp`, que Zernio conserva en los reintentos). Se responde
 * 200 para que Zernio no lo siga reintentando; el aviso en el log no lleva
 * contenido del mensaje. Margen y razón: lib/webhook-guard.ts.
 */
function staleEventResponse(parsed: { id?: unknown; timestamp?: unknown }, eventId: string) {
  const age = checkEventAge(parsed.timestamp);
  if (age.status !== "stale" && age.status !== "future") return null;
  console.warn(`[webhook] evento ${eventId} descartado: ${age.status === "stale" ? "demasiado viejo" : "fecha en el futuro"}`);
  return NextResponse.json({ ok: true, skipped: true, reason: "stale_event" });
}

/**
 * Claim an event id for processing. Returns false when another delivery of the
 * same event already claimed it (Zernio retries with the same id), so retries
 * and redeliveries never re-run a flow. Events without an id are processed
 * unconditionally rather than dropped.
 */
async function claimWebhookEvent(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  eventId: string | null | undefined
): Promise<boolean> {
  if (!eventId) return true;
  const { error } = await supabase
    .from("webhook_events")
    .insert({ event_id: eventId });
  if (!error) return true;
  if (error.code === "23505") return false;
  // Table missing / transient DB error: fail open so deliveries keep working.
  console.error("webhook_events claim failed:", error);
  return true;
}

/** Libera el id del evento para que el reintento de Zernio no se tome por duplicado. */
async function releaseWebhookEvent(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  eventId: string | null | undefined,
): Promise<void> {
  if (!eventId) return;
  const { error } = await supabase.from("webhook_events").delete().eq("event_id", eventId);
  if (error) console.error("webhook_events release failed:", error);
}

async function handleWebhook(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-late-signature");

  let parsed: { event?: string; id?: string; timestamp?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isObj(parsed)) return invalidPayload();

  // SEG-03: el id sale SOLO del cuerpo firmado (la cabecera x-late-event-id no
  // va firmada y cambiándola evitaría la anti-repetición). Sin id, se deriva del cuerpo.
  const eventKey = webhookEventKey(parsed, body);
  const eventId = eventKey.id;

  if (parsed.event === "comment.received") {
    if (!isCommentPayload(parsed)) return invalidPayload();
    return handleCommentWebhook(parsed as CommentWebhookPayload, body, signature, eventId);
  }

  if (parsed.event && DELIVERY_EVENTS.has(parsed.event)) {
    if (!isDeliveryPayload(parsed)) return invalidPayload();
    return handleDeliveryWebhook(parsed as DeliveryWebhookPayload, body, signature, eventId);
  }

  // Everything else besides message.received is acknowledged and ignored
  if (parsed.event !== "message.received") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (!isMessagePayload(parsed)) return invalidPayload();
  const payload = parsed as unknown as WebhookPayload;

  const { message: msg, account } = payload;

  // Ignore outbound messages (sent by the bot itself) to prevent loops.
  // Zernio documenta "outgoing"; "outbound" se acepta por compatibilidad.
  if (msg.direction === "outbound" || msg.direction === "outgoing") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const supabase = await createServiceClient();

  // Elige el canal por cuenta de Zernio y firma (rechaza si falta secreto o firma).
  const picked = await resolveChannel(supabase, account.id, body, signature);
  if (!picked.ok) {
    if (picked.reason === "no_channel") return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    return rejectResponse(picked.reason);
  }
  const channel = picked.channel;

  const stale = staleEventResponse(parsed, eventId);
  if (stale) return stale;

  // Prevent loops: if the sender is another connected account in this
  // workspace, skip. This happens when both sides of a DM conversation
  // are connected (e.g. during testing).
  if (msg.sender.username) {
    const { data: senderChannel } = await supabase
      .from("channels")
      .select("id")
      .eq("workspace_id", channel.workspace_id)
      .eq("username", msg.sender.username)
      .eq("is_active", true)
      .maybeSingle();

    if (senderChannel) {
      return NextResponse.json({ ok: true, skipped: true, reason: "sender_is_own_account" });
    }
  }

  // CONF-06: el evento se guarda COMPLETO (cuerpo verificado y reducido) en la
  // bandeja durable antes de hacer nada más. Un reintento de Zernio solo cuenta
  // como duplicado si el evento ya se procesó o lo está procesando otra
  // ejecución; si quedó a medias, se retoma (lib/inbound-events.ts).
  const at = new Date().toISOString();
  const claim = await claimInboundEvent(supabase, {
    // Sin id en el cuerpo se usa el mensaje de la plataforma (también del cuerpo firmado).
    eventId: !eventKey.derived ? eventId : msg.platformMessageId ? `pm:${account.id}:${msg.platformMessageId}` : eventId,
    channelId: channel.id,
    payload: buildStoredPayload({
      at,
      preview: inboundPreview(msg),
      lateConversationId: payload.conversation.id,
      lateAccountId: account.id,
      platformMessageId: msg.platformMessageId,
      text: typeof msg.text === "string" ? msg.text : null,
      sender: { id: msg.sender.id, name: msg.sender.name, username: msg.sender.username || null },
      metadata: payload.metadata,
    }),
  });
  if (claim.kind === "duplicate") {
    return NextResponse.json({ ok: true, skipped: true, reason: "duplicate_event" });
  }
  const row: InboundEventRow = claim.row;

  // M-16: el contacto, su chat y el no leído se guardan ANTES de responder. Si
  // fallan, se responde con error y se libera el candado del evento: Zernio
  // reintenta (o lo retoma el cron) y el mensaje no se pierde. Es poco trabajo
  // (unas consultas): cabe en los 5 s de Zernio. Lo demás (gestiones, bot,
  // archivos) corre después de responder.
  const prepared = await prepareInboundEvent(supabase, row, channel);
  if (!prepared.ok) {
    console.error("Webhook: no se pudo registrar el mensaje entrante:", prepared.error);
    await releaseAfterPrepareFailure(supabase, row, prepared.error);
    return NextResponse.json({ error: "Could not store the message" }, { status: 500 });
  }

  // Ack and process after the response: Zernio aborts deliveries at 5s and
  // retries, so flow execution (Zernio sends, AI nodes) must never run before
  // the 200 goes out. Si esto falla o la función se corta, el evento queda
  // pendiente y el cron lo retoma (sweepInboundEvents).
  after(async () => {
    // Messages are stored by Zernio (source of truth) — no local insert needed.
    // Sus archivos sí se copian: WhatsApp los borra a los pocos días. Solo en la
    // primera entrega: la bandeja no guarda los enlaces de los archivos.
    const media =
      claim.kind === "retake" || !row.conversation_id
        ? Promise.resolve()
        : copyInboundMedia(supabase, payload, channel.workspace_id, row.conversation_id);
    const work = processStoredInbound(supabase, row, channel);
    const [mediaResult] = await Promise.allSettled([media, work]);
    if (mediaResult.status === "rejected") console.error("Webhook media copy error:", mediaResult.reason);
  });

  return NextResponse.json({ ok: true, queued: true });
}

/** Nombre del archivo que mandó el cliente, si Zernio lo incluye. */
function attachmentFileName(att: WebhookPayload["message"]["attachments"][number]): string | null {
  if (typeof att.filename === "string") return att.filename;
  const payload = att.payload as { filename?: unknown } | null | undefined;
  return typeof payload?.filename === "string" ? payload.filename : null;
}

async function copyInboundMedia(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  payload: WebhookPayload,
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  const { message: msg } = payload;
  if (!Array.isArray(msg.attachments) || msg.attachments.length === 0 || !msg.platformMessageId) return;
  const attachments: InboundAttachmentInput[] = msg.attachments.map((att) => ({
    type: att.type,
    url: att.url,
    filename: attachmentFileName(att),
  }));
  await storeInboundMedia(supabase, {
    workspaceId,
    conversationId,
    platformMessageId: msg.platformMessageId,
    attachments,
    apiKey: await getLateApiKey(workspaceId, supabase),
  });
}

// ── Delivery status webhook ─────────────────────────────────────────────────

/**
 * Entregado, leído o no entregado: actualiza el mensaje registrado en
 * `messages` (lib/outbound-log.ts) y la bandeja lo ve en vivo por Realtime.
 */
async function handleDeliveryWebhook(
  payload: DeliveryWebhookPayload,
  rawBody: string,
  signature: string | null,
  eventId: string,
) {
  const supabase = await createServiceClient();
  const picked = await resolveChannel(supabase, payload.account.id, rawBody, signature);
  if (!picked.ok) {
    if (picked.reason === "no_channel") {
      return NextResponse.json({ ok: true, skipped: true, reason: "channel_not_found" });
    }
    return rejectResponse(picked.reason);
  }
  const stale = staleEventResponse(payload, eventId);
  if (stale) return stale;
  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: true, reason: "duplicate_event" });
  }

  const lateConversationId = payload.message?.conversationId ?? payload.conversation?.id;
  const platformMessageId = payload.message?.platformMessageId;
  if (!lateConversationId || !platformMessageId) return NextResponse.json({ ok: true, skipped: true });

  after(async () => {
    try {
      await applyDeliveryEvent(supabase, {
        lateConversationId,
        platformMessageId,
        event: payload.event,
        statusAt: payload.statusAt ?? null,
        error: payload.error ?? null,
      });
    } catch (err) {
      console.error("Webhook delivery status error:", err);
    }
  });
  return NextResponse.json({ ok: true, queued: true });
}

// ── Comment webhook ─────────────────────────────────────────────────────────

async function handleCommentWebhook(
  payload: CommentWebhookPayload,
  rawBody: string,
  signature: string | null,
  eventId: string
) {
  const supabase = await createServiceClient();

  const picked = await resolveChannel(supabase, payload.account.id, rawBody, signature);
  if (!picked.ok) {
    if (picked.reason === "no_channel") return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    return rejectResponse(picked.reason);
  }
  const channel = picked.channel;

  // Prevent loops: our own comments (e.g. the configured public reply) also
  // arrive as comment.received and must never re-trigger a flow.
  if (
    payload.comment.author?.username &&
    payload.comment.author.username === channel.username
  ) {
    return NextResponse.json({ ok: true, skipped: true, reason: "own_comment" });
  }

  const stale = staleEventResponse(payload, eventId);
  if (stale) return stale;
  if (!(await claimWebhookEvent(supabase, eventId))) {
    return NextResponse.json({ ok: true, skipped: true, reason: "duplicate_event" });
  }

  // Ack before processing (same 5s delivery budget as messages); processComment
  // additionally dedupes on (channel_id, platform_comment_id) so cross-event
  // redeliveries of the same comment stay one-shot.
  after(async () => {
    try {
      await processComment({
        supabase,
        channel,
        comment: {
          id: payload.comment.id,
          // Native posts (not published through Zernio) have a null postId; fall
          // back to the platform post id so flows still run. Zernio's private-reply
          // endpoint only needs the comment id, so the placeholder is harmless.
          postId: payload.comment.postId || payload.comment.platformPostId,
          text: payload.comment.text,
          author: payload.comment.author,
        },
      });
    } catch (err) {
      console.error("Webhook comment processing error:", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}
