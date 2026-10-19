// Cambios sobre una gestión (docs/FASE-1-TECNICO.md 3.4). Sin permisos: los
// valida quien llama (lib/actions/cases.ts). Aquí se valida que todo lo que
// se referencia pertenezca al espacio de la gestión.

import { isActiveCaseStatus } from "@/lib/permissions";
import { CASE_NOT_FOUND } from "./access";
import { assignCase, loadAssignmentContext } from "./assign";
import { parseInstant } from "./dates";
import { runEventRules } from "./effects";
import { emitStageChanged } from "./events";
import {
  GENERIC_ERROR,
  caseLink,
  contactName,
  firstOpenStageId,
  isWorkspaceMember,
  loadActiveTeam,
  loadCase,
  loadCaseType,
  logActivity,
  notify,
  type CaseRow,
  type Db,
  type EngineResult,
} from "./io";
import { resolveTargetTeamId } from "./routing";
import { actorSeesContact, loadContactCaseSummaries, loadWorkspaceActor } from "./visibility";

export const CASE_CLOSED_MESSAGE = "La gestión ya está cerrada.";
export const MAX_NOTE_LENGTH = 5000;
export const MAX_NEXT_ACTION_NOTE_LENGTH = 500;

async function activeCase(db: Db, caseId: string): Promise<CaseRow | { error: string }> {
  const row = await loadCase(db, caseId);
  if (!row) return { error: CASE_NOT_FOUND };
  if (!isActiveCaseStatus(row.status)) return { error: CASE_CLOSED_MESSAGE };
  return row;
}

function isError(value: unknown): value is { error: string } {
  return !!value && typeof value === "object" && "error" in value;
}

/** Cambia la etapa (solo etapas abiertas: para cerrar se usa closeCase). */
export async function changeStage(
  db: Db,
  params: {
    caseId: string;
    stageId: string;
    actorId: string | null;
    /** Flujos que ya corrieron en esta cadena de eventos (evita bucles; ver case-triggers.ts). */
    flowChain?: readonly string[];
  },
): Promise<EngineResult> {
  const row = await activeCase(db, params.caseId);
  if (isError(row)) return row;
  if (!row.case_type_id) return { error: "Clasifica la gestión antes de cambiar la etapa." };
  if (row.stage_id === params.stageId) return { ok: true };

  const { data: stage } = await db
    .from("case_stages")
    .select("id, kind, archived_at")
    .eq("id", params.stageId)
    .eq("case_type_id", row.case_type_id)
    .maybeSingle();
  if (!stage || stage.archived_at) return { error: "La etapa no pertenece a este tipo de gestión." };
  if (stage.kind !== "open") return { error: "Para ganar, perder o resolver la gestión usa Cerrar." };

  const { error } = await db.from("cases").update({ stage_id: stage.id }).eq("id", row.id);
  if (error) return { error: GENERIC_ERROR };

  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: "stage_changed",
    case_id: row.id,
    contact_id: row.contact_id,
    actor_id: params.actorId,
    from_value: row.stage_id,
    to_value: stage.id,
  });
  emitStageChanged(db, row, row.stage_id, stage.id, params.flowChain);
  await runEventRules(db, {
    caseRow: { ...row, stage_id: stage.id },
    ctx: {
      trigger: "on_stage",
      stageId: stage.id,
      categoryId: row.category_id,
      outcomeReasonId: null,
    },
    actorId: params.actorId,
  });
  return { ok: true };
}

/**
 * Cambia el tipo: pasa a la primera etapa del tipo nuevo, borra la categoría
 * y, si cambia el equipo de destino, la reenvía (queda sin responsable y se
 * reparte de nuevo). Al clasificar una gestión "Sin clasificar" corre las
 * reglas de apertura del tipo.
 */
