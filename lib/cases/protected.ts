// Control de reclamos (tipos de gestión protegidos, p. ej. Postventa): pedido
// de cierre "sin solución", aprobación o rechazo del supervisor y registro de
// la solución en proceso. Sin permisos: los valida quien llama
// (lib/actions/cases.ts). Lo puro está en protection.ts.

import { CASE_NOT_FOUND } from "./access";
import { checkClose, closeCase, type CloseCaseInput } from "./close";
import { parseInstant } from "./dates";
import type { RuleEffects } from "./effects";
import {
  GENERIC_ERROR,
  caseLink,
  contactName,
  loadCase,
  loadCaseType,
  loadContact,
  logActivity,
  notify,
  userDisplayName,
  type Db,
  type EngineResult,
} from "./io";
import { closeGate, closeRequestToJson, parseCloseRequest } from "./protection";
import { notifySupervisors } from "./supervisors";
import type { OutcomeKind } from "@/lib/types/database";

export const MAX_SOLUTION_NOTE_LENGTH = 1000;
export const MAX_REQUEST_COMMENT_LENGTH = 500;
const MAX_COMMITMENT_DAYS = 365;

export type CloseOrRequestResult =
  | { requested: false; status: OutcomeKind; effects: RuleEffects }
  | { requested: true };

/**
 * Cierre desde la interfaz con control de reclamos. En un tipo no protegido
 * cierra como siempre. En uno protegido: ganada o resuelta exige la nota;
 * "perdida" la cierra solo el supervisor y un asesor deja un pedido.
 */
