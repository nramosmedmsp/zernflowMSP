import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { handleHumanOutboundForConversation } from "@/lib/cases";
import { createZernioClient } from "@/lib/zernio-client";
import { inboundPreview } from "@/lib/message-preview";
import { getLateApiKey } from "@/lib/workspace-secrets";
import { isDemoChannel } from "@/lib/demo";
import { storeDemoMessage } from "@/lib/demo-messages";
import { zernioErrorMessage, zernioFailed, zernioThrown } from "../templates/zernio-error";
import {
  attachLocalMeta,
  attachMedia,
  failedBotMessages,
  fromLocalMessage,
  mapZernioMessage,
  pageLimit,
  sortMessages,
  type InboxMedia,
  type InboxMessage,
  type LocalMeta,
  type MediaRow,
  type MessagesPage,
  type ZernioListMessage,
} from "@/lib/inbox-messages";
import type { Database } from "@/lib/types/database";
import { zernioAttachmentType } from "@/lib/chat-media";
import { prepareOutgoingMedia, type OutgoingMedia } from "@/lib/media-store";
import { recordOutboundSend } from "@/lib/outbound-log";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/messages?conversationId=...&cursor=...&limit=...
 *
 * Fetches messages from the Zernio API (source of truth) instead of a local mirror.
 * En canales de prueba (lib/demo.ts) devuelve los mensajes de la tabla local.
 *
 * Devuelve una página de los mensajes más recientes ({ messages, olderCursor,
 * hasMore }), ordenada del más antiguo al más nuevo. Con `cursor` (el
 * olderCursor anterior) devuelve la página previa.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const conversationId = params.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "Falta el ID de la conversación" }, { status: 400 });
  }
  const cursor = params.get("cursor") || undefined;
  const limit = pageLimit(params.get("limit"));

  // Look up the Zernio conversation ID. Con el cliente del usuario: RLS
  // (can_see_contact) decide si puede ver esta conversación.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("late_conversation_id, workspace_id, channels(late_account_id)")
    .eq("id", conversationId)
    .single();

  // Canal de prueba: mensajes locales (RLS por la conversación), sin Zernio ni clave.
  // El cursor es la fecha del mensaje más antiguo ya cargado.
  if (conversation && isDemoChannel(conversation.channels as { late_account_id: string } | null)) {
    let query = supabase.from("messages").select("*").eq("conversation_id", conversationId);
    if (cursor) query = query.lt("created_at", cursor);
    const { data: rows, error } = await query.order("created_at", { ascending: false }).limit(limit + 1);
    if (error) {
      console.error("Failed to load demo messages:", error);
      return NextResponse.json({ error: "No se pudieron cargar los mensajes" }, { status: 500 });
    }
    const list = (rows ?? []) as MessageRow[];
    const hasMore = list.length > limit;
    const page = list.slice(0, limit);
    const local = sortMessages(page.map(fromLocalMessage));
    const result: MessagesPage = {
      messages: await withFlowNames(supabase, await withMedia(supabase, local, conversationId)),
      olderCursor: hasMore ? page[page.length - 1].created_at : null,
      hasMore,
    };
    return NextResponse.json(result);
  }

  if (!conversation?.late_conversation_id) {
    return NextResponse.json({ error: "No se encontró la conversación o le falta el ID de Zernio" }, { status: 404 });
  }

  // La clave se lee en el servidor con el cliente de servicio, solo después de
  // comprobar (vía RLS) que el usuario ve la conversación.
  const lateApiKey = await getLateApiKey(conversation.workspace_id);
  if (!lateApiKey) {
    return NextResponse.json({ error: "La clave de API no está configurada" }, { status: 400 });
  }

  const channel = conversation.channels as { late_account_id: string } | null;
  if (!channel?.late_account_id) {
    return NextResponse.json({ error: "No se encontró el canal" }, { status: 404 });
  }

  // Fetch messages from Zernio API: la página más reciente primero (sortOrder
  // desc), para que los chats largos abran con los últimos mensajes.
  try {
    const zernio = createZernioClient(lateApiKey);
    const res = await zernio.messages.getInboxConversationMessages({
      path: { conversationId: conversation.late_conversation_id },
      query: { accountId: channel.late_account_id, limit, sortOrder: "desc", cursor },
    });

    // El SDK no lanza excepciones: un error llega en res.error.
    if (zernioFailed(res)) {
      console.error("[messages] Zernio no devolvió los mensajes:", res.error);
      return NextResponse.json(
        { error: zernioErrorMessage(res, "No se pudieron cargar los mensajes de Zernio") },
        { status: 502 },
      );
    }

    // The Zernio endpoint returns { success, messages: [...] } — NOT { data }.
    const data = res.data as
      | { messages?: ZernioListMessage[]; data?: ZernioListMessage[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } }
      | undefined;
    const zernioMessages = data?.messages ?? data?.data ?? [];
    const messages = zernioMessages
      .map((m) => mapZernioMessage(m, conversationId))
      .filter((m): m is InboxMessage => m !== null);

    const nextCursor = data?.pagination?.nextCursor ?? null;
    const hasMore = !!data?.pagination?.hasMore && !!nextCursor;
    // Los envíos del bot que fallaron solo existen en `messages`: se muestran como "no enviado".
    const { data: failedRows } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .eq("status", "failed")
      .is("platform_message_id", null)
      .not("sent_by_flow_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(30);
    const withBotFailures = [...messages, ...failedBotMessages((failedRows ?? []) as MessageRow[], messages, hasMore)];
    const page: MessagesPage = {
      messages: await withFlowNames(
        supabase,
        await withLocalMeta(supabase, await withMedia(supabase, sortMessages(withBotFailures), conversationId), conversationId),
      ),
      olderCursor: hasMore ? nextCursor : null,
      hasMore,
    };
    return NextResponse.json(page);
  } catch (error) {
    console.error("Failed to fetch messages from Zernio API:", error);
    const rejected = zernioThrown(error);
    return NextResponse.json(
      { error: rejected ? zernioErrorMessage(rejected, "No se pudieron cargar los mensajes de Zernio") : "No se pudieron cargar los mensajes" },
      { status: rejected ? 502 : 500 }
    );
  }
}

