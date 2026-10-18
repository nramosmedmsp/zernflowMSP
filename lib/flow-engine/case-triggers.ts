// Disparadores de flujos por eventos de gestión (docs/FASE-2-TECNICO.md 3.6 y 4).
//
// La implementa la tanda 2. Por ahora solo fija el contrato con el motor de
// gestiones (lib/cases/events.ts), que la llama sin esperar su resultado y
// captura sus errores.
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
//   `no_reply_event_minutes` (el umbral alcanzado). Quien implemente esta
//   función debe leer `no_reply_event_minutes` de la gestión y ejecutar solo
//   los disparadores con ese mismo `minutes`.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export type CaseFlowEventType = "case_stage_changed" | "case_closed" | "client_no_reply";

export type CaseFlowEvent = {
  type: CaseFlowEventType;
  workspaceId: string;
  caseId: string;
  contactId: string;
  caseTypeId: string | null;
  stageId: string | null;
  outcome?: "won" | "lost" | "resolved";
};

/** Umbral de client_no_reply cuando el disparador no indica `minutes`. */
export const DEFAULT_NO_REPLY_MINUTES = 60;

/**
 * Ejecuta los flujos cuyos disparadores coinciden con el evento.
 * La implementa la tanda 2: por ahora no hace nada.
 */
export async function runCaseEventFlows(
  service: SupabaseClient<Database>,
  event: CaseFlowEvent,
): Promise<void> {
  void service;
  void event;
}