export async function closeOrRequestClose(
  db: Db,
  input: CloseCaseInput & { actorId: string },
  options: { actorIsSupervisor: boolean },
  now: Date = new Date(),
): Promise<EngineResult<CloseOrRequestResult>> {
  const checked = await checkClose(db, input);
  if ("error" in checked) return checked;
  const { row, type } = checked;

  const note = input.note?.trim() || null;
  const gate = closeGate({
    isProtected: !!type?.protected,
    typeName: type?.name ?? "",
    kind: checked.kind,
    isSupervisor: options.actorIsSupervisor,
    note,
    hasPendingRequest: parseCloseRequest(row.close_request) !== null,
  });
  if ("error" in gate) return gate;

  if (gate.action === "close") {
    const closed = await closeCase(db, input, now);
    if ("error" in closed) return closed;
    return { ok: true, requested: false, status: closed.status, effects: closed.effects };
  }

  // Pedido de cierre: se guarda y se avisa a los supervisores.
  const requestedAt = now.toISOString();
  const request = closeRequestToJson({
    stageId: checked.stageId,
    reasonId: checked.outcomeReasonId,
    note,
    categoryId: input.categoryId === undefined ? null : checked.categoryId,
    requestedBy: input.actorId,
    requestedAt,
  });
  // Solo si sigue abierta y sin otro pedido (dos pedidos simultáneos no se pisan).
  const { data: saved, error } = await db
    .from("cases")
    .update({ close_request: request })
    .eq("id", row.id)
    .eq("status", "open")
    .is("close_request", null)
    .select("id");
  if (error) return { error: GENERIC_ERROR };
  if (!saved || saved.length === 0) {
    return { error: "Ya hay un pedido de cierre esperando la respuesta de un supervisor." };
  }

  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: "close_requested",
    case_id: row.id,
    contact_id: row.contact_id,
    actor_id: input.actorId,
    to_value: checked.kind,
    meta: {
      stage_id: checked.stageId,
      outcome_reason_id: checked.outcomeReasonId,
      ...(note ? { note } : {}),
    },
  });

  try {
    const [contact, actor, reason] = await Promise.all([
      loadContact(db, row.workspace_id, row.contact_id),
      userDisplayName(db, input.actorId),
      checked.outcomeReasonId
        ? db.from("case_outcome_reasons").select("name").eq("id", checked.outcomeReasonId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const detail = [reason.data?.name, note].filter(Boolean).join(" · ");
    await notifySupervisors(
      db,
      row,
      {
        type: "close_requested",
        title: `${actor} pide cerrar como «${checked.stageName ?? "Sin solución"}» la ${type?.name ?? "gestión"} de ${contactName(contact)}`,
        body: detail || null,
        link: caseLink(row.contact_id, row.id),
      },
      { exclude: [input.actorId] },
    );
  } catch (err) {
    console.error("[cases] notify close request", err);
  }
  return { ok: true, requested: true };
}

/**
 * El supervisor aprueba el pedido: cierra de verdad con lo que pidió el asesor
 * (quien aprueba queda como quien cerró) y avisa a quien lo pidió.
 */
export async function approveCloseRequest(
  db: Db,
  params: { caseId: string; actorId: string },
  now: Date = new Date(),
): Promise<EngineResult<{ status: OutcomeKind }>> {
  const row = await loadCase(db, params.caseId);
  if (!row) return { error: CASE_NOT_FOUND };
  const request = parseCloseRequest(row.close_request);
  if (!request) return { error: "No hay un pedido de cierre pendiente." };

  const closed = await closeCase(
    db,
    {
      caseId: row.id,
      stageId: request.stageId,
      outcomeReasonId: request.reasonId,
      categoryId: request.categoryId ?? undefined,
      note: request.note,
      actorId: params.actorId,
      activityMeta: {
        close_request: { requested_by: request.requestedBy, requested_at: request.requestedAt },
        approved_by: params.actorId,
      },
    },
    now,
  );
  if ("error" in closed) return closed;

  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: "close_request_approved",
    case_id: row.id,
    contact_id: row.contact_id,
    actor_id: params.actorId,
    to_value: closed.status,
    meta: { requested_by: request.requestedBy, requested_at: request.requestedAt },
  });

  try {
    if (request.requestedBy !== params.actorId) {
      const [contact, type, actor] = await Promise.all([
        loadContact(db, row.workspace_id, row.contact_id),
        row.case_type_id ? loadCaseType(db, row.workspace_id, row.case_type_id) : Promise.resolve(null),
        userDisplayName(db, params.actorId),
      ]);
      await notify(db, [
        {
          workspace_id: row.workspace_id,
          user_id: request.requestedBy,
          type: "close_request_approved",
          title: `${actor} aprobó cerrar la ${type?.name ?? "gestión"} de ${contactName(contact)}`,
          body: "Tu pedido de cierre fue aprobado y la gestión quedó cerrada.",
          link: caseLink(row.contact_id, row.id),
        },
      ]);
    }
    // Los demás supervisores ya reciben el aviso de cierre desde closeCase.
  } catch (err) {
    console.error("[cases] notify close approval", err);
  }
  return { ok: true, status: closed.status };
}

