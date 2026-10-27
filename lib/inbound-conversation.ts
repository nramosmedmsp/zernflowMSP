// Chat del mensaje entrante (webhook de Zernio): crea o actualiza la fila de
// conversations y suma uno a los no leídos.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

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
  const { data: conversation } = await supabase
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
      },
      { onConflict: "channel_id,contact_id" },
    )
    .select("id, is_automation_paused")
    .single();

  if (!conversation) return null;

  // Un chat nuevo nace con 0 (valor por defecto) y queda en 1; uno existente suma 1.
  await supabase.rpc("increment_unread", { conv_id: conversation.id, preview: params.preview });
  return conversation;
}
