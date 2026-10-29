// Apertura manual de una gestión (docs/PLAN-CRM.md 3.5 "Manual").

import { assignCase, loadAssignmentContext, type AssignOutcome } from "./assign";
import { resolveTargetTeamId } from "./routing";
import { parseInstant } from "./dates";
import { sameTypeConfirmMessage } from "./parallel";
import { runEventRules, scheduleCase } from "./effects";
import {
  GENERIC_ERROR,
  clearComplaintFlag,
  firstOpenStageId,
  isWorkspaceMember,
  loadCaseType,
  loadContact,
  logActivity,
  type Db,
  type EngineResult,
} from "./io";

export const PAST_SCHEDULE_MESSAGE =
  "La fecha programada ya pasó. Elige una fecha futura (a partir de mañana) o abre la gestión ahora, sin fecha.";

export interface OpenCaseInput {
  workspaceId: string;
  contactId: string;
  /** null = Sin clasificar. */
  caseTypeId?: string | null;
  actorId: string | null;
  /**
   * A quién se asigna: un usuario del espacio, o "auto" para aplicar el
   * reparto. Por defecto, a quien la abre.
   */
  assignee?: string | "auto" | null;
  /** Si es futura, la gestión queda programada para esa fecha. */
  scheduledFor?: string | null;
  /**
   * Solo asigna a la persona indicada si es del equipo de destino de la
   * gestión; si no lo es, queda sin responsable y se reparte sola.
   */
  assigneeOnlyIfInTeam?: boolean;
}

export async function openCase(
  db: Db,
  input: OpenCaseInput,
  now: Date = new Date(),
): Promise<EngineResult<{ caseId: string; status: "open" | "scheduled"; assignment: AssignOutcome | null }>> {
  const contact = await loadContact(db, input.workspaceId, input.contactId);
  if (!contact) return { error: "El contacto no existe en este espacio de trabajo." };

  let caseType: Awaited<ReturnType<typeof loadCaseType>> = null;
  if (input.caseTypeId) {
    caseType = await loadCaseType(db, input.workspaceId, input.caseTypeId);
    if (!caseType || caseType.archived_at) return { error: "El tipo de gestión no existe o está archivado." };
  }
  const caseTypeId = caseType?.id ?? null;

  let scheduledFor: string | null = null;
  if (input.scheduledFor) {
    scheduledFor = parseInstant(input.scheduledFor);
    if (!scheduledFor) return { error: "La fecha programada no es válida." };
    // Una fecha que ya pasó (p. ej. «hoy» sin hora, que se toma como las 09:00)
    // no se abre en silencio: la persona cree que la dejó para más tarde.
    if (new Date(scheduledFor).getTime() <= now.getTime()) return { error: PAST_SCHEDULE_MESSAGE };
  }

  const explicitAssignee = input.assignee && input.assignee !== "auto" ? input.assignee : null;
  let assigneeId = input.assignee === "auto" ? null : (explicitAssignee ?? input.actorId);
  if (assigneeId && !(await isWorkspaceMember(db, input.workspaceId, assigneeId))) {
    return { error: "La persona no es miembro de este espacio de trabajo." };
  }

  if (scheduledFor) {
    if (!caseTypeId) return { error: "Elige el tipo de la gestión programada." };
    const result = await scheduleCase(db, {
      workspaceId: input.workspaceId,
      contactId: contact.id,
      caseTypeId,
      scheduledFor,
      actorId: input.actorId,
      origin: "manual",
    });
    if (!result) return { error: GENERIC_ERROR };
    return { ok: true, caseId: result.caseId, status: "scheduled", assignment: null };
  }

  const stageId = caseTypeId ? await firstOpenStageId(db, caseTypeId) : null;
  // Equipo de destino (para que su supervisor la vea aunque se asigne a mano).
  const ctx = await loadAssignmentContext(db, input.workspaceId);
  const teamId = resolveTargetTeamId({
    caseTypeId,
    routing: caseType?.routing ?? "contact_owner",
    fixedTeamId: caseType?.fixed_team_id ?? null,
    currentTeamId: null,
    contactOwnerId: contact.owner_id,
    contactTeamId: contact.team_id,
    teams: ctx.teams,
    teamMembers: ctx.teamMembers,
    members: ctx.members,
    workspaceMode: ctx.workspaceMode,
  });
  if (input.assigneeOnlyIfInTeam && assigneeId && teamId) {
    const { data: membership } = await db
      .from("team_members")
      .select("team_id")
      .eq("team_id", teamId)
      .eq("user_id", assigneeId)
      .maybeSingle();
    if (!membership) assigneeId = null;
  }
  const openedAt = now.toISOString();
  const { data: created, error } = await db
    .from("cases")
    .insert({
      workspace_id: input.workspaceId,
      contact_id: contact.id,
      case_type_id: caseTypeId,
      stage_id: stageId,
      status: "open",
      origin: "manual",
      opened_at: openedAt,
      team_id: teamId,
      assignee_id: assigneeId,
      created_by: input.actorId,
    })
    .select("*")
    .single();
  if (error || !created) return { error: GENERIC_ERROR };

  const base = { workspace_id: input.workspaceId, case_id: created.id, contact_id: contact.id, actor_id: input.actorId };
  await logActivity(db, [
    { ...base, type: "case_opened", to_value: caseTypeId, meta: { origin: "manual" } },
    ...(assigneeId ? [{ ...base, type: "assigned" as const, to_value: assigneeId, meta: { via: "manual" } }] : []),
  ]);
  if (assigneeId) {
    await db
      .from("workspace_members")
      .update({ last_assigned_at: openedAt })
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", assigneeId);
  }
  // Una Postventa nueva atiende cualquier aviso de reclamo anterior del contacto.
  if (caseType?.protected) await clearComplaintFlag(db, input.workspaceId, contact.id);
  if (caseTypeId) {
    await runEventRules(db, {
      caseRow: created,
      ctx: { trigger: "on_open", stageId, categoryId: null, outcomeReasonId: null },
      actorId: input.actorId,
      now,
    });
  }

  const assignment = assigneeId ? null : await assignCase(db, created.id, { actorId: input.actorId });
  return { ok: true, caseId: created.id, status: "open", assignment };
}

