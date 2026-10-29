// Chat del mensaje entrante (webhook de Zernio): crea o actualiza la fila de
// conversations y suma uno a los no leídos.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { upsertContactForSender } from "@/lib/inbox-sync";

type Db = SupabaseClient<Database>;
type ConversationInsert = Database["public"]["Tables"]["conversations"]["Insert"];

export async function recordInboundConversation(
  supabase: Db,
  params: {
    workspaceId: string;
    channelId: string;
    contactId: string;
    platform: ConversationInsert["platform"];
    lateConversationId: string;
    preview: string;
    at: string;
  },
): Promise<{ id: string; is_automation_paused: boolean } | null> {
  // Sin unread_count: el upsert no debe reiniciar el contador de un chat que ya
  // existe (antes lo dejaba en 1 y el incremento lo llevaba siempre a 2).
  const { data: conversation, error } = await supabase
    .from("conversations")
    .upsert(
      {
        workspace_id: params.workspaceId,
        channel_id: params.channelId,
        contact_id: params.contactId,
        platform: params.platform,
        late_conversation_id: params.lateConversationId,
        status: "open",
        last_message_at: params.at,
        last_message_preview: params.preview,
        // Base de la ventana de 24 h de WhatsApp: en los canales reales los
        // mensajes del cliente no se guardan en `messages`, los guarda Zernio.
        last_inbound_at: params.at,
      },
      { onConflict: "channel_id,contact_id" },
    )
    .select("id, is_automation_paused")
    .single();

  if (error || !conversation) {
    console.error("[inbound] no se pudo guardar la conversación:", error?.message);
    return null;
  }

  // Un chat nuevo nace con 0 (valor por defecto) y queda en 1; uno existente suma 1.
  const { error: unreadError } = await supabase.rpc("increment_unread", {
    conv_id: conversation.id,
    preview: params.preview,
  });
  if (unreadError) {
    console.error("[inbound] no se pudo sumar el no leído:", unreadError.message);
    return null;
  }
  return conversation;
}

export type PreparedInbound =
  | {
      ok: true;
      contactId: string;
      /** El remitente ya era contacto en este canal (si no, es su primer mensaje). */
      existed: boolean;
      conversation: { id: string; is_automation_paused: boolean };
    }
  | { ok: false; error: string };

/**
 * Lo mínimo que debe quedar guardado antes de responder "ok" a Zernio (M-16):
 * el contacto, su chat y el no leído. Si falla, el webhook responde con error
 * para que Zernio reintente; lo demás (gestiones, bot) corre después de responder.
 */
export async function prepareInboundMessage(
  supabase: Db,
  params: {
    channel: { id: string; workspace_id: string; platform: ConversationInsert["platform"] };
    senderId: string;
    senderName: string;
    senderPicture: string | null;
    senderUsername: string | null;
    lateConversationId: string;
    preview: string;
    at: string;
  },
): Promise<PreparedInbound> {
  const contact = await upsertContactForSender({
    supabase,
    channel: params.channel,
    senderId: params.senderId,
    senderName: params.senderName,
    senderPicture: params.senderPicture,
    senderUsername: params.senderUsername,
    interactionAt: params.at,
  });
  if (!contact) return { ok: false, error: "no se pudo guardar el contacto" };

  const conversation = await recordInboundConversation(supabase, {
    workspaceId: params.channel.workspace_id,
    channelId: params.channel.id,
    contactId: contact.contactId,
    platform: params.channel.platform,
    lateConversationId: params.lateConversationId,
    preview: params.preview,
    at: params.at,
  });
  if (!conversation) {
    // Un contacto recién creado sin chat se borra: en el reintento de Zernio
    // volverá a ser un número nuevo (si no, perdería el flujo de bienvenida).
    if (!contact.existed) await supabase.from("contacts").delete().eq("id", contact.contactId);
    return { ok: false, error: "no se pudo guardar la conversación" };
  }

  return { ok: true, contactId: contact.contactId, existed: contact.existed, conversation };
}