export async function classifyCase(
  db: Db,
  params: { caseId: string; caseTypeId: string; actorId: string | null; flowChain?: readonly string[] },
): Promise<EngineResult<{ rerouted: boolean }>> {
  const row = await activeCase(db, params.caseId);
  if (isError(row)) return row;
  if (row.case_type_id === params.caseTypeId) return { ok: true, rerouted: false };

  const type = await loadCaseType(db, row.workspace_id, params.caseTypeId);
  if (!type || type.archived_at) return { error: "El tipo de gestión no existe o está archivado." };
  const stageId = await firstOpenStageId(db, type.id);

  const patch: Partial<CaseRow> = { case_type_id: type.id, stage_id: stageId, category_id: null };

  // ¿Cambia el destino?
  let rerouted = false;
  if (row.status === "open") {
    const [{ data: contact }, ctx] = await Promise.all([
      db.from("contacts").select("owner_id, team_id").eq("id", row.contact_id).maybeSingle(),
      loadAssignmentContext(db, row.workspace_id),
    ]);
    const target = resolveTargetTeamId({
      caseTypeId: type.id,
      routing: type.routing,
      fixedTeamId: type.fixed_team_id,
      currentTeamId: null,
      contactOwnerId: contact?.owner_id ?? null,
      contactTeamId: contact?.team_id ?? null,
      teams: ctx.teams,
      teamMembers: ctx.teamMembers,
      members: ctx.members,
      workspaceMode: ctx.workspaceMode,
    });
    if (target !== row.team_id) {
      rerouted = true;
      patch.team_id = target;
      patch.assignee_id = null;
    }
  }

  const { error } = await db
    .from("cases")
    .update({
      case_type_id: patch.case_type_id,
      stage_id: patch.stage_id,
      category_id: null,
      ...(rerouted ? { team_id: patch.team_id ?? null, assignee_id: null } : {}),
    })
    .eq("id", row.id);
  if (error) return { error: GENERIC_ERROR };

  const base = { workspace_id: row.workspace_id, case_id: row.id, contact_id: row.contact_id, actor_id: params.actorId };
  await logActivity(db, [
    { ...base, type: "case_classified", from_value: row.case_type_id, to_value: type.id },
    ...(rerouted
      ? [
          { ...base, type: "team_changed" as const, from_value: row.team_id, to_value: patch.team_id ?? null, meta: { reason: "classified" } },
          ...(row.assignee_id
            ? [{ ...base, type: "unassigned" as const, from_value: row.assignee_id, meta: { reason: "rerouted" } }]
            : []),
        ]
      : []),
  ]);

  const fresh = { ...row, case_type_id: type.id, stage_id: stageId, category_id: null };
  emitStageChanged(db, fresh, row.stage_id, stageId, params.flowChain);
  if (row.case_type_id === null && row.status === "open") {
    await runEventRules(db, {
      caseRow: fresh,
      ctx: { trigger: "on_open", stageId, categoryId: null, outcomeReasonId: null },
      actorId: params.actorId,
    });
  }
  if (row.status === "open" && (rerouted || !row.assignee_id)) {
    await assignCase(db, row.id, { actorId: params.actorId });
  }
  return { ok: true, rerouted };
}

/** Fija la categoría (del mismo tipo). Una categoría prioritaria sube la prioridad. */
export async function setCategory(
  db: Db,
  params: { caseId: string; categoryId: string | null; actorId: string | null },
): Promise<EngineResult> {
  const row = await activeCase(db, params.caseId);
  if (isError(row)) return row;
  if (row.category_id === params.categoryId) return { ok: true };

  let priority = row.priority;
  if (params.categoryId) {
    if (!row.case_type_id) return { error: "Clasifica la gestión antes de elegir una categoría." };
    const { data: category } = await db
      .from("case_categories")
      .select("id, is_high_priority, archived_at")
      .eq("id", params.categoryId)
      .eq("case_type_id", row.case_type_id)
      .maybeSingle();
    if (!category || category.archived_at) return { error: "La categoría no pertenece a este tipo de gestión." };
    if (category.is_high_priority && (priority === "low" || priority === "normal")) priority = "high";
  }

  const { error } = await db
    .from("cases")
    .update({ category_id: params.categoryId, priority })
    .eq("id", row.id);
  if (error) return { error: GENERIC_ERROR };
  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: "case_classified",
    case_id: row.id,
    contact_id: row.contact_id,
    actor_id: params.actorId,
    from_value: row.category_id,
    to_value: params.categoryId,
    meta: { field: "category" },
  });
  return { ok: true };
}

async function teamIdsOf(db: Db, userId: string, teamIds: string[]): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const { data } = await db.from("team_members").select("team_id").eq("user_id", userId).in("team_id", teamIds);
  return (data ?? []).map((r) => r.team_id);
}

