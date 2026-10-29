// Lo que sigue a guardar un mensaje entrante (contacto y conversación ya
// guardados): motor de gestiones y flujos. Lo comparten el webhook de Zernio
// (app/api/webhooks/late/route.ts) y la simulación de mensajes de canales de
// prueba (lib/actions/demo.ts), para que se comporten igual.

import type { SupabaseClient } from "@supabase/supabase-js";
import { flagComplaint, handleInbound } from "@/lib/cases";
import { executeFlow, FlowLoadError, resumeSession } from "@/lib/flow-engine/engine";
import { resolveGlobalKeyword, type GlobalKeyword } from "@/lib/flow-engine/global-keywords";
import { applyWaitingMenuReply } from "@/lib/flow-engine/menu-reply";
import { matchTrigger } from "@/lib/flow-engine/trigger-matcher";
import { claimWaitingSession, findWaitingSession } from "@/lib/flow-engine/waiting-session";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;
type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];

export interface InboundPipelineInput {
  channel: ChannelRow;
  contactId: string;
  conversation: { id: string; is_automation_paused: boolean };
  /** Primer mensaje del contacto en el canal (dispara el flujo de bienvenida). */
  isFirstMessage: boolean;
  message: {
    text?: string | null;
    postbackPayload?: string;
    quickReplyPayload?: string;
    callbackData?: string;
    sender: { id: string; name: string; username?: string | null };
  };
  lateConversationId: string;
  lateAccountId: string;
  /** Fecha del mensaje (ISO); por defecto ahora. */
  at?: string;
}

export async function runInboundPipeline(supabase: Db, input: InboundPipelineInput): Promise<void> {
  const { channel, contactId, conversation, message: msg } = input;

  // ── Gestiones (docs/FASE-1-TECNICO.md 3.1) ───────────────────────────────
  // Abre o retoma la gestión del contacto y la reparte. Un fallo aquí no debe
  // impedir que corran los flujos.
  try {
    await handleInbound(supabase, {
      workspaceId: channel.workspace_id,
      contactId,
      conversationId: conversation.id,
      at: input.at ?? new Date().toISOString(),
      text: msg.text,
    });
  } catch (err) {
    console.error("Case engine (handleInbound) error:", err);
  }

  // ── Detector de reclamos (control de reclamos) ───────────────────────────
  // Si el texto parece un reclamo y no hay una Postventa abierta, marca la
  // conversación. Solo consulta la base cuando el texto coincide; un fallo no
  // corta el flujo. Ya corre después de responder al webhook (after()).
  try {
    await flagComplaint(supabase, {
      workspaceId: channel.workspace_id,
      contactId,
      conversationId: conversation.id,
      text: msg.text,
      at: input.at ?? new Date().toISOString(),
    });
  } catch (err) {
    console.error("Complaint detector error:", err);
  }

  // ── Volumen de mensajes entrantes (fase 3) ───────────────────────────────
  // Un evento por mensaje del cliente; un fallo no corta el flujo.
  try {
    const { error } = await supabase.from("analytics_events").insert({
      workspace_id: channel.workspace_id,
      contact_id: contactId,
      event_type: "message_received",
      metadata: { platform: channel.platform },
    });
    if (error) console.error("message_received analytics error:", error.message);
  } catch (err) {
    console.error("message_received analytics error:", err);
  }

  // ── Flow engine ───────────────────────────────────────────────────────────

  // Con el bot en pausa (hay un asesor atendiendo) el mensaje del cliente no
  // activa palabras clave, bienvenida ni retoma esperas. Los flujos de eventos
  // de gestión (lib/flow-engine/case-triggers.ts) sí corren.
  if (conversation.is_automation_paused) return;

  const incomingMessage = {
    text: msg.text || undefined,
    postbackPayload: msg.postbackPayload || undefined,
    quickReplyPayload: msg.quickReplyPayload || undefined,
    callbackData: msg.callbackData || undefined,
    sender: {
      id: msg.sender.id,
      name: msg.sender.name,
      username: msg.sender.username || undefined,
    },
  };

  // Las palabras clave globales (baja, alta) van primero.
  const handled = await handleGlobalKeywords(supabase, channel.workspace_id, contactId, msg.text || undefined);
  if (handled) return;

  // Si el contacto tiene una sesión esperando su respuesta (Espera inteligente)
  // y la espera no venció, el mensaje la retoma sin buscar disparadores: así
  // respuestas como "1" o "Sede 2" no necesitan coincidir con una palabra clave.
  const waiting = await findWaitingSession(supabase, { contactId, channelId: channel.id });
  if (waiting) {
    if (!(await claimWaitingSession(supabase, waiting.id))) return; // otro mensaje la retomó
    // "1", "2." o el texto exacto de una opción del último menú del bot retoman la
    // espera como esa opción: el mensaje pasa a ser el título (y la carga) del botón.
    const reply = applyWaitingMenuReply(waiting.variables, incomingMessage);
    try {
      await resumeSession(supabase, waiting, {
        triggerId: "",
        flowId: waiting.flow_id,
        channelId: channel.id,
        contactId,
        conversationId: conversation.id,
        workspaceId: channel.workspace_id,
        incomingMessage: reply.incoming,
        lateConversationId: input.lateConversationId,
        lateAccountId: input.lateAccountId,
      });
    } catch (err) {
      console.error("Flow resume error:", err);
      // Un fallo pasajero al leer el flujo no consume la espera: la próxima respuesta lo reintenta.
      if (err instanceof FlowLoadError) {
        await supabase.from("flow_sessions").update({ waiting_for_input: true }).eq("id", waiting.id);
      }
    }
    return;
  }

  const trigger = await matchTrigger(supabase, {
    channelId: channel.id,
    workspaceId: channel.workspace_id,
    conversationId: conversation.id,
    message: incomingMessage,
    isFirstMessage: input.isFirstMessage,
  });
  if (!trigger) return;

  try {
    await executeFlow(supabase, {
      triggerId: trigger.id,
      flowId: trigger.flow_id,
      channelId: channel.id,
      contactId,
      conversationId: conversation.id,
      workspaceId: channel.workspace_id,
      incomingMessage,
      lateConversationId: input.lateConversationId,
      lateAccountId: input.lateAccountId,
    });
  } catch (err) {
    console.error("Flow execution error:", err);
  }
}

// ── Global keywords ─────────────────────────────────────────────────────────

async function handleGlobalKeywords(
  supabase: Db,
  workspaceId: string,
  contactId: string,
  text: string | undefined,
): Promise<boolean> {
  if (!text) return false;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("global_keywords")
    .eq("id", workspaceId)
    .single();

  if (!workspace?.global_keywords) return false;

  const result = resolveGlobalKeyword(text, workspace.global_keywords as unknown as GlobalKeyword[]);
  if (!result.handled) return false;

  await supabase
    .from("contacts")
    .update({ is_subscribed: result.action === "subscribe" })
    .eq("id", contactId);
  return true;
}