/** El supervisor rechaza el pedido: la gestión sigue abierta y se avisa a quien lo pidió. */
export async function rejectCloseRequest(
  db: Db,
  params: { caseId: string; actorId: string; comment?: string | null },
): Promise<EngineResult> {
  const row = await loadCase(db, params.caseId);
  if (!row) return { error: CASE_NOT_FOUND };
  const request = parseCloseRequest(row.close_request);
  if (!request) return { error: "No hay un pedido de cierre pendiente." };

  const comment = params.comment?.trim() || null;
  if (comment && comment.length > MAX_REQUEST_COMMENT_LENGTH) {
    return { error: `El comentario admite hasta ${MAX_REQUEST_COMMENT_LENGTH} caracteres.` };
  }

  const { data: cleared, error } = await db
    .from("cases")
    .update({ close_request: null })
    .eq("id", row.id)
    .not("close_request", "is", null)
    .select("id");
  if (error) return { error: GENERIC_ERROR };
  if (!cleared || cleared.length === 0) return { error: "El pedido de cierre ya fue resuelto." };

  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: "close_request_rejected",
    case_id: row.id,
    contact_id: row.contact_id,
    actor_id: params.actorId,
    meta: { requested_by: request.requestedBy, ...(comment ? { comment } : {}) },
  });

  try {
    const [contact, type, actor] = await Promise.all([
      loadContact(db, row.workspace_id, row.contact_id),
      row.case_type_id ? loadCaseType(db, row.workspace_id, row.case_type_id) : Promise.resolve(null),
      userDisplayName(db, params.actorId),
    ]);
    const link = caseLink(row.contact_id, row.id);
    const title = `${actor} rechazó cerrar la ${type?.name ?? "gestión"} de ${contactName(contact)}`;
    if (request.requestedBy !== params.actorId) {
      await notify(db, [
        {
          workspace_id: row.workspace_id,
          user_id: request.requestedBy,
          type: "close_request_rejected",
          title,
          body: comment ?? "La gestión sigue abierta: hay que darle una solución.",
          link,
        },
      ]);
    }
    if (type?.protected) {
      await notifySupervisors(
        db,
        row,
        { type: "close_request_rejected", title, body: comment, link },
        { exclude: [params.actorId, request.requestedBy] },
      );
    }
  } catch (err) {
    console.error("[cases] notify close rejection", err);
  }
  return { ok: true };
}

/**
 * Registra que la solución está en proceso: qué se está haciendo y hasta
 * cuándo (fecha compromiso, que queda como próximo contacto). Cuenta como
 * cumplir el plazo del tipo. Se puede volver a registrar para actualizarla.
 */
export async function registerSolutionInProgress(
  db: Db,
  params: { caseId: string; note: string; commitmentAt: string; actorId: string },
  now: Date = new Date(),
): Promise<EngineResult<{ commitmentAt: string }>> {
  const row = await loadCase(db, params.caseId);
  if (!row) return { error: CASE_NOT_FOUND };
  if (row.status !== "open") return { error: "La gestión no está abierta." };

  const type = row.case_type_id ? await loadCaseType(db, row.workspace_id, row.case_type_id) : null;
  if (!type?.solution_deadline_hours) return { error: "Este tipo de gestión no pide registrar la solución." };

  const note = typeof params.note === "string" ? params.note.trim() : "";
  if (!note) return { error: "Cuenta qué solución se está dando." };
  if (note.length > MAX_SOLUTION_NOTE_LENGTH) {
    return { error: `La solución admite hasta ${MAX_SOLUTION_NOTE_LENGTH} caracteres.` };
  }

  const commitment = params.commitmentAt ? parseInstant(params.commitmentAt) : null;
  if (!commitment) return { error: "Indica la fecha compromiso." };
  const at = new Date(commitment).getTime();
  if (at <= now.getTime()) return { error: "La fecha compromiso tiene que ser futura." };
  if (at - now.getTime() > MAX_COMMITMENT_DAYS * 86_400_000) {
    return { error: "La fecha compromiso es demasiado lejana." };
  }

  const stamp = now.toISOString();
  const { data: updated, error } = await db
    .from("cases")
    .update({
      solution_status: "in_progress",
      solution_note: note,
      solution_at: stamp,
      solution_by: params.actorId,
      next_action_at: commitment,
      next_action_note: `Compromiso: ${note}`.slice(0, 500),
      next_action_notified_at: null,
      commitment_alerted_at: null,
    })
    .eq("id", row.id)
    .eq("status", "open")
    .select("id");
  if (error) return { error: GENERIC_ERROR };
  if (!updated || updated.length === 0) return { error: "La gestión ya no está abierta." };

  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: "solution_registered",
    case_id: row.id,
    contact_id: row.contact_id,
    actor_id: params.actorId,
    from_value: row.solution_status,
    to_value: "in_progress",
    meta: { note, commitment_at: commitment },
  });
  return { ok: true, commitmentAt: commitment };
}