/**
 * POST /api/v1/messages
 *
 * Sends a message via Zernio API. No local message storage — Zernio is the source of truth.
 * En canales de prueba (lib/demo.ts) el mensaje se guarda en `messages` y no se llama a Zernio.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { conversationId, clientMessageId } = body;
  const text: string = typeof body.text === "string" ? body.text : "";
  // Archivo ya subido al bucket (POST /api/v1/media/upload-url) o de una respuesta guardada.
  const attachment = body.attachment as { path?: unknown; name?: unknown } | undefined;

  if (!conversationId || (!text.trim() && !attachment)) {
    return NextResponse.json(
      { error: "Faltan el ID de la conversación y el texto o el archivo" },
      { status: 400 }
    );
  }
  // Id del mensaje en el navegador: se manda a Zernio como Idempotency-Key, así
  // un reintento del mismo mensaje no sale dos veces.
  if (clientMessageId !== undefined && (typeof clientMessageId !== "string" || !UUID_RE.test(clientMessageId))) {
    return NextResponse.json({ error: "El identificador del mensaje no es válido" }, { status: 400 });
  }

  // Get conversation with channel info
  const { data: conversation } = await supabase
    .from("conversations")
    .select("*, channels(*)")
    .eq("id", conversationId)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: "No se encontró la conversación" }, { status: 404 });
  }

  let media: OutgoingMedia | null = null;
  if (attachment) {
    const prepared = await prepareOutgoingMedia(supabase, await createServiceClient(), {
      conversation,
      path: attachment.path,
      name: attachment.name,
    });
    if ("error" in prepared) return NextResponse.json({ error: prepared.error }, { status: 400 });
    media = prepared;
  }

  if (isDemoChannel(conversation.channels as { late_account_id: string } | null)) {
    return sendDemoMessage({ conversationId, workspaceId: conversation.workspace_id, text, media, userId: user.id });
  }

  if (!conversation.late_conversation_id) {
    return NextResponse.json(
      { error: "Esta conversación no tiene un ID de conversación de Zernio vinculado" },
      { status: 400 }
    );
  }

  const channel = conversation.channels as { late_account_id: string } | null;
  if (!channel?.late_account_id) {
    return NextResponse.json({ error: "No se encontró el canal o le falta el ID de cuenta de Zernio" }, { status: 404 });
  }

  // La clave se lee en el servidor con el cliente de servicio, solo después de
  // comprobar (vía RLS) que el usuario ve la conversación.
  const lateApiKey = await getLateApiKey(conversation.workspace_id);
  if (!lateApiKey) {
    return NextResponse.json({ error: "La clave de API no está configurada" }, { status: 400 });
  }

  // Send via Zernio SDK — Zernio stores the message, no local insert needed
  try {
    const zernio = createZernioClient(lateApiKey);
    const res = await zernio.messages.sendInboxMessage({
      path: { conversationId: conversation.late_conversation_id },
      body: {
        accountId: channel.late_account_id,
        ...(text.trim() ? { message: text } : {}),
        ...(media
          ? {
              attachmentUrl: media.url,
              attachmentType: zernioAttachmentType(media.kind),
              ...(media.kind === "file" ? { attachmentName: media.name } : {}),
            }
          : {}),
      },
      ...(clientMessageId ? { headers: { "Idempotency-Key": clientMessageId } } : {}),
    });

    // 409: Zernio todavía procesa un envío con la misma clave (doble clic o
    // reintento muy rápido). No es un rechazo: el mensaje puede estar saliendo.
    if (res.response?.status === 409) {
      return NextResponse.json(
        { error: "Este mensaje ya se está enviando.", code: "in_progress" },
        { status: 409 }
      );
    }

    // El SDK no lanza excepciones: un envío rechazado llega en res.error.
    if (zernioFailed(res) || !res.data) {
      console.error("[messages] Zernio rechazó el mensaje:", res.error);
      return NextResponse.json(
        { error: zernioErrorMessage(res, "Zernio rechazó el mensaje") },
        { status: 502 }
      );
    }

    const messageId = res.data.data?.messageId ?? null;

    // El archivo enviado queda registrado para verlo en el chat (2 meses).
    const mediaView = media && messageId ? await recordOutgoingMedia(conversation, messageId, media, user.id) : null;

    // Quién lo envió y su estado de entrega (lib/outbound-log.ts).
    await recordOutboundSend(await createServiceClient(), {
      conversationId,
      platformMessageId: messageId,
      text,
      attachments: media ? [{ type: media.kind }] : null,
      userId: user.id,
      clientMessageId: typeof clientMessageId === "string" ? clientMessageId : null,
      at: new Date().toISOString(),
    });

    // Update conversation's last message info (ZernFlow-specific metadata).
    // Con el cliente de servicio: desde 00031 el usuario solo puede editar
    // conversations.unread_count. El acceso ya se comprobó al leer la conversación.
    await (await createServiceClient())
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: inboundPreview({ text, attachments: media ? [{ type: media.kind }] : null }),
      })
      .eq("id", conversationId);

    // Respuesta humana (docs/FASE-1-TECNICO.md 3.2): sella la gestión activa,
    // registra la primera respuesta y pausa el bot. Si falla, el mensaje ya
    // salió: solo se registra el error.
    try {
      await handleHumanOutboundForConversation(await createServiceClient(), {
        conversationId,
        userId: user.id,
        at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Case engine (handleHumanOutbound) error:", err);
    }

    // Return a message-shaped response for the UI's optimistic update
    return NextResponse.json(
      {
        id: messageId ?? `sent-${Date.now()}`,
        conversation_id: conversationId,
        direction: "outbound",
        text: text || null,
        attachments: null,
        quick_reply_payload: null,
        postback_payload: null,
        callback_data: null,
        platform_message_id: messageId,
        sent_by_flow_id: null,
        sent_by_node_id: null,
        sent_by_user_id: user.id,
        status: "sent",
        error: null,
        story: null,
        media: mediaView ? [mediaView] : null,
        created_at: new Date().toISOString(),
      } satisfies InboxMessage,
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to send message via Zernio API:", error);
    const rejected = zernioThrown(error);
    const status = rejected?.response?.status;
    // 409: Zernio todavía procesa un envío con la misma clave (doble clic o reintento muy rápido).
    if (status === 409) {
      return NextResponse.json({ error: "Este mensaje ya se está enviando.", code: "in_progress" }, { status: 409 });
    }
    // Rechazo de Zernio o de la plataforma (4xx): no salió. Con 5xx no se sabe.
    if (rejected && typeof status === "number" && status < 500) {
      return NextResponse.json({ error: zernioErrorMessage(rejected, "Zernio rechazó el mensaje") }, { status: 502 });
    }
    return NextResponse.json(
      { error: rejected ? zernioErrorMessage(rejected, "No se pudo enviar el mensaje") : "No se pudo enviar el mensaje. Revisa tu conexión e inténtalo de nuevo." },
      { status: 500 }
    );
  }
}

/** Envío en canal de prueba: guarda el saliente y corre el motor como un envío real. */
async function sendDemoMessage(params: {
  conversationId: string;
  workspaceId: string;
  text: string;
  media: OutgoingMedia | null;
  userId: string;
}) {
  const service = await createServiceClient();
  const at = new Date().toISOString();
  const stored = await storeDemoMessage(service, {
    conversationId: params.conversationId,
    direction: "outbound",
    text: params.text,
    at,
    sentByUserId: params.userId,
    attachments: params.media ? [{ type: params.media.kind }] : null,
  });
  if (!stored.ok) {
    console.error("[messages] demo store:", stored.error);
    return NextResponse.json({ error: "No se pudo guardar el mensaje de prueba" }, { status: 500 });
  }
  const mediaView = params.media
    ? await recordOutgoingMedia({ id: params.conversationId, workspace_id: params.workspaceId }, stored.messageId, params.media, params.userId)
    : null;

  // Igual que un envío real: sella la gestión, registra la primera respuesta y pausa el bot.
  try {
    await handleHumanOutboundForConversation(service, {
      conversationId: params.conversationId,
      userId: params.userId,
      at,
    });
  } catch (err) {
    console.error("Case engine (handleHumanOutbound) error:", err);
  }

  return NextResponse.json(
    {
      id: stored.messageId,
      conversation_id: params.conversationId,
      direction: "outbound",
      text: params.text || null,
      attachments: null,
      quick_reply_payload: null,
      postback_payload: null,
      callback_data: null,
      platform_message_id: null,
      sent_by_flow_id: null,
      sent_by_node_id: null,
      sent_by_user_id: params.userId,
      status: "sent",
      error: null,
      story: null,
      media: mediaView ? [mediaView] : null,
      created_at: at,
    } satisfies InboxMessage,
    { status: 201 }
  );
}

