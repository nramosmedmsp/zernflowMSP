// Marcar un chat como leído en la base (A-10). El constructor de consultas de
// supabase-js no envía nada hasta que se espera su resultado (await o .then):
// antes la llamada quedaba escrita pero nunca se ejecutaba y los no leídos
// volvían en cada recarga.
//
// Desde 00031 el usuario solo puede editar conversations.unread_count; el
// contador es uno solo para todo el equipo (marcar leído es para todos).

import type { SupabaseClient } from "@supabase/supabase-js";

export async function persistConversationRead(client: SupabaseClient, conversationId: string): Promise<boolean> {
  try {
    const { error } = await client.from("conversations").update({ unread_count: 0 }).eq("id", conversationId);
    if (error) {
      console.error("[inbox] no se pudo marcar el chat como leído:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[inbox] no se pudo marcar el chat como leído:", err);
    return false;
  }
}
