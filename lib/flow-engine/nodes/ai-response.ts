import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { FlowExecutionContext, AiResponseNodeData } from "../types";
import { createZernioClient } from "@/lib/zernio-client";
import { getWorkspaceSecrets, type WorkspaceSecrets } from "@/lib/workspace-secrets";
import { generateText, createGateway } from "ai";
import { stampBotOutbound } from "@/lib/cases/inbound";
import { isDemoChannel } from "@/lib/demo";
import type { ZernioListMessage } from "@/lib/inbox-messages";
import { zernioErrorMessage, zernioFailed } from "@/lib/zernio-error";
import { touchConversationAfterBotSend } from "../bot-send";
import {
  aiMessagesFromLocal,
  aiMessagesFromZernio,
  DEFAULT_AI_SYSTEM_PROMPT,
  withCurrentMessage,
  type AiMessage,
} from "./ai-history";

// Halt the run: continuing would let a downstream Send Message deliver the
// literal "{{ai_response}}" token to the contact (same pause mechanism as
// humanTakeover, but the session is cancelled rather than completed).
async function cancelRun(
  supabase: SupabaseClient<Database>,
  sessionId: string
): Promise<"pause"> {
  await supabase
    .from("flow_sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId);
  return "pause";
}

export async function executeAiResponse(
  supabase: SupabaseClient<Database>,
  data: AiResponseNodeData,
  context: FlowExecutionContext,
  sessionId: string
) {
  // Zernio API key + AI Gateway key (workspace_secrets, service client)
  let secrets: WorkspaceSecrets;
  try {
    secrets = await getWorkspaceSecrets(context.workspaceId, supabase);
  } catch (err) {
    console.error("Could not read workspace secrets:", err);
    return cancelRun(supabase, sessionId);
  }

  // Resolve late_account_id from channel if not in context
  let lateAccountId = context.lateAccountId;
  if (!lateAccountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id, platform")
      .eq("id", context.channelId)
      .single();

    if (!channel) {
      console.error("No channel found for id:", context.channelId);
      return cancelRun(supabase, sessionId);
    }
    lateAccountId = channel.late_account_id;
    if (!context.platform) {
      context.platform = channel.platform as FlowExecutionContext["platform"];
    }
  }

  // Canal de prueba (lib/demo.ts): sin Zernio ni clave; el mensaje se guarda en `messages`.
  const demo = isDemoChannel(lateAccountId);
  if (!demo && !secrets.lateApiKey) {
    console.error("No Zernio API key for workspace:", context.workspaceId);
    return cancelRun(supabase, sessionId);
  }
  const zernio = demo ? null : createZernioClient(secrets.lateApiKey as string);

  // Resolve late_conversation_id from conversation if not in context
  let lateConversationId = context.lateConversationId;
  if (!lateConversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (!conversation?.late_conversation_id) {
      console.error("No late_conversation_id found for conversation:", context.conversationId);
      return cancelRun(supabase, sessionId);
    }
    lateConversationId = conversation.late_conversation_id;
  }

  // Historial del chat: de Zernio en canales reales (ahí viven los mensajes del
  // cliente), de la tabla local en los de prueba; más el mensaje actual.
  const contextMessages = data.contextMessages || 10;
  let history: AiMessage[] = [];
  if (zernio) {
    try {
      const res = await zernio.messages.getInboxConversationMessages({
        path: { conversationId: lateConversationId },
        query: { accountId: lateAccountId, limit: Math.min(100, contextMessages), sortOrder: "desc" },
      });
      if (zernioFailed(res)) {
        console.error("[ai] Zernio no devolvió el historial:", res.error);
      } else {
        const body = res.data as { messages?: ZernioListMessage[]; data?: ZernioListMessage[] } | undefined;
        history = aiMessagesFromZernio(body?.messages ?? body?.data ?? [], contextMessages);
      }
    } catch (err) {
      console.error("[ai] No se pudo leer el historial de Zernio:", err);
    }
  } else {
    const { data: recentMessages } = await supabase
      .from("messages")
      .select("direction, text")
      .eq("conversation_id", context.conversationId)
      .order("created_at", { ascending: false })
      .limit(contextMessages);
    history = aiMessagesFromLocal(recentMessages ?? []);
  }
  const aiMessages = withCurrentMessage(history, context.incomingMessage.text);
  if (aiMessages.length === 0) {
    console.error("[ai] no hay mensajes para responder en la conversación", context.conversationId);
    return cancelRun(supabase, sessionId);
  }

  try {
    const model = data.model || "openai/gpt-4o-mini";
    const aiGatewayKey = secrets.aiApiKey || process.env.AI_GATEWAY_API_KEY;
    const gw = createGateway({ apiKey: aiGatewayKey || undefined });
    const result = await generateText({
      model: gw(model),
      system: data.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT,
      messages: aiMessages,
      temperature: data.temperature ?? 0.7,
      maxOutputTokens: data.maxTokens ?? 500,
    });

    const text = result.text;

    // Expose the generated text to downstream nodes as {{ai_response}}
    context.variables = { ...(context.variables ?? {}), ai_response: text };

    if (data.sendDirectly !== false) {
      // Send via Zernio REST API (same pattern as executeSendMessage)
      let messageId: string | null = null;
      if (zernio) {
        const response = await zernio.messages.sendInboxMessage({
          path: { conversationId: lateConversationId },
          body: { accountId: lateAccountId, message: text },
        });
        if (zernioFailed(response)) throw new Error(zernioErrorMessage(response, "Zernio rechazó el mensaje"));
        messageId = response.data?.data?.messageId || null;
      } else {
        messageId = `demo-${crypto.randomUUID()}`;
      }

      // Store outbound message
      await supabase.from("messages").insert({
        conversation_id: context.conversationId,
        direction: "outbound",
        text,
        attachments: null,
        sent_by_flow_id: context.flowId,
        sent_by_node_id: null,
        platform_message_id: messageId,
        status: "sent",
      });

      // La bandeja refresca el chat abierto con la última actividad (M-9).
      await touchConversationAfterBotSend(supabase, context.conversationId, text);

      // Gestiones: el bot solo sella la salida (no cuenta como respuesta humana).
      await stampBotOutbound(supabase, { contactId: context.contactId });

      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: context.contactId,
        event_type: "message_sent",
      });
    }
  } catch (error) {
    console.error("Failed to generate or send AI response:", error);

    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text: "[Falló la respuesta con IA]",
      sent_by_flow_id: context.flowId,
      status: "failed",
      error_text: error instanceof Error ? error.message : null,
    });
    await touchConversationAfterBotSend(supabase, context.conversationId, null);

    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "message_failed",
      metadata: { error: error instanceof Error ? error.message : "Unknown error" },
    });

    return cancelRun(supabase, sessionId);
  }
}
