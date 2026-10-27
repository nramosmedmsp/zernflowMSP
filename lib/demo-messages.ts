// Guardado local de mensajes de canales de prueba (ver lib/demo.ts). Todo
// envío que iría a Zernio se guarda en `messages` con el cliente de servicio y
// actualiza la vista previa de la conversación. Sin llamadas de red.

import { inboundPreview } from "@/lib/message-preview";
import type { Db } from "@/lib/cases/io";
import { phoneDigits } from "@/lib/whatsapp-templates";

export interface DemoMessageInput {
  conversationId: string;
  direction: "inbound" | "outbound";
  text: string;
  at?: string;
  sentByUserId?: string | null;
  sentByFlowId?: string | null;
  /** Actualiza last_message_at y la vista previa de la conversación (por defecto sí). */
  touchConversation?: boolean;
  /** Adjuntos (solo el tipo; el archivo queda en message_media). */
  attachments?: Array<{ type: string }> | null;
}

export type DemoStoreResult = { ok: true; messageId: string; createdAt: string } | { ok: false; error: string };

/** Guarda un mensaje en `messages` y actualiza la vista previa de la conversación. */
export async function storeDemoMessage(db: Db, input: DemoMessageInput): Promise<DemoStoreResult> {
  const at = input.at ?? new Date().toISOString();
  const { data, error } = await db
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      direction: input.direction,
      text: input.text || null,
      attachments: input.attachments?.length ? input.attachments : null,
      platform_message_id: `demo-${crypto.randomUUID()}`,
      sent_by_user_id: input.sentByUserId ?? null,
      sent_by_flow_id: input.sentByFlowId ?? null,
      status: "sent",
      created_at: at,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "No se pudo guardar el mensaje de prueba." };

  if (input.touchConversation !== false) {
    await db
      .from("conversations")
      .update({ last_message_at: at, last_message_preview: inboundPreview({ text: input.text, attachments: input.attachments }) })
      .eq("id", input.conversationId);
  }
  return { ok: true, messageId: data.id, createdAt: at };
}

/** Conversación de un canal de prueba por su ID de conversación "falso". */
export async function demoConversationByLateId(
  db: Db,
  workspaceId: string,
  lateConversationId: string,
): Promise<string | null> {
  const { data } = await db
    .from("conversations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("late_conversation_id", lateConversationId)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Conversación del contacto con ese teléfono en el canal de prueba (la
 * plantilla llega por teléfono, como en createInboxConversation). Si el
 * contacto está vinculado al canal pero aún no tiene conversación, la crea.
 */
export async function demoConversationByPhone(
  db: Db,
  params: { workspaceId: string; lateAccountId: string; phone: string },
): Promise<string | null> {
  const { data: channel } = await db
    .from("channels")
    .select("id, platform")
    .eq("workspace_id", params.workspaceId)
    .eq("late_account_id", params.lateAccountId)
    .maybeSingle();
  if (!channel) return null;

  const digits = phoneDigits(params.phone);
  const { data: link } = await db
    .from("contact_channels")
    .select("contact_id")
    .eq("channel_id", channel.id)
    .in("platform_sender_id", [digits, `+${digits}`])
    .limit(1)
    .maybeSingle();
  if (!link) return null;

  const { data: existing } = await db
    .from("conversations")
    .select("id")
    .eq("channel_id", channel.id)
    .eq("contact_id", link.contact_id)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created } = await db
    .from("conversations")
    .insert({
      workspace_id: params.workspaceId,
      channel_id: channel.id,
      contact_id: link.contact_id,
      platform: channel.platform,
      late_conversation_id: `demo-conv-${crypto.randomUUID()}`,
      status: "open",
    })
    .select("id")
    .single();
  return created?.id ?? null;
}