/** Registra el archivo enviado (message_media) y devuelve cómo mostrarlo. */
async function recordOutgoingMedia(
  conversation: { id: string; workspace_id: string },
  messageId: string,
  media: OutgoingMedia,
  userId: string,
): Promise<InboxMedia | null> {
  const service = await createServiceClient();
  const { data, error } = await service
    .from("message_media")
    .insert({
      workspace_id: conversation.workspace_id,
      conversation_id: conversation.id,
      platform_message_id: messageId,
      attachment_index: 0,
      direction: "outbound",
      kind: media.kind,
      storage_path: media.path,
      mime_type: media.mime,
      file_name: media.name,
      size_bytes: media.size,
      status: "stored",
      uploaded_by: userId,
    })
    .select("id")
    .single();
  let id = data?.id ?? null;
  // Reintento con la misma Idempotency-Key: Zernio repite el mismo id y la fila ya existe.
  if (error?.code === "23505") {
    const { data: existing } = await service
      .from("message_media")
      .select("id")
      .eq("conversation_id", conversation.id)
      .eq("platform_message_id", messageId)
      .eq("attachment_index", 0)
      .maybeSingle();
    id = existing?.id ?? null;
  } else if (error) {
    console.error("[messages] message_media:", error.message);
  }
  if (!id) return null;
  return { kind: media.kind, name: media.name, mime: media.mime, size: media.size, status: "stored", url: `/api/v1/media/${id}` };
}

