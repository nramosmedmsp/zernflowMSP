// Nodos de gestión de los flujos (docs/FASE-2-TECNICO.md 4): Clasificar
// gestión, Cambiar etapa, Asignar a equipo y Repartir a asesor. Todas las
// acciones pasan por lib/cases con actor null (sistema), así que quedan en
// `activity` y respetan las reglas del motor de gestiones.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { assignCase, loadAssignmentContext } from "@/lib/cases/assign";
import { assignTo, changeStage, classifyCase, setCategory, transferCase } from "@/lib/cases/changes";
import { suggestedCaseTypeId } from "@/lib/cases/inbound";
import { isOpenAt } from "@/lib/cases/hours";
import { loadCase, loadCaseType, loadContact, type CaseRow } from "@/lib/cases/io";
import { openCase } from "@/lib/cases/open";
import { resolveTargetTeamId } from "@/lib/cases/routing";
import {
  CASE_ID_VARIABLE,
  FLOW_CHAIN_VARIABLE,
  extendFlowChain,
  parseFlowChain,
} from "../case-trigger-match";
import { buildCaseConditionSnapshot, type CaseConditionSnapshot } from "../case-conditions";
import type {
  AssignTeamNodeData,
  CaseActionType,
  ChangeStageNodeData,
  ClassifyCaseNodeData,
  DistributeCaseNodeData,
  FlowExecutionContext,
} from "../types";

type Db = SupabaseClient<Database>;

/** Cadena de flujos de este contexto, con el flujo en curso incluido. */
export function currentFlowChain(context: FlowExecutionContext): string[] {
  return extendFlowChain(parseFlowChain(context.variables?.[FLOW_CHAIN_VARIABLE]), context.flowId);
}

async function reportFailure(db: Db, context: FlowExecutionContext, nodeType: string, error: string) {
  console.error(`[flows] nodo ${nodeType} (flujo ${context.flowId}): ${error}`);
  await db.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "case_action_failed",
    metadata: { nodeType, error },
  });
}

/** La gestión del evento si sigue abierta; si no, la abierta más reciente del contacto. */
export async function findTargetCase(db: Db, context: FlowExecutionContext): Promise<CaseRow | null> {
  const fromEvent = context.variables?.[CASE_ID_VARIABLE];
  if (fromEvent) {
    const row = await loadCase(db, fromEvent);
    if (row && row.contact_id === context.contactId && (row.status === "open" || row.status === "scheduled")) return row;
  }
  const { data } = await db
    .from("cases")
    .select("*")
    .eq("contact_id", context.contactId)
    .eq("workspace_id", context.workspaceId)
    .eq("status", "open")
    .order("opened_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Gestión sobre la que actúa el nodo. Si el contacto no tiene una abierta,
 * abre una como lo haría un mensaje entrante: con el tipo pedido por el nodo
 * o, si no hay, el sugerido para el tipo de contacto, en su primera etapa y
 * con reparto automático.
 */
export async function ensureOpenCase(
  db: Db,
  context: FlowExecutionContext,
  wantedCaseTypeId?: string | null,
): Promise<{ row: CaseRow } | { error: string }> {
  const existing = await findTargetCase(db, context);
  if (existing) return { row: existing };

  const contact = await loadContact(db, context.workspaceId, context.contactId);
  if (!contact) return { error: "El contacto no existe en este espacio de trabajo." };
  const caseTypeId =
    wantedCaseTypeId ?? (await suggestedCaseTypeId(db, context.workspaceId, contact.contact_type_id));
  const opened = await openCase(db, {
    workspaceId: context.workspaceId,
    contactId: context.contactId,
    caseTypeId,
    actorId: null,
    assignee: "auto",
  });
  if ("error" in opened) return { error: opened.error };
  const row = await loadCase(db, opened.caseId);
  if (!row) return { error: "No se pudo abrir la gestión." };
  if (context.variables) context.variables[CASE_ID_VARIABLE] = row.id;
  return { row };
}

async function runClassify(db: Db, data: ClassifyCaseNodeData, context: FlowExecutionContext) {
  if (!data.caseTypeId) return "Elige el tipo de gestión en el nodo.";
  const ensured = await ensureOpenCase(db, context, data.caseTypeId);
  if ("error" in ensured) return ensured.error;
  const flowChain = currentFlowChain(context);
  const classified = await classifyCase(db, {
    caseId: ensured.row.id,
    caseTypeId: data.caseTypeId,
    actorId: null,
    flowChain,
  });
  if ("error" in classified) return classified.error;
  if (data.stageId) {
    const moved = await changeStage(db, { caseId: ensured.row.id, stageId: data.stageId, actorId: null, flowChain });
    if ("error" in moved) return moved.error;
  }
  if (data.categoryId) {
    // Categoría opcional del tipo elegido. Si no pertenece al tipo (o ya no
    // existe) se ignora: la gestión queda clasificada igual y se deja registro.
    const categorized = await setCategory(db, { caseId: ensured.row.id, categoryId: data.categoryId, actorId: null });
    if ("error" in categorized) {
      console.warn(
        `[flows] nodo classifyCase (flujo ${context.flowId}): categoría "${data.categoryName ?? data.categoryId}" ignorada: ${categorized.error}`,
      );
      await db.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: context.contactId,
        event_type: "case_category_ignored",
        metadata: { categoryId: data.categoryId, reason: categorized.error },
      });
    }
  }
  return null;
}

