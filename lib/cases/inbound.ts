// Mensajes entrantes y salientes (docs/FASE-1-TECNICO.md 3.1 y 3.2; fase 2:
// reparto solo en horario y respuesta fuera de horario).

import type { Json } from "@/lib/types/database";
import { assignCase, type AssignOutcome } from "./assign";
import { pickSuggestedCaseTypeId, resolveReopenStageId } from "./decisions";
import { runEventRules } from "./effects";
import { emitCaseOpened, emitStageChanged } from "./events";
import { firstOpenStageId, loadContact, logActivity, type CaseRow, type Db } from "./io";
import type { CaseMessenger } from "./messaging";
import { sendOffHoursReply, type OffHoursReplyOutcome } from "./off-hours";
import { botOutboundPatch, humanOutboundPatch, inboundPatch, shouldReopen } from "./rules";

export interface InboundResult {
  caseId: string;
  opened: boolean;
  reopened: boolean;
  assignment: AssignOutcome | null;
  /** Fase 2: respuesta fuera de horario (null si falló de forma inesperada). */
  offHoursReply: OffHoursReplyOutcome | null;
}

/** Tipo de gestión sugerido para el tipo de contacto (el primero por posición). */
export async function suggestedCaseTypeId(db: Db, workspaceId: string, contactTypeId: string | null) {
  if (!contactTypeId) return null;
  const { data } = await db
    .from("case_types")
    .select("id, position, suggested_for_contact_type_ids")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  return pickSuggestedCaseTypeId(data ?? [], contactTypeId);
}