/** Une los mensajes con sus archivos guardados (RLS de message_media). */
async function withMedia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  messages: InboxMessage[],
  conversationId: string,
): Promise<InboxMessage[]> {
  const ids = messages.map((m) => m.id);
  if (ids.length === 0) return messages;
  const { data, error } = await supabase
    .from("message_media")
    .select("id, platform_message_id, attachment_index, kind, file_name, mime_type, size_bytes, status")
    .eq("conversation_id", conversationId)
    .in("platform_message_id", ids);
  if (error) console.error("[messages] message_media:", error.message);
  return attachMedia(messages, (data ?? []) as MediaRow[], { conversationId });
}

/** Nombres de los flujos que enviaron mensajes (para "Bot · Bienvenida"). */
async function flowNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: Array<string | null>,
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return {};
  const { data } = await supabase.from("flows").select("id, name").in("id", unique);
  return Object.fromEntries((data ?? []).map((f) => [f.id, f.name]));
}

async function withFlowNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  messages: InboxMessage[],
): Promise<InboxMessage[]> {
  const names = await flowNames(supabase, messages.map((m) => m.sent_by_flow_id));
  if (Object.keys(names).length === 0) return messages;
  return messages.map((m) => (m.sent_by_flow_id ? { ...m, flow_name: names[m.sent_by_flow_id] ?? null } : m));
}

/**
 * Une la lista de Zernio con lo registrado en `messages`: quién envió cada
 * mensaje (asesor o flujo) y el último estado que avisó el webhook.
 */
async function withLocalMeta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  messages: InboxMessage[],
  conversationId: string,
): Promise<InboxMessage[]> {
  const ids = messages.filter((m) => m.direction === "outbound").map((m) => m.id);
  if (ids.length === 0) return messages;
  const { data, error } = await supabase
    .from("messages")
    .select("platform_message_id, sent_by_user_id, sent_by_flow_id, status, error_text")
    .eq("conversation_id", conversationId)
    .in("platform_message_id", ids);
  if (error) {
    console.error("[messages] local meta:", error.message);
    return messages;
  }
  const rows = (data ?? []) as LocalMeta[];
  const names = await flowNames(supabase, rows.map((r) => r.sent_by_flow_id));
  return attachLocalMeta(messages, rows, names);
}