async function runChangeStage(db: Db, data: ChangeStageNodeData, context: FlowExecutionContext) {
  if (!data.stageId) return "Elige la etapa en el nodo.";
  const ensured = await ensureOpenCase(db, context);
  if ("error" in ensured) return ensured.error;
  const moved = await changeStage(db, {
    caseId: ensured.row.id,
    stageId: data.stageId,
    actorId: null,
    flowChain: currentFlowChain(context),
  });
  return "error" in moved ? moved.error : null;
}

async function runAssignTeam(db: Db, data: AssignTeamNodeData, context: FlowExecutionContext) {
  const mode = data.mode === "reroute" ? "reroute" : "fixed";
  if (mode === "fixed" && !data.teamId) return "Elige el equipo en el nodo.";
  const ensured = await ensureOpenCase(db, context);
  if ("error" in ensured) return ensured.error;
  const row = ensured.row;

  let teamId: string | null;
  if (mode === "fixed") {
    teamId = data.teamId ?? null;
  } else {
    // Re-ruteo: el equipo que corresponde según el tipo de gestión y el contacto.
    const [type, contact, ctx] = await Promise.all([
      row.case_type_id ? loadCaseType(db, row.workspace_id, row.case_type_id) : Promise.resolve(null),
      loadContact(db, row.workspace_id, row.contact_id),
      loadAssignmentContext(db, row.workspace_id),
    ]);
    teamId = resolveTargetTeamId({
      caseTypeId: type?.id ?? null,
      routing: type?.routing ?? "contact_owner",
      fixedTeamId: type?.fixed_team_id ?? null,
      currentTeamId: null,
      contactOwnerId: contact?.owner_id ?? null,
      contactTeamId: contact?.team_id ?? null,
      teams: ctx.teams,
      teamMembers: ctx.teamMembers,
      members: ctx.members,
      workspaceMode: ctx.workspaceMode,
    });
  }

  if (teamId !== row.team_id) {
    // Cambia el equipo; sin responsable, transferCase aplica el reparto del equipo nuevo.
    const moved = await transferCase(db, { caseId: row.id, teamId, assigneeId: null, actorId: null });
    return "error" in moved ? moved.error : null;
  }
  // Ya está en ese equipo: si no tiene responsable, se reparte.
  if (!row.assignee_id && row.status === "open") await assignCase(db, row.id, { actorId: null });
  return null;
}

async function runDistribute(db: Db, data: DistributeCaseNodeData, context: FlowExecutionContext) {
  const ensured = await ensureOpenCase(db, context);
  if ("error" in ensured) return ensured.error;
  const row = ensured.row;
  if (row.status !== "open") return null;
  if (row.assignee_id) {
    if (!data.replaceAssignee) return null;
    const released = await assignTo(db, { caseId: row.id, assigneeId: null, actorId: null });
    if ("error" in released) return released.error;
  }
  await assignCase(db, row.id, { actorId: null });
  return null;
}

/** Ejecuta un nodo de gestión. Un error se registra y el flujo sigue. */
export async function executeCaseAction(
  db: Db,
  kind: CaseActionType,
  data: Record<string, unknown>,
  context: FlowExecutionContext,
): Promise<void> {
  try {
    let error: string | null;
    switch (kind) {
      case "classifyCase":
        error = await runClassify(db, data as ClassifyCaseNodeData, context);
        break;
      case "changeStage":
        error = await runChangeStage(db, data as ChangeStageNodeData, context);
        break;
      case "assignTeam":
        error = await runAssignTeam(db, data as AssignTeamNodeData, context);
        break;
      case "distributeCase":
        error = await runDistribute(db, data as DistributeCaseNodeData, context);
        break;
    }
    if (error) await reportFailure(db, context, kind, error);
  } catch (err) {
    await reportFailure(db, context, kind, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Datos de la gestión para las condiciones del nodo Condición: la gestión del
 * evento o la abierta más reciente (sin ninguna, todo vacío) y el horario
 * efectivo de su equipo o de la empresa.
 */
export async function loadCaseSnapshot(
  db: Db,
  context: FlowExecutionContext,
  contactTypeId: string | null,
): Promise<CaseConditionSnapshot> {
  let row = await findTargetCase(db, context);
  if (!row && context.variables?.[CASE_ID_VARIABLE]) {
    // Evento de una gestión ya cerrada: las condiciones miran esa gestión.
    row = await loadCase(db, context.variables[CASE_ID_VARIABLE]);
  }
  const ctx = await loadAssignmentContext(db, context.workspaceId);
  return buildCaseConditionSnapshot({
    contactTypeId,
    row,
    withinHours: isOpenAt(ctx.hours, row?.team_id ?? null, new Date()),
  });
}
