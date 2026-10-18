// Disparadores de flujos por eventos de gestión (docs/FASE-2-TECNICO.md 3.6 y 4).
//
// Contrato con el motor de gestiones (lib/cases/events.ts), que la llama sin
// esperar su resultado y captura sus errores.
//
// Cuándo emite el motor cada evento:
// - case_stage_changed: cada cambio de etapa (persona, bot, cierre,
//   reclasificación, reapertura y la plantilla automática). `stageId` es la
//   etapa NUEVA (puede ser null en una gestión sin clasificar).
// - case_closed: al cerrar; `outcome` es el resultado y `stageId` la etapa
//   final.
// - client_no_reply: lo detecta el cron (lib/cases/no-reply.ts). Una gestión
//   abierta espera respuesta del cliente cuando su último mensaje saliente
//   (last_outbound_at, humano o bot) es posterior al último entrante y el
//   cliente no tiene una pregunta pendiente (waiting_since null). Los umbrales
//   son los `config.minutes` (por defecto DEFAULT_NO_REPLY_MINUTES) de los
//   disparadores client_no_reply activos de flujos publicados del espacio. Se
//   emite un evento por umbral y por mensaje saliente, del menor al mayor;
//   antes de emitirlo el cron sella en la gestión
//   `no_reply_event_outbound_at` (el last_outbound_at) y
//   `no_reply_event_minutes` (el umbral alcanzado). Aquí se lee
//   `no_reply_event_minutes` de la gestión y se ejecutan solo los
//   disparadores con ese mismo `minutes`.
//
// Protección contra bucles: el evento puede traer `chain`, los ids de los
// flujos que ya corrieron en la sucesión que lo provocó (lo rellenan los
// nodos de flujo al llamar a lib/cases). Un flujo no corre si ya está en la
// cadena y la cadena tiene un largo máximo (MAX_CASE_FLOW_CHAIN).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  CASE_EVENT_VARIABLE,
  CASE_ID_VARIABLE,
  DEFAULT_NO_REPLY_MINUTES,
  FLOW_CHAIN_VARIABLE,
  MAX_CASE_FLOW_CHAIN,
  extendFlowChain,
  selectCaseTriggers,
  serializeFlowChain,
  type CaseFlowEventType,
} from "./case-trigger-match";

export { DEFAULT_NO_REPLY_MINUTES };
export type { CaseFlowEventType };

export type CaseFlowEvent = {
  type: CaseFlowEventType;
  workspaceId: string;
  caseId: string;
  contactId: string;
  caseTypeId: string | null;
  stageId: string | null;
  outcome?: "won" | "lost" | "resolved";
  /** Ids de los flujos que ya corrieron en la cadena que provocó este evento. */
  chain?: string[];
};

type Service = SupabaseClient<Database>;

interface EventConversation {
  id: string;
  channel_id: string;
  late_conversation_id: string | null;
  is_automation_paused: boolean;
}

const CONVERSATION_COLUMNS = "id, channel_id, late_conversation_id, is_automation_paused";

/**
 * Conversación donde corre el flujo: la más reciente con la gestión (la del
 * último registro de la gestión que apunta a una conversación) y, si no hay,
 * la conversación más reciente del contacto.
 */
async function pickConversation(service: Service, event: CaseFlowEvent): Promise<EventConversation | null> {
  const { data: act } = await service
    .from("activity")
    .select("conversation_id")
    .eq("case_id", event.caseId)
    .not("conversation_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (act?.conversation_id) {
    const { data: linked } = await service
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("id", act.conversation_id)
      .eq("contact_id", event.contactId)
      .eq("workspace_id", event.workspaceId)
      .maybeSingle();
    if (linked) return linked;
  }
  const { data: latest } = await service
    .from("conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("contact_id", event.contactId)
    .eq("workspace_id", event.workspaceId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return latest ?? null;
}

/**
 * Ejecuta los flujos cuyos disparadores coinciden con el evento, como lo hace
 * el webhook con los mensajes entrantes. No hace nada si no hay disparadores
 * que coincidan, si el contacto no tiene conversación o si el bot está en
 * pausa en ella.
 */
export async function runCaseEventFlows(service: Service, event: CaseFlowEvent): Promise<void> {
  if ((event.chain?.length ?? 0) >= MAX_CASE_FLOW_CHAIN) {
    console.warn(`[flows] cadena de eventos demasiado larga, se detiene (${event.type}, gestión ${event.caseId})`);
    return;
  }

  const { data: triggers, error } = await service
    .from("triggers")
    .select("id, flow_id, channel_id, type, config, priority, flows!inner(status, workspace_id)")
    .eq("type", event.type)
    .eq("is_active", true)
    .eq("flows.status", "published")
    .eq("flows.workspace_id", event.workspaceId)
    .order("priority", { ascending: false });
  if (error) {
    console.error(`[flows] disparadores de ${event.type}`, error.message);
    return;
  }
  if (!triggers || triggers.length === 0) return;

  // client_no_reply: el cron selló el umbral alcanzado en la gestión.
  let stampedMinutes: number | null = null;
  if (event.type === "client_no_reply") {
    const { data: row } = await service
      .from("cases")
      .select("status, no_reply_event_minutes")
      .eq("id", event.caseId)
      .maybeSingle();
    if (!row || row.status !== "open") return;
    stampedMinutes = row.no_reply_event_minutes;
    if (stampedMinutes === null) return;
  }

  const selected = selectCaseTriggers(triggers, event, stampedMinutes);
  if (selected.length === 0) return;

  const conversation = await pickConversation(service, event);
  if (!conversation) {
    console.warn(`[flows] ${event.type}: el contacto ${event.contactId} no tiene conversación, no se ejecutan flujos`);
    return;
  }
  if (conversation.is_automation_paused) return;

  const { executeFlow } = await import("./engine");
  for (const trigger of selected) {
    // El disparador puede estar limitado a un canal.
    if (trigger.channel_id && trigger.channel_id !== conversation.channel_id) continue;
    const chain = extendFlowChain(event.chain, trigger.flow_id);
    const variables: Record<string, string> = {
      [CASE_ID_VARIABLE]: event.caseId,
      [CASE_EVENT_VARIABLE]: event.type,
      [FLOW_CHAIN_VARIABLE]: serializeFlowChain(chain),
    };
    if (event.caseTypeId) variables.case_type_id = event.caseTypeId;
    if (event.stageId) variables.stage_id = event.stageId;
    if (event.outcome) variables.outcome = event.outcome;
    try {
      await executeFlow(service, {
        triggerId: trigger.id,
        flowId: trigger.flow_id,
        channelId: conversation.channel_id,
        contactId: event.contactId,
        conversationId: conversation.id,
        workspaceId: event.workspaceId,
        incomingMessage: {},
        lateConversationId: conversation.late_conversation_id ?? undefined,
        variables,
        // No reanuda la sesión que espera una respuesta del cliente: es un flujo nuevo.
        startFresh: true,
      });
    } catch (err) {
      console.error(`[flows] error al ejecutar el flujo ${trigger.flow_id} (${event.type})`, err);
    }
  }
}
