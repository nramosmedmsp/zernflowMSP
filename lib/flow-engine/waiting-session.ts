// Sesiones de flujo que esperan la respuesta del cliente (Espera inteligente).
// Lo usan el motor (executeFlow) y la entrada de mensajes (inbound-pipeline):
// un mensaje entrante retoma primero la sesión que espera, antes de buscar
// disparadores.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { CASE_EVENT_VARIABLE } from "./case-trigger-match";

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

/**
 * Deja una sola espera por contacto y canal: las demás sesiones que esperan la
 * respuesta del cliente se cancelan (M-6). Sin esto, dos flujos que preguntan
 * a la vez se reparten las respuestas y el bot contesta fuera de contexto.
 */
export async function cancelOtherWaitingSessions(
  db: Db,
  params: { sessionId: string; contactId: string; channelId: string },
): Promise<void> {
  const { error } = await db
    .from("flow_sessions")
    .update({ status: "cancelled", waiting_for_input: false })
    .eq("contact_id", params.contactId)
    .eq("channel_id", params.channelId)
    .eq("status", "active")
    .eq("waiting_for_input", true)
    .neq("id", params.sessionId);
  if (error) console.error("[flows] no se pudieron cancelar las otras esperas:", error.message);
}

/**
 * Cancela las sesiones activas del contacto (las que esperan su respuesta y las
 * que esperan un tiempo) en los canales indicados. Se usa al pausar el bot
 * porque un asesor tomó el chat (M-11, B-16): lo que el bot preguntó antes ya
 * no tiene contexto y no debe retomarse ni seguir enviando.
 */
export async function cancelActiveSessions(
  db: Db,
  params: { contactId: string; channelIds: readonly string[] },
): Promise<void> {
  if (params.channelIds.length === 0) return;
  const { error } = await db
    .from("flow_sessions")
    .update({ status: "cancelled", waiting_for_input: false })
    .eq("contact_id", params.contactId)
    .in("channel_id", [...params.channelIds])
    .eq("status", "active");
  if (error) console.error("[flows] no se pudieron cancelar las sesiones del bot:", error.message);
}

/**
 * B-16: al terminar una espera de tiempo, si un asesor tomó el chat (bot en
 * pausa) la sesión se cancela y no envía nada. Los flujos de eventos de gestión
 * se exceptúan: se configuraron para correr aunque el bot esté en pausa.
 */
export async function shouldCancelResumeForPausedBot(
  db: Db,
  params: { variables: unknown; conversationId: string | null | undefined },
): Promise<boolean> {
  if (!params.conversationId) return false;
  const vars = (params.variables ?? {}) as Record<string, unknown>;
  if (vars[CASE_EVENT_VARIABLE]) return false;
  const { data } = await db
    .from("conversations")
    .select("is_automation_paused")
    .eq("id", params.conversationId)
    .maybeSingle();
  return data?.is_automation_paused === true;
}
