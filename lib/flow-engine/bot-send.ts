// Lo que deja el bot tras enviar un mensaje (o fallar al enviarlo): refresca la
// conversación para que la bandeja la vea en vivo (M-9) y detiene el flujo con
// una nota visible en la gestión cuando el envío falló (M-10).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { addSystemNote } from "@/lib/cases/changes";
import { messagePreview } from "@/lib/message-preview";
import { findTargetCase } from "./nodes/case-actions";
import type { FlowExecutionContext } from "./types";

type Db = SupabaseClient<Database>;

/**
 * Actualiza la última actividad y la vista previa de la conversación. Es lo que
 * hace refrescar el chat abierto y subir la conversación en la lista. En los
 * canales reales los mensajes del bot no pasan por ningún otro lugar que lo haga.
 */
export async function touchConversationAfterBotSend(
  db: Db,
  conversationId: string | null | undefined,
  text: string | null | undefined,
): Promise<void> {
  if (!conversationId) return;
  // Sin texto (un envío fallido) solo se mueve la última actividad: la vista
  // previa no debe mostrar algo que el cliente nunca recibió.
  const patch: { last_message_at: string; last_message_preview?: string } = { last_message_at: new Date().toISOString() };
  if (text) patch.last_message_preview = messagePreview(text);
  const { error } = await db.from("conversations").update(patch).eq("id", conversationId);
  if (error) console.error("[flows] no se pudo actualizar la conversación tras enviar:", error.message);
}

/**
 * El bot no pudo enviar un mensaje: el flujo se detiene (si siguiera, esperaría
 * una respuesta a un menú que el cliente nunca vio) y queda una nota interna en
 * la gestión para que un asesor retome el chat. Devuelve "pause" para cortar el recorrido.
 */
export async function haltFlowAfterSendFailure(
  db: Db,
  context: FlowExecutionContext,
  sessionId: string,
  reason: string,
): Promise<"pause"> {
  console.error(`[flows] envío fallido, se detiene el flujo ${context.flowId}: ${reason}`);
  const { error } = await db.from("flow_sessions").update({ status: "cancelled", waiting_for_input: false }).eq("id", sessionId);
  if (error) console.error("[flows] no se pudo cancelar la sesión tras el fallo:", error.message);
  try {
    const target = await findTargetCase(db, context);
    if (target) {
      await addSystemNote(db, {
        caseId: target.id,
        conversationId: context.conversationId,
        body: `El bot no pudo enviar un mensaje al cliente y se detuvo: ${reason}. Revisa el chat y responde a mano.`,
      });
    }
  } catch (err) {
    console.error("[flows] no se pudo guardar la nota del envío fallido", err);
  }
  return "pause";
}

/** ¿El flujo nació de algo que escribió el cliente (mensaje, botón, comentario)? */
export function hasCustomerInput(incoming: FlowExecutionContext["incomingMessage"] | undefined): boolean {
  return !!(incoming?.text || incoming?.postbackPayload || incoming?.quickReplyPayload || incoming?.callbackData);
}

/**
 * M-7: un cliente que pidió la baja no recibe mensajes automáticos que no sean
 * respuesta a lo que acaba de escribir (eventos de gestión, esperas de tiempo
 * que se retoman). Si es así, deja constancia, cancela la sesión y devuelve
 * "pause" para cortar el recorrido; si no, null.
 */
export async function blockIfUnsubscribed(
  db: Db,
  context: FlowExecutionContext,
  sessionId: string,
): Promise<"pause" | null> {
  if (hasCustomerInput(context.incomingMessage)) return null;
  const { data: contact } = await db.from("contacts").select("is_subscribed").eq("id", context.contactId).maybeSingle();
  if (!contact || contact.is_subscribed !== false) return null;
  console.warn(`[flows] mensaje no enviado (flujo ${context.flowId}): el contacto pidió la baja`);
  await db.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "message_skipped",
    metadata: { reason: "unsubscribed", detail: "El contacto pidió la baja" },
  });
  await db.from("flow_sessions").update({ status: "cancelled", waiting_for_input: false }).eq("id", sessionId);
  return "pause";
}
