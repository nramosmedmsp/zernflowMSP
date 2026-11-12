// Lo que sigue a guardar un mensaje entrante (contacto y conversación ya
// guardados): motor de gestiones y flujos. Lo comparten el webhook de Zernio
// (app/api/webhooks/late/route.ts) y la simulación de mensajes de canales de
// prueba (lib/actions/demo.ts), para que se comporten igual.

import type { SupabaseClient } from "@supabase/supabase-js";
import { flagComplaint, handleInbound } from "@/lib/cases";
import { executeFlow, FlowLoadError, resumeSession } from "@/lib/flow-engine/engine";
import { resolveGlobalKeyword } from "@/lib/flow-engine/global-keywords";
import { logActivity } from "@/lib/cases/io";
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

/**
 * Para reprocesar un evento sin repetir lo ya hecho (lib/inbound-events.ts):
 * lo que ya se hizo se salta y el avance se avisa por las funciones `on*`.
 */
export interface InboundPipelineOptions {
  /** La gestión ya se abrió/retomó en un intento anterior. */
  skipCases?: boolean;
  /** Los flujos ya empezaron en un intento anterior: nunca se repiten (evita responder dos veces). */
  skipFlows?: boolean;
  /** Reintento: no volver a contar el mensaje en analítica. */
  skipAnalytics?: boolean;
  onCasesDone?: () => Promise<void> | void;
  onFlowsStart?: () => Promise<void> | void;
}

export interface InboundPipelineResult {
  /** false = falló abrir/retomar la gestión (el reintento solo repite esa parte). */
  casesOk: boolean;
  casesError?: string;
}

export async function runInboundPipeline(
  supabase: Db,
  input: InboundPipelineInput,
  opts: InboundPipelineOptions = {},
): Promise<InboundPipelineResult> {
  const { channel, contactId, conversation, message: msg } = input;
  const result: InboundPipelineResult = { casesOk: true };

  // ── Gestiones (docs/FASE-1-TECNICO.md 3.1) ───────────────────────────────
  // Abre o retoma la gestión del contacto y la reparte. Un fallo aquí no debe
  // impedir que corran los flujos.
  let openedCaseId: string | null = null;
  if (!opts.skipCases) {
    try {
      const handled = await handleInbound(supabase, {
        workspaceId: channel.workspace_id,
        contactId,
        conversationId: conversation.id,
        at: input.at ?? new Date().toISOString(),
        text: msg.text,
      });
      // handleInbound devuelve null cuando no pudo abrir ni retomar la gestión
      // (lo registra y no lanza): sin gestión no se da por hecho el paso.
      if (!handled) throw new Error("no se pudo abrir ni retomar la gestión");
      if (handled.opened) openedCaseId = handled.caseId;
      await opts.onCasesDone?.();
    } catch (err) {
      console.error("Case engine (handleInbound) error:", err);
      result.casesOk = false;
      result.casesError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Detector de reclamos (control de reclamos) ───────────────────────────
  // Si el texto parece un reclamo y no hay una Postventa abierta, marca la
  // conversación. Solo consulta la base cuando el texto coincide; un fallo no
  // corta el flujo. Ya corre después de responder al webhook (after()).
  if (!opts.skipCases) {
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
  }

  // ── Volumen de mensajes entrantes (fase 3) ───────────────────────────────
  // Un evento por mensaje del cliente; un fallo no corta el flujo.
  if (!opts.skipAnalytics) {
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
  }

  // ── Flow engine ───────────────────────────────────────────────────────────

  // Con el bot en pausa (hay un asesor atendiendo) el mensaje del cliente no
  // activa palabras clave, bienvenida ni retoma esperas. Los flujos de eventos
  // de gestión (lib/flow-engine/case-triggers.ts) sí corren.
  //
  // Desde aquí los flujos se consideran empezados: un reintento no los repite
  // (mejor no responder que responderle dos veces al cliente).
  if (opts.skipFlows) return result;
  try {
    await opts.onFlowsStart?.();
  } catch (err) {
    console.error("Inbound onFlowsStart error:", err);
  }
  if (conversation.is_automation_paused) return result;

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
  // Un fallo aquí (datos dañados, base caída) no debe tumbar el mensaje: se
  // registra y el mensaje sigue su camino como si no hubiera coincidido.
  let handled = false;
  try {
    handled = await handleGlobalKeywords(supabase, channel, contactId, conversation.id, msg.text || undefined);
  } catch (err) {
    console.error("Global keywords error:", err);
  }
  if (handled) return result;

  // Si el contacto tiene una sesión esperando su respuesta (Espera inteligente)
  // y la espera no venció, el mensaje la retoma sin buscar disparadores: así
  // respuestas como "1" o "Sede 2" no necesitan coincidir con una palabra clave.
  // El saludo de «Gestión nueva» que abrió este mismo mensaje no cuenta: espera la siguiente respuesta.
  const waiting = await findWaitingSession(supabase, {
    contactId,
    channelId: channel.id,
    openedByThisMessageCaseId: openedCaseId,
  });
  if (waiting) {
    if (!(await claimWaitingSession(supabase, waiting.id))) return result; // otro mensaje la retomó
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
    return result;
  }

  const trigger = await matchTrigger(supabase, {
    channelId: channel.id,
    workspaceId: channel.workspace_id,
    conversationId: conversation.id,
    message: incomingMessage,
    isFirstMessage: input.isFirstMessage,
  });
  if (!trigger) return result;

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
      // Si este mensaje abrió la gestión, la espera que haya es el saludo de «Gestión nueva»
      // (arrancó a la vez): el flujo del disparador empieza de cero y no la retoma.
      ...(openedCaseId ? { startFresh: true } : {}),
    });
  } catch (err) {
    console.error("Flow execution error:", err);
  }

  return result;
}

// ── Global keywords ─────────────────────────────────────────────────────────

async function handleGlobalKeywords(
  supabase: Db,
  channel: ChannelRow,
  contactId: string,
  conversationId: string,
  text: string | undefined,
): Promise<boolean> {
  if (!text) return false;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("global_keywords")
    .eq("id", channel.workspace_id)
    .single();

  if (!workspace?.global_keywords) return false;

  // Tolera textos sueltos, objetos y datos dañados sin lanzar.
  const result = resolveGlobalKeyword(text, workspace.global_keywords);
  if (!result.handled) return false;

  const { error } = await supabase
    .from("contacts")
    .update({ is_subscribed: result.action === "subscribe" })
    .eq("id", contactId);
  // Si no se pudo guardar, no se da por atendida: el mensaje sigue y queda el error.
  if (error) throw new Error(`no se pudo cambiar la suscripción: ${error.message}`);

  // Deja rastro con el origen (después nadie sabría por qué dejó de recibir difusiones).
  await logActivity(supabase, {
    workspace_id: channel.workspace_id,
    type: result.action === "subscribe" ? "contact_subscribed" : "contact_unsubscribed",
    contact_id: contactId,
    conversation_id: conversationId,
    meta: { source: "keyword", keyword: result.keyword },
  });
  return true;
}