/** Si el contacto no tiene responsable y el destino es "al responsable", lo fija. */
async function setOwnerIfMissing(db: Db, row: CaseRow, userId: string, actorId: string | null) {
  let routing = "contact_owner";
  if (row.case_type_id) {
    const { data: type } = await db.from("case_types").select("routing").eq("id", row.case_type_id).maybeSingle();
    routing = type?.routing ?? "contact_owner";
  }
  if (routing !== "contact_owner") return;
  const { data: updated } = await db
    .from("contacts")
    .update({ owner_id: userId })
    .eq("id", row.contact_id)
    .is("owner_id", null)
    .select("id");
  if (updated && updated.length > 0) {
    await logActivity(db, {
      workspace_id: row.workspace_id,
      type: "owner_changed",
      contact_id: row.contact_id,
      case_id: row.id,
      actor_id: actorId,
      to_value: userId,
      meta: { reason: "assigned" },
    });
  }
}

/**
 * Asigna a una persona, o devuelve a la cola (`assigneeId` null). La persona
 * tiene que ser miembro del espacio y, si la gestión tiene equipo, de ese
 * equipo. Sella last_assigned_at para que el reparto por turnos lo cuente.
 */
export async function assignTo(
  db: Db,
  params: {
    caseId: string;
    assigneeId: string | null;
    actorId: string | null;
    /** Exigir que la persona sea del equipo de la gestión (por defecto sí; un administrador puede asignar a cualquiera). */
    enforceTeam?: boolean;
  },
): Promise<EngineResult> {
  const row = await activeCase(db, params.caseId);
  if (isError(row)) return row;
  if (row.assignee_id === params.assigneeId) return { ok: true };

  if (params.assigneeId) {
    if (!(await isWorkspaceMember(db, row.workspace_id, params.assigneeId))) {
      return { error: "La persona no es miembro de este espacio de trabajo." };
    }
    if (row.team_id && params.enforceTeam !== false) {
      const teams = await teamIdsOf(db, params.assigneeId, [row.team_id]);
      if (teams.length === 0) return { error: "La persona no pertenece al equipo de esta gestión." };
    }
  }

  const { error } = await db.from("cases").update({ assignee_id: params.assigneeId }).eq("id", row.id);
  if (error) return { error: GENERIC_ERROR };

  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: params.assigneeId ? "assigned" : "unassigned",
    case_id: row.id,
    contact_id: row.contact_id,
    actor_id: params.actorId,
    from_value: row.assignee_id,
    to_value: params.assigneeId,
    meta: { via: "manual" },
  });

  if (params.assigneeId) {
    await db
      .from("workspace_members")
      .update({ last_assigned_at: new Date().toISOString() })
      .eq("workspace_id", row.workspace_id)
      .eq("user_id", params.assigneeId);
    await setOwnerIfMissing(db, row, params.assigneeId, params.actorId);
    if (params.assigneeId !== params.actorId) {
      const [{ data: contact }, type] = await Promise.all([
        db.from("contacts").select("display_name").eq("id", row.contact_id).maybeSingle(),
        row.case_type_id ? loadCaseType(db, row.workspace_id, row.case_type_id) : Promise.resolve(null),
      ]);
      await notify(db, [
        {
          workspace_id: row.workspace_id,
          user_id: params.assigneeId,
          type: "case_assigned",
          title: `Nueva gestión asignada: ${contactName(contact)}`,
          body: type?.name ?? "Sin clasificar",
          link: caseLink(row.contact_id, row.id),
        },
      ]);
    }
  }
  return { ok: true };
}

/**
 * Cambia el equipo de la gestión. Con `assigneeId` la asigna a esa persona
 * (debe ser del equipo); sin él queda sin responsable y se reparte dentro del
 * equipo nuevo.
 */
