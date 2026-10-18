"use server";

// Acciones de servidor de los canales de prueba (lib/demo.ts). Solo para
// administradores y solo en conversaciones de canales de prueba.

import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { isDemoChannel } from "@/lib/demo";
import { storeDemoMessage } from "@/lib/demo-messages";
import { runInboundPipeline } from "@/lib/inbound-pipeline";
import { messagePreview } from "@/lib/message-preview";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";

const DEMO_TEXT_MAX = 1000;

export type SimulateInboundResult = { ok: true; messageId: string } | { error: string };

/**
 * Simula que el cliente escribió en una conversación de un canal de prueba:
 * guarda el mensaje entrante en `messages`, actualiza la conversación (vista
 * previa, no leídos y `last_message_at`) y corre lo mismo que el webhook real
 * (gestiones y flujos, lib/inbound-pipeline.ts).
 */
export async function simulateInboundMessage(conversationId: string, text: string): Promise<SimulateInboundResult> {
  const { workspace, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  const body = typeof text === "string" ? text.trim() : "";
  if (!body) return { error: "Escribe el mensaje del cliente." };
  if (body.length > DEMO_TEXT_MAX) return { error: `El mensaje puede tener hasta ${DEMO_TEXT_MAX} caracteres.` };
  if (typeof conversationId !== "string" || !conversationId) return { error: "Falta la conversación." };

  try {
    const service = await createServiceClient();
    const { data: conversation } = await service
      .from("conversations")
      .select("id, workspace_id, channel_id, contact_id, late_conversation_id, is_automation_paused, channels(*)")
      .eq("id", conversationId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    const channel = conversation?.channels ?? null;
    if (!conversation || !channel) return { error: "No se encontró la conversación." };
    if (!isDemoChannel(channel)) {
      return { error: "Solo se pueden simular mensajes en conversaciones de canales de prueba." };
    }

    const [{ data: contact }, { data: link }, { count: previousInbound }] = await Promise.all([
      service.from("contacts").select("display_name").eq("id", conversation.contact_id).maybeSingle(),
      service
        .from("contact_channels")
        .select("platform_sender_id, platform_username")
        .eq("contact_id", conversation.contact_id)
        .eq("channel_id", conversation.channel_id)
        .limit(1)
        .maybeSingle(),
      service
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversation.id)
        .eq("direction", "inbound"),
    ]);

    const at = new Date().toISOString();
    const stored = await storeDemoMessage(service, {
      conversationId: conversation.id,
      direction: "inbound",
      text: body,
      at,
      touchConversation: false,
    });
    if (!stored.ok) {
      console.error("[demo] simulateInboundMessage store:", stored.error);
      return { error: "No se pudo guardar el mensaje de prueba." };
    }

    // Igual que el webhook: vista previa, no leídos y última actividad.
    await service.rpc("increment_unread", { conv_id: conversation.id, preview: messagePreview(body) });
    await service.from("contacts").update({ last_interaction_at: at }).eq("id", conversation.contact_id);

    await runInboundPipeline(service, {
      channel,
      contactId: conversation.contact_id,
      conversation: { id: conversation.id, is_automation_paused: conversation.is_automation_paused },
      isFirstMessage: (previousInbound ?? 0) === 0,
      message: {
        text: body,
        sender: {
          id: link?.platform_sender_id ?? conversation.contact_id,
          name: contact?.display_name ?? "Cliente de prueba",
          username: link?.platform_username ?? null,
        },
      },
      lateConversationId: conversation.late_conversation_id ?? `demo-conv-${conversation.id}`,
      lateAccountId: channel.late_account_id,
      at,
    });

    return { ok: true, messageId: stored.messageId };
  } catch (err) {
    console.error("[demo] simulateInboundMessage:", err);
    return { error: "No se pudo simular el mensaje. Inténtalo de nuevo." };
  }
}
