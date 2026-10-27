"use server";

// Acciones de servidor de los canales de prueba (lib/demo.ts). Solo para
// administradores y solo en conversaciones de canales de prueba.

import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { isDemoChannel } from "@/lib/demo";
import { storeDemoMessage } from "@/lib/demo-messages";
import { runInboundPipeline } from "@/lib/inbound-pipeline";
import { inboundPreview } from "@/lib/message-preview";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import { ALLOWED_MIMES, MAX_FILE_BYTES, baseMime, classifyMime, conversationMediaPath, parseMediaPath, safeFileName } from "@/lib/chat-media";
import { createUploadUrl, objectInfo } from "@/lib/media-store";

const DEMO_TEXT_MAX = 1000;

export type SimulateInboundResult = { ok: true; messageId: string } | { error: string };

/** Archivo que "manda el cliente" en la simulación (ya subido a la carpeta del chat). */
export interface SimulatedAttachment {
  path: string;
  name: string;
}

/**
 * Enlace de subida para simular que el cliente manda una foto, un PDF o un
 * audio en un chat de prueba. El archivo queda en la carpeta de entrada del chat.
 */
export async function createDemoInboundUploadUrl(
  conversationId: string,
  file: { mime: string; size: number },
): Promise<{ ok: true; path: string; token: string } | { error: string }> {
  const { workspace, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };
  const mime = baseMime(file?.mime);
  if (!ALLOWED_MIMES.has(mime)) return { error: "Ese tipo de archivo no se puede usar." };
  if (typeof file?.size !== "number" || file.size > MAX_FILE_BYTES) return { error: "El archivo pesa más de 25 MB." };
  try {
    const service = await createServiceClient();
    const { data: conversation } = await service
      .from("conversations")
      .select("id, workspace_id, channels(*)")
      .eq("id", conversationId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (!conversation?.channels || !isDemoChannel(conversation.channels)) {
      return { error: "Solo se pueden simular mensajes en conversaciones de canales de prueba." };
    }
    const upload = await createUploadUrl(service, conversationMediaPath(workspace.id, conversation.id, "in", mime));
    if (!upload) return { error: "No se pudo preparar la subida." };
    return { ok: true, ...upload };
  } catch (err) {
    console.error("[demo] createDemoInboundUploadUrl:", err);
    return { error: "No se pudo preparar la subida." };
  }
}

/**
 * Simula que el cliente escribió en una conversación de un canal de prueba:
 * guarda el mensaje entrante en `messages`, actualiza la conversación (vista
 * previa, no leídos y `last_message_at`) y corre lo mismo que el webhook real
 * (gestiones y flujos, lib/inbound-pipeline.ts).
 */
export async function simulateInboundMessage(
  conversationId: string,
  text: string,
  attachment?: SimulatedAttachment | null,
): Promise<SimulateInboundResult> {
  const { workspace, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  const body = typeof text === "string" ? text.trim() : "";
  if (!body && !attachment) return { error: "Escribe el mensaje del cliente o adjunta un archivo." };
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

    // El archivo tiene que estar en la carpeta de entrada de este chat.
    let file: { path: string; name: string; mime: string; size: number; kind: ReturnType<typeof classifyMime> } | null = null;
    if (attachment) {
      const parsed = parseMediaPath(attachment.path);
      if (
        !parsed ||
        parsed.kind !== "conv" ||
        parsed.workspaceId !== workspace.id ||
        parsed.conversationId !== conversation.id ||
        parsed.direction !== "in"
      ) {
        return { error: "El archivo no es válido." };
      }
      const info = await objectInfo(service, attachment.path);
      if (!info) return { error: "El archivo no terminó de subir. Inténtalo de nuevo." };
      file = { path: attachment.path, name: safeFileName(attachment.name), mime: info.mime, size: info.size, kind: classifyMime(info.mime) };
    }
    const attachments = file ? [{ type: file.kind }] : null;

    const at = new Date().toISOString();
    const stored = await storeDemoMessage(service, {
      conversationId: conversation.id,
      direction: "inbound",
      text: body,
      at,
      touchConversation: false,
      attachments,
    });
    if (!stored.ok) {
      console.error("[demo] simulateInboundMessage store:", stored.error);
      return { error: "No se pudo guardar el mensaje de prueba." };
    }
    if (file) {
      const { error: mediaError } = await service.from("message_media").insert({
        workspace_id: workspace.id,
        conversation_id: conversation.id,
        platform_message_id: stored.messageId,
        attachment_index: 0,
        direction: "inbound",
        kind: file.kind,
        storage_path: file.path,
        mime_type: file.mime,
        file_name: file.name,
        size_bytes: file.size,
        status: "stored",
      });
      if (mediaError) console.error("[demo] simulateInboundMessage media:", mediaError.message);
    }

    // Igual que el webhook: vista previa, no leídos y última actividad.
    await service.rpc("increment_unread", { conv_id: conversation.id, preview: inboundPreview({ text: body, attachments }) });
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