export async function transferCase(
  db: Db,
  params: { caseId: string; teamId: string | null; assigneeId?: string | null; actorId: string | null },
): Promise<EngineResult> {
  const row = await activeCase(db, params.caseId);
  if (isError(row)) return row;

  if (params.teamId) {
    const team = await loadActiveTeam(db, row.workspace_id, params.teamId);
    if (!team) return { error: "El equipo no existe o está archivado." };
  }
  const assigneeId = params.assigneeId ?? null;
  if (assigneeId) {
    if (!(await isWorkspaceMember(db, row.workspace_id, assigneeId))) {
      return { error: "La persona no es miembro de este espacio de trabajo." };
    }
    if (params.teamId && (await teamIdsOf(db, assigneeId, [params.teamId])).length === 0) {
      return { error: "La persona no pertenece a ese equipo." };
    }
  }
  if (row.team_id === params.teamId && row.assignee_id === assigneeId) return { ok: true };

  const { error } = await db
    .from("cases")
    .update({ team_id: params.teamId, assignee_id: assigneeId })
    .eq("id", row.id);
  if (error) return { error: GENERIC_ERROR };

  const base = { workspace_id: row.workspace_id, case_id: row.id, contact_id: row.contact_id, actor_id: params.actorId };
  await logActivity(db, [
    {
      ...base,
      type: "transferred",
      from_value: row.team_id,
      to_value: params.teamId,
      meta: { from_assignee: row.assignee_id, to_assignee: assigneeId },
    },
    ...(row.assignee_id && row.assignee_id !== assigneeId
      ? [{ ...base, type: "unassigned" as const, from_value: row.assignee_id, to_value: null, meta: { reason: "transferred" } }]
      : []),
    ...(assigneeId && assigneeId !== row.assignee_id
      ? [{ ...base, type: "assigned" as const, from_value: row.assignee_id, to_value: assigneeId, meta: { via: "transfer" } }]
      : []),
  ]);

  if (assigneeId && assigneeId !== row.assignee_id) {
    await db
      .from("workspace_members")
      .update({ last_assigned_at: new Date().toISOString() })
      .eq("workspace_id", row.workspace_id)
      .eq("user_id", assigneeId);
    if (assigneeId !== params.actorId) {
      const { data: contact } = await db.from("contacts").select("display_name").eq("id", row.contact_id).maybeSingle();
      await notify(db, [
        {
          workspace_id: row.workspace_id,
          user_id: assigneeId,
          type: "case_assigned",
          title: `Gestión transferida a ti: ${contactName(contact)}`,
          link: caseLink(row.contact_id, row.id),
        },
      ]);
    }
  } else if (!assigneeId && row.status === "open") {
    await assignCase(db, row.id, { actorId: params.actorId });
  }
  return { ok: true };
}

/** Próximo contacto (fecha y nota). `at` null lo quita. */
export async function setNextAction(
  db: Db,
  params: { caseId: string; at: string | null; note?: string | null; actorId: string | null },
): Promise<EngineResult<{ nextActionAt: string | null }>> {
  const row = await activeCase(db, params.caseId);
  if (isError(row)) return row;

  const at = params.at ? parseInstant(params.at) : null;
  if (params.at && !at) return { error: "La fecha del próximo contacto no es válida." };
  const note = params.note?.trim() || null;
  if (note && note.length > MAX_NEXT_ACTION_NOTE_LENGTH) {
    return { error: `La nota del próximo contacto admite hasta ${MAX_NEXT_ACTION_NOTE_LENGTH} caracteres.` };
  }

  const { error } = await db
    .from("cases")
    .update({ next_action_at: at, next_action_note: at ? note : null, next_action_notified_at: null })
    .eq("id", row.id);
  if (error) return { error: GENERIC_ERROR };

  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: "next_action_set",
    case_id: row.id,
    contact_id: row.contact_id,
    actor_id: params.actorId,
    from_value: row.next_action_at,
    to_value: at,
    meta: note ? { note } : {},
  });
  return { ok: true, nextActionAt: at };
}

/**
 * Nota interna. Las menciones se limitan a miembros del espacio; solo se
 * notifica a quienes pueden ver el contacto (la notificación incluye el texto).
 */
