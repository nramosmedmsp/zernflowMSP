import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { handleHumanOutboundForConversation } from "@/lib/cases";
import { createZernioClient } from "@/lib/zernio-client";
import { messagePreview } from "@/lib/message-preview";
import { getLateApiKey } from "@/lib/workspace-secrets";
import { isDemoChannel } from "@/lib/demo";
import { storeDemoMessage } from "@/lib/demo-messages";
import { zernioErrorMessage, zernioFailed } from "../templates/zernio-error";
import {
  fromLocalMessage,
  mapZernioMessage,
  pageLimit,
  sortMessages,
  type InboxMessage,
  type MessagesPage,
  type ZernioListMessage,
} from "@/lib/inbox-messages";
import type { Database } from "@/lib/types/database";

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
    const result: MessagesPage = {
      messages: sortMessages(page.map(fromLocalMessage)),
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
    const page: MessagesPage = { messages: sortMessages(messages), olderCursor: hasMore ? nextCursor : null, hasMore };
    return NextResponse.json(page);
  } catch (error) {
    console.error("Failed to fetch messages from Zernio API:", error);
    return NextResponse.json(
      { error: "No se pudieron cargar los mensajes" },
      { status: 500 }
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
  const { conversationId, text, clientMessageId } = body;

  if (!conversationId || !text) {
    return NextResponse.json(
      { error: "Faltan el ID de la conversación y el texto" },
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

  if (isDemoChannel(conversation.channels as { late_account_id: string } | null)) {
    return sendDemoMessage({ conversationId, text, userId: user.id });
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
      body: { accountId: channel.late_account_id, message: text },
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

    const messageId = (res.data as any)?.data?.messageId ?? null;

    // Update conversation's last message info (ZernFlow-specific metadata)
    await supabase
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: messagePreview(text),
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
        text,
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
        created_at: new Date().toISOString(),
      } satisfies InboxMessage,
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to send message via Zernio API:", error);
    return NextResponse.json(
      { error: "No se pudo enviar el mensaje. Revisa tu conexión e inténtalo de nuevo." },
      { status: 500 }
    );
  }
}

/** Envío en canal de prueba: guarda el saliente y corre el motor como un envío real. */
async function sendDemoMessage(params: { conversationId: string; text: string; userId: string }) {
  const service = await createServiceClient();
  const at = new Date().toISOString();
  const stored = await storeDemoMessage(service, {
    conversationId: params.conversationId,
    direction: "outbound",
    text: params.text,
    at,
    sentByUserId: params.userId,
  });
  if (!stored.ok) {
    console.error("[messages] demo store:", stored.error);
    return NextResponse.json({ error: "No se pudo guardar el mensaje de prueba" }, { status: 500 });
  }

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
      text: params.text,
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
      created_at: at,
    } satisfies InboxMessage,
    { status: 201 }
  );
}
