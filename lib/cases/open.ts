// Apertura manual de una gestión (docs/PLAN-CRM.md 3.5 "Manual").

import { assignCase, loadAssignmentContext, type AssignOutcome } from "./assign";
import { resolveTargetTeamId } from "./routing";
import { parseInstant } from "./dates";
import { runEventRules, scheduleCase } from "./effects";
import {
  GENERIC_ERROR,
  firstOpenStageId,
  isWorkspaceMember,
  loadCaseType,
  loadContact,
  logActivity,
  type Db,
  type EngineResult,
} from "./io";

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
    if (new Date(scheduledFor).getTime() <= now.getTime()) scheduledFor = null;
  }

  const explicitAssignee = input.assignee && input.assignee !== "auto" ? input.assignee : null;
  const assigneeId = input.assignee === "auto" ? null : (explicitAssignee ?? input.actorId);
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
