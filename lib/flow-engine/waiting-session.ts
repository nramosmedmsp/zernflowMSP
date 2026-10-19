// Sesiones de flujo que esperan la respuesta del cliente (Espera inteligente).
// Lo usan el motor (executeFlow) y la entrada de mensajes (inbound-pipeline):
// un mensaje entrante retoma primero la sesión que espera, antes de buscar
// disparadores.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;
export type FlowSessionRow = Database["public"]["Tables"]["flow_sessions"]["Row"];

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;

/** Minutos que espera el nodo Espera inteligente (lo mismo que muestra el panel: 30 por defecto). */
export function smartDelayTimeoutMs(data: { timeout?: unknown; timeoutUnit?: unknown } | undefined): number {
  const timeout = typeof data?.timeout === "number" && data.timeout > 0 ? data.timeout : 30;
  const unit = data?.timeoutUnit === "hours" || data?.timeoutUnit === "days" ? data.timeoutUnit : "minutes";
  return timeout * UNIT_MS[unit];
}

/**
 * Sesión activa del contacto en el canal que espera su respuesta y cuya espera
 * no venció. Una sesión es del contacto en un canal, que es su conversación:
 * `flow_sessions` no guarda otra referencia a la conversación.
 *
 * Las esperas vencidas se marcan como `expired` (el mensaje ya no las retoma).
 * Si hubiera más de una, se toma la más reciente.
 */
export async function findWaitingSession(
  db: Db,
  params: { contactId: string; channelId: string; now?: Date },
): Promise<FlowSessionRow | null> {
  const now = params.now ?? new Date();
  const { data } = await db
    .from("flow_sessions")
    .select("*")
    .eq("contact_id", params.contactId)
    .eq("channel_id", params.channelId)
    .eq("status", "active")
    .eq("waiting_for_input", true)
    .order("updated_at", { ascending: false });

  const rows = (data ?? []) as FlowSessionRow[];
  const isExpired = (s: FlowSessionRow) => !!s.waiting_until && new Date(s.waiting_until).getTime() <= now.getTime();
  const expired = rows.filter(isExpired);
  if (expired.length > 0) {
    await db
      .from("flow_sessions")
      .update({ status: "expired", waiting_for_input: false })
      .in(
        "id",
        expired.map((s) => s.id),
      );
  }
  return rows.find((s) => !isExpired(s)) ?? null;
}

/**
 * Reserva la sesión para este mensaje: de dos mensajes seguidos solo uno la
 * retoma. Devuelve false si otro mensaje ya la tomó.
 */
export async function claimWaitingSession(db: Db, sessionId: string): Promise<boolean> {
  const { data } = await db
    .from("flow_sessions")
    .update({ waiting_for_input: false })
    .eq("id", sessionId)
    .eq("waiting_for_input", true)
    .eq("status", "active")
    .select("id");
  return (data?.length ?? 0) > 0;
}