// ── Gestión paralela (M-32) ────────────────────────────────────────────────

export interface OpenCaseSummary {
  id: string;
  caseTypeId: string | null;
  status: "open" | "scheduled";
}

/** Gestiones abiertas o programadas del contacto. */
export async function listActiveCases(db: Db, workspaceId: string, contactId: string): Promise<OpenCaseSummary[]> {
  const { data } = await db
    .from("cases")
    .select("id, case_type_id, status")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .in("status", ["open", "scheduled"]);
  return (data ?? []).map((c) => ({
    id: c.id,
    caseTypeId: c.case_type_id,
    status: c.status as "open" | "scheduled",
  }));
}

export const SAME_TYPE_OPEN_MESSAGE =
  "Este contacto ya tiene una gestión abierta de ese tipo. Ve a esa gestión en vez de abrir otra igual.";
export const PARALLEL_CONFIRM_MESSAGE =
  "Este contacto ya tiene otra gestión abierta. Confirma que quieres abrir una en paralelo.";

/**
 * Regla de «Nueva gestión» a mano: una gestión abierta por contacto por
 * defecto. Del mismo tipo (o ambas sin clasificar) se bloquea, salvo que el
 * tipo admita paralelas (`sameTypeAllowed`), y entonces pide confirmación;
 * de otro tipo solo con confirmación expresa. Devuelve el mensaje o null.
 */
export function parallelOpeningError(
  existing: readonly OpenCaseSummary[],
  caseTypeId: string | null,
  confirmed: boolean,
  sameType: { allowed: boolean; typeName?: string } = { allowed: false },
): string | null {
  if (existing.length === 0) return null;
  if (existing.some((c) => c.caseTypeId === caseTypeId)) {
    if (!sameType.allowed || !caseTypeId) return SAME_TYPE_OPEN_MESSAGE;
    return confirmed ? null : sameTypeConfirmMessage(sameType.typeName ?? "gestión");
  }
  return confirmed ? null : PARALLEL_CONFIRM_MESSAGE;
}