/** Etapa a la que vuelve una gestión reabierta: la anterior al cierre si sigue abierta. */
async function reopenStageId(db: Db, row: CaseRow): Promise<string | null> {
  if (!row.case_type_id) return null;
  const { data: closed } = await db
    .from("activity")
    .select("from_value")
    .eq("case_id", row.id)
    .eq("type", "case_closed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: openStages } = await db
    .from("case_stages")
    .select("id, position")
    .eq("case_type_id", row.case_type_id)
    .eq("kind", "open")
    .is("archived_at", null);
  return resolveReopenStageId(closed?.from_value, openStages ?? []);
}

function parseOpenResult(data: Json | null): { caseId: string; created: boolean } | null {
  if (data && typeof data === "object" && !Array.isArray(data) && typeof data.case_id === "string") {
    return { caseId: data.case_id, created: data.created === true };
  }
  return null;
}

async function latestOpenCase(db: Db, contactId: string): Promise<CaseRow | null> {
  const { data } = await db
    .from("cases")
    .select("*")
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("opened_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Mensaje entrante (después de guardar contacto y conversación):
 * 1. usa la gestión abierta más reciente del contacto; si no hay, reabre la
 *    cerrada hace menos de 24 h o abre una nueva (tipo sugerido por el tipo
 *    de contacto, primera etapa abierta). Sin tipo de contacto, le pone el
 *    de por defecto;
 * 2. sella last_inbound_at y, si no había espera, waiting_since;
 * 3. si no tiene responsable, aplica el reparto (fuera de horario queda sin
 *    asignar y el cron la reparte al abrir);
 * 4. no pausa el bot; si la gestión es nueva, emite case_opened para los flujos;
 * 5. fuera de horario, envía la respuesta automática si está activa.
 */
export async function handleInbound(
  db: Db,
  params: {
    workspaceId: string;
    contactId: string;
    conversationId?: string | null;
    at?: string;
    /** Para las pruebas; por defecto envía por Zernio. */
    messenger?: CaseMessenger;
  },
): Promise<InboundResult | null> {
  const at = params.at ?? new Date().toISOString();
  const contact = await loadContact(db, params.workspaceId, params.contactId);
  if (!contact) {
    console.error("[cases] handleInbound: contact not in workspace", params.contactId);
    return null;
  }

  // 1a. Gestión abierta.
  let row = await latestOpenCase(db, contact.id);
  let opened = false;
  let reopened = false;

  // 1b. Reapertura dentro de 24 h.
  if (!row) {
    const { data: lastClosed } = await db
      .from("cases")
      .select("*")
      .eq("contact_id", contact.id)
      .in("status", ["won", "lost", "resolved"])
      .order("closed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (lastClosed && shouldReopen(lastClosed, at)) {
      const stageId = await reopenStageId(db, lastClosed);
      const { data: updated } = await db
        .from("cases")
        .update({
          status: "open",
          stage_id: stageId,
          closed_at: null,
          closed_by: null,
          outcome_reason_id: null,
          outcome_note: null,
          last_inbound_at: at,
          waiting_since: at,
        })
        .eq("id", lastClosed.id)
        .eq("status", lastClosed.status)
        .select("*");
      if (updated && updated.length > 0) {
        row = updated[0];
        reopened = true;
        await logActivity(db, {
          workspace_id: row.workspace_id,
          type: "case_reopened",
          case_id: row.id,
          contact_id: row.contact_id,
          conversation_id: params.conversationId ?? null,
          from_value: lastClosed.status,
          to_value: "open",
          meta: { closed_at: lastClosed.closed_at },
        });
        emitStageChanged(db, row, lastClosed.stage_id, row.stage_id);
      } else {
        // Otro mensaje simultáneo la reabrió primero.
        row = await latestOpenCase(db, contact.id);
      }
    }
  }

  // 1c. Gestión nueva.
  if (!row) {
    let contactTypeId = contact.contact_type_id;
    if (!contactTypeId) {
      const { data: def } = await db
        .from("contact_types")
        .select("id")
        .eq("workspace_id", contact.workspace_id)
        .eq("is_default", true)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (def) {
        const { data: set } = await db
          .from("contacts")
          .update({ contact_type_id: def.id })
          .eq("id", contact.id)
          .is("contact_type_id", null)
          .select("id");
        if (set && set.length > 0) {
          contactTypeId = def.id;
          await logActivity(db, {
            workspace_id: contact.workspace_id,
            type: "contact_type_changed",
            contact_id: contact.id,
            from_value: null,
            to_value: def.id,
            meta: { reason: "default" },
          });
        }
      }
    }

    const caseTypeId = await suggestedCaseTypeId(db, contact.workspace_id, contactTypeId);
    const stageId = caseTypeId ? await firstOpenStageId(db, caseTypeId) : null;
    const { data, error } = await db.rpc("open_inbound_case", {
      p_workspace_id: contact.workspace_id,
      p_contact_id: contact.id,
      p_case_type_id: caseTypeId,
      p_stage_id: stageId,
      p_at: at,
    });
    const result = parseOpenResult(data);
    if (error || !result) {
      console.error("[cases] open_inbound_case", error?.message);
      return null;
    }
    const { data: fresh } = await db.from("cases").select("*").eq("id", result.caseId).single();
    if (!fresh) return null;
    row = fresh;
    opened = result.created;
    if (opened) {
      await logActivity(db, {
        workspace_id: row.workspace_id,
        type: "case_opened",
        case_id: row.id,
        contact_id: row.contact_id,
        conversation_id: params.conversationId ?? null,
        to_value: row.case_type_id,
        meta: { origin: "inbound" },
      });
      if (row.case_type_id) {
        await runEventRules(db, {
          caseRow: row,
          ctx: { trigger: "on_open", stageId: row.stage_id, categoryId: null, outcomeReasonId: null },
          actorId: null,
        });
      }
      // Los flujos "Gestión nueva" corren con el tipo de contacto que quedó tras las reglas.
      const afterRules = await loadContact(db, contact.workspace_id, contact.id);
      emitCaseOpened(db, row, afterRules?.contact_type_id ?? contactTypeId);
    }
  }

  // 2. Sellos (la RPC y la reapertura ya los dejaron puestos).
  if (!opened && !reopened) {
    const { error } = await db.from("cases").update(inboundPatch(row, at)).eq("id", row.id);
    if (error) console.error("[cases] inbound stamp", error.message);
  }

  // 3. Reparto. Solo se avisa "sin asignar" cuando la gestión es nueva o se reabre.
  let assignment: AssignOutcome | null = null;
  if (!row.assignee_id) {
    assignment = await assignCase(db, row.id, { notifyIfUnassigned: opened || reopened, at: new Date(at) });
  }

  // 5. Respuesta fuera de horario. Un fallo no corta el webhook.
  let offHoursReply: OffHoursReplyOutcome | null = null;
  try {
    offHoursReply = await sendOffHoursReply(db, {
      caseId: row.id,
      conversationId: params.conversationId,
      at,
      messenger: params.messenger,
    });
  } catch (err) {
    console.error("[cases] off hours reply", err);
  }

  return { caseId: row.id, opened, reopened, assignment, offHoursReply };
}

/**
 * Respuesta de una persona desde el CRM: sella la salida, cierra la espera,
 * registra la primera respuesta humana y pausa el bot de la conversación (se
 * reanuda al cerrar la gestión).
 */
export async function handleHumanOutbound(
  db: Db,
  params: { caseId: string; userId: string; at?: string; conversationId?: string | null },
): Promise<void> {
  const at = params.at ?? new Date().toISOString();
  const { data: row } = await db
    .from("cases")
    .select("id, workspace_id, contact_id, status, waiting_since, first_response_at")
    .eq("id", params.caseId)
    .maybeSingle();
  if (!row) return;

  if (row.status === "open") {
    const { patch, firstResponseSeconds } = humanOutboundPatch(row, at);
    // first_response_at solo se fija si sigue vacío (dos respuestas simultáneas).
    let query = db.from("cases").update(patch).eq("id", row.id);
    if (patch.first_response_at) query = query.is("first_response_at", null);
    const { data: updated, error } = await query.select("id");
    if (error) console.error("[cases] human outbound", error.message);
    if (firstResponseSeconds !== null && updated && updated.length > 0) {
      await logActivity(db, {
        workspace_id: row.workspace_id,
        type: "first_response",
        case_id: row.id,
        contact_id: row.contact_id,
        conversation_id: params.conversationId ?? null,
        actor_id: params.userId,
        meta: { seconds: firstResponseSeconds, waiting_since: row.waiting_since },
      });
    } else if (patch.first_response_at && (!updated || updated.length === 0)) {
      // Otra respuesta fijó first_response_at primero: sellar igual la salida.
      await db
        .from("cases")
        .update({ last_outbound_at: at, waiting_since: null })
        .eq("id", row.id);
    }
  }

  let pause = db
    .from("conversations")
    .update({ is_automation_paused: true })
    .eq("workspace_id", row.workspace_id)
    .eq("contact_id", row.contact_id);
  if (params.conversationId) pause = pause.eq("id", params.conversationId);
  const { error: pauseError } = await pause;
  if (pauseError) console.error("[cases] pause automation", pauseError.message);
}

/**
 * Respuesta humana enviada en una conversación: la aplica a la gestión
 * abierta activa del contacto (la asignada a quien responde, o la más
 * reciente). Sin gestión abierta no hace nada.
 */
export async function handleHumanOutboundForConversation(
  db: Db,
  params: { conversationId: string; userId: string; at?: string },
): Promise<void> {
  const { data: conversation } = await db
    .from("conversations")
    .select("id, contact_id")
    .eq("id", params.conversationId)
    .maybeSingle();
  if (!conversation) return;
  const { data: open } = await db
    .from("cases")
    .select("id, assignee_id")
    .eq("contact_id", conversation.contact_id)
    .eq("status", "open")
    .order("opened_at", { ascending: false, nullsFirst: false });
  if (!open || open.length === 0) return;
  const target = open.find((c) => c.assignee_id === params.userId) ?? open[0];
  await handleHumanOutbound(db, {
    caseId: target.id,
    userId: params.userId,
    at: params.at,
    conversationId: conversation.id,
  });
}

/**
 * Salida automática (flujos, difusiones, secuencias, respuesta fuera de
 * horario, plantilla de proactivas; docs/FASE-2-TECNICO.md 3.5): solo sella
 * last_outbound_at de las gestiones abiertas del contacto (o de `caseId`). No
 * cuenta como respuesta humana ni corta la espera del cliente. Usa el cliente
 * de servicio y nunca lanza errores: un fallo solo se registra.
 */
export async function stampBotOutbound(
  db: Db,
  params: { contactId: string; at?: string; caseId?: string | null },
): Promise<void> {
  try {
    const at = params.at ?? new Date().toISOString();
    let query = db.from("cases").update(botOutboundPatch(at)).eq("contact_id", params.contactId).eq("status", "open");
    if (params.caseId) query = query.eq("id", params.caseId);
    const { error } = await query;
    if (error) console.error("[cases] bot outbound", error.message);
  } catch (err) {
    console.error("[cases] bot outbound", err);
  }
}