export async function addNote(
  db: Db,
  params: {
    caseId: string;
    body: string;
    mentions?: readonly string[];
    actorId: string;
    conversationId?: string | null;
  },
): Promise<EngineResult<{ noteId: string; notified: string[]; notNotified: string[] }>> {
  const row = await loadCase(db, params.caseId);
  if (!row) return { error: CASE_NOT_FOUND };

  const body = params.body.trim();
  if (!body) return { error: "La nota está vacía." };
  if (body.length > MAX_NOTE_LENGTH) return { error: `La nota admite hasta ${MAX_NOTE_LENGTH} caracteres.` };

  let conversationId: string | null = null;
  if (params.conversationId) {
    const { data: conv } = await db
      .from("conversations")
      .select("id")
      .eq("id", params.conversationId)
      .eq("contact_id", row.contact_id)
      .eq("workspace_id", row.workspace_id)
      .maybeSingle();
    if (!conv) return { error: "La conversación no pertenece a este contacto." };
    conversationId = conv.id;
  }

  const requested = [...new Set(params.mentions ?? [])].filter((id) => id && id !== params.actorId);
  let mentions: string[] = [];
  if (requested.length > 0) {
    const { data: members } = await db
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", row.workspace_id)
      .in("user_id", requested);
    const valid = new Set((members ?? []).map((m) => m.user_id));
    mentions = requested.filter((id) => valid.has(id));
  }

  const { data: note, error } = await db
    .from("case_notes")
    .insert({
      workspace_id: row.workspace_id,
      case_id: row.id,
      contact_id: row.contact_id,
      conversation_id: conversationId,
      author_id: params.actorId,
      body,
      mentions,
    })
    .select("id")
    .single();
  if (error || !note) return { error: GENERIC_ERROR };

  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: "note_added",
    case_id: row.id,
    contact_id: row.contact_id,
    conversation_id: conversationId,
    actor_id: params.actorId,
    meta: { note_id: note.id, mentions },
  });

  const notified: string[] = [];
  const notNotified: string[] = [];
  if (mentions.length > 0) {
    const [{ data: contact }, summaries] = await Promise.all([
      db.from("contacts").select("display_name, owner_id, team_id").eq("id", row.contact_id).maybeSingle(),
      loadContactCaseSummaries(db, row.contact_id),
    ]);
    for (const userId of mentions) {
      const actor = await loadWorkspaceActor(db, row.workspace_id, userId);
      if (contact && actorSeesContact(actor, contact, summaries)) notified.push(userId);
      else notNotified.push(userId);
    }
    await notify(
      db,
      notified.map((userId) => ({
        workspace_id: row.workspace_id,
        user_id: userId,
        type: "mention" as const,
        title: `Te mencionaron en ${contactName(contact)}`,
        body,
        link: caseLink(row.contact_id, row.id),
      })),
    );
  }
  return { ok: true, noteId: note.id, notified, notNotified };
}

/**
 * Nota interna escrita por el sistema (sin autor), por ejemplo la del nodo
 * Atención humana de un flujo. `case_notes.author_id` admite null; la política
 * de inserción exige autor solo a quien escribe con sesión de usuario, y el
 * motor escribe con el cliente de servicio. No menciona ni notifica a nadie.
 */
export async function addSystemNote(
  db: Db,
  params: { caseId: string; body: string; conversationId?: string | null },
): Promise<EngineResult<{ noteId: string }>> {
  const row = await loadCase(db, params.caseId);
  if (!row) return { error: CASE_NOT_FOUND };

  const body = params.body.trim().slice(0, MAX_NOTE_LENGTH);
  if (!body) return { error: "La nota está vacía." };

  let conversationId: string | null = null;
  if (params.conversationId) {
    const { data: conv } = await db
      .from("conversations")
      .select("id")
      .eq("id", params.conversationId)
      .eq("contact_id", row.contact_id)
      .eq("workspace_id", row.workspace_id)
      .maybeSingle();
    conversationId = conv?.id ?? null;
  }

  const { data: note, error } = await db
    .from("case_notes")
    .insert({
      workspace_id: row.workspace_id,
      case_id: row.id,
      contact_id: row.contact_id,
      conversation_id: conversationId,
      author_id: null,
      body,
      mentions: [],
    })
    .select("id")
    .single();
  if (error || !note) return { error: GENERIC_ERROR };

  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: "note_added",
    case_id: row.id,
    contact_id: row.contact_id,
    conversation_id: conversationId,
    actor_id: null,
    meta: { note_id: note.id, mentions: [], source: "flow" },
  });
  return { ok: true, noteId: note.id };
}
