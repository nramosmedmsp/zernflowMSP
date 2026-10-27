// Registro de los envíos de los asesores en `messages` (etapa D de la bandeja):
// la lista de Zernio no dice quién escribió cada mensaje ni recibe los avisos
// de entrega en vivo. Aquí queda el autor y el webhook actualiza el estado.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, MessageStatus } from "@/lib/types/database";
import { deliveryErrorText, type DeliveryErrorLike } from "@/lib/delivery-errors";

type Db = SupabaseClient<Database>;

/**
 * Guarda un envío de la bandeja (mensaje o plantilla). Un reintento con la
 * misma Idempotency-Key devuelve el mismo id de plataforma: no se duplica.
 */
export async function recordOutboundSend(
  db: Db,
  input: {
    conversationId: string;
    platformMessageId: string | null;
    text: string | null;
    attachments?: Json | null;
    userId: string;
    clientMessageId?: string | null;
    at: string;
  },
): Promise<void> {
  if (input.platformMessageId) {
    const { data: existing } = await db
      .from("messages")
      .select("id")
      .eq("conversation_id", input.conversationId)
      .eq("platform_message_id", input.platformMessageId)
      .limit(1)
      .maybeSingle();
    if (existing) return;
  }
  const { error } = await db.from("messages").insert({
    conversation_id: input.conversationId,
    direction: "outbound",
    text: input.text || null,
    attachments: input.attachments ?? null,
    platform_message_id: input.platformMessageId,
    sent_by_user_id: input.userId,
    client_message_id: input.clientMessageId ?? null,
    status: "sent",
    created_at: input.at,
  });
  if (error) console.error("[outbound-log] insert:", error.message);
}

export type DeliveryEvent = "message.delivered" | "message.read" | "message.failed";

const EVENT_STATUS: Record<DeliveryEvent, MessageStatus> = {
  "message.delivered": "delivered",
  "message.read": "read",
  "message.failed": "failed",
};

const RANK: Record<MessageStatus, number> = { pending: 0, sent: 1, delivered: 2, failed: 3, read: 4 };

/** Estado nuevo según el aviso de la plataforma, o null si no avanza (los ticks no retroceden). */
export function nextDeliveryStatus(current: MessageStatus, event: DeliveryEvent): MessageStatus | null {
  const next = EVENT_STATUS[event];
  return RANK[next] > RANK[current] ? next : null;
}

/**
 * Aplica un aviso de entrega (webhook de Zernio) al mensaje registrado. Si el
 * mensaje no salió desde el CRM (no hay fila), no hace nada.
 */
export async function applyDeliveryEvent(
  db: Db,
  input: {
    lateConversationId: string;
    platformMessageId: string;
    event: DeliveryEvent;
    statusAt: string | null;
    error?: (DeliveryErrorLike & { code?: number | null }) | null;
  },
): Promise<"updated" | "unchanged" | "not_found"> {
  const { data: conversation } = await db
    .from("conversations")
    .select("id")
    .eq("late_conversation_id", input.lateConversationId)
    .limit(1)
    .maybeSingle();
  if (!conversation) return "not_found";
  const { data: row } = await db
    .from("messages")
    .select("id, status")
    .eq("conversation_id", conversation.id)
    .eq("platform_message_id", input.platformMessageId)
    .limit(1)
    .maybeSingle();
  if (!row) return "not_found";
  const status = nextDeliveryStatus(row.status, input.event);
  if (!status) return "unchanged";
  const failed = status === "failed";
  const code = typeof input.error?.code === "number" ? input.error.code : null;
  const { error } = await db
    .from("messages")
    .update({
      status,
      status_at: input.statusAt ?? new Date().toISOString(),
      error_code: failed ? code : null,
      error_text: failed ? deliveryErrorText(input.error ?? null) : null,
    })
    .eq("id", row.id);
  if (error) {
    console.error("[outbound-log] update:", error.message);
    return "unchanged";
  }
  return "updated";
}
