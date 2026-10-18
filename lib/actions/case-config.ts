"use server";

// Acciones de servidor de Configuración → Gestiones y Tipos de contacto
// (docs/PLAN-CRM.md 7.9, docs/FASE-1-TECNICO.md 4.4).
//
// Todas validan en el servidor que quien llama es Dueño o Administrador del
// espacio. La configuración (tipos, etapas, categorías, motivos, reglas, tipos
// de contacto y `workspaces.settings`) se escribe con el cliente del usuario,
// de modo que RLS vuelve a exigir el rol. El cliente de servicio se usa solo
// para lo que RLS no permite a un usuario: contar el uso en `cases` y
// `contacts` (para decidir entre archivar y borrar sin subcontar), mover las
// gestiones de una etapa que se quita y registrar en `activity`.
//
// Reglas de cambio seguro (lógica pura y probada en
// components/settings/cases/config-rules.ts):
//   - renombrar, reordenar y agregar: inmediato;
//   - quitar una etapa con gestiones abiertas o programadas: exige otra etapa
//     abierta activa del mismo tipo, las mueve y recién entonces la quita;
//   - quitar algo con historial (o que otra regla menciona): se archiva;
//   - quitar algo sin uso: se borra;
//   - cambiar la clase de una etapa o motivo: exige confirmación;
//   - cada cambio queda en `activity` con type = 'config_changed'.

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import { GENERIC_ERROR, logActivity, type Db } from "@/lib/cases/io";
import type {
  CaseRouting,
  CaseTypeAutoTemplate,
  CaseStatus,
  CaseRuleAction,
  CaseRuleCondition,
  CaseRuleTrigger,
  Json,
  OutcomeKind,
  StageKind,
} from "@/lib/types/database";
import {
  CASE_TYPE_ICONS,
  MAX_SLA_HOURS,
  MAX_SLA_MINUTES,
  NAME_ERROR,
  OUTCOME_KINDS,
  ROUTINGS,
  STAGE_KINDS,
  STAGE_KIND_CHANGE_NOTICE,
  checkStageKindChange,
  cleanKeyDateLabel,
  cleanName,
  decideRemoval,
  diffFields,
  hasDuplicateName,
  newStageIndex,
  normalizeColor,
  parseOptionalPositiveInt,
  planDefaultContactType,
  planReorder,
  planStageRemoval,
  positionChanges,
  removalMessage,
  ruleReferences,
  validateRuleInput,
  type CaseConfigData,
  type CaseTypeConfig,
  type CategoryConfig,
  type ContactTypeConfig,
  type ReasonConfig,
  type RemovalOutcome,
  type RuleConfig,
  type RuleInput,
  type RuleRefTarget,
  type StageConfig,
} from "@/components/settings/cases/config-rules";
import {
  buildAutoTemplate,
  parseAutoTemplate,
  type CustomFieldOption,
} from "@/components/settings/cases/auto-template-rules";

// ── Resultados y utilidades ────────────────────────────────────────────────

export type ConfigResult<T extends object = object> =
  | ({ ok: true } & T)
  | { error: string; needsConfirmation?: true };

const INVALID = "Datos no válidos.";
const TYPE_NOT_FOUND = "No se encontró el tipo de gestión.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_STATUSES: CaseStatus[] = ["scheduled", "open"];

function isId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

interface Session {
  userId: string;
  workspaceId: string;
  /** Cliente del usuario: RLS exige que sea administrador. */
  db: Db;
}

/**
 * Valida el rol y ejecuta. `getWorkspace()` puede redirigir (lanza), por eso va
 * fuera del try. Un fallo inesperado se registra y devuelve el mensaje genérico.
 */
async function run<R extends ConfigResult>(fn: (s: Session) => Promise<R>): Promise<R | { error: string }> {
  const { user, workspace, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };
  try {
    const db = (await createClient()) as Db;
    return await fn({ userId: user.id, workspaceId: workspace.id, db });
  } catch (err) {
    console.error("[case-config]", err);
    return { error: GENERIC_ERROR };
  }
}

function must<T extends { error: { message: string } | null }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res;
}

/** Cliente de servicio, solo tras validar el rol. */
async function service(): Promise<Db> {
  return (await createServiceClient()) as Db;
}

/** Registra el cambio en `activity` (type = 'config_changed'). */
async function audit(
  s: Session,
  action: string,
  entity: string,
  details: {
    entityId?: string | null;
    name?: string | null;
    from?: string | null;
    to?: string | null;
    meta?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await logActivity(await service(), {
    workspace_id: s.workspaceId,
    type: "config_changed",
    actor_id: s.userId,
    from_value: details.from ?? null,
    to_value: details.to ?? null,
    meta: { action, entity, entity_id: details.entityId ?? null, name: details.name ?? null, ...details.meta },
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function asObject(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nextPosition(rows: readonly { position: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.position + 1), 0);
}

// ── Lectura ────────────────────────────────────────────────────────────────

type ChildTable = "case_stages" | "case_categories" | "case_outcome_reasons";
type ListName = "stage" | "category" | "reason";

const LIST_TABLE: Record<ListName, ChildTable> = {
  stage: "case_stages",
  category: "case_categories",
  reason: "case_outcome_reasons",
};
const LIST_LABEL: Record<ListName, string> = { stage: "La etapa", category: "La categoría", reason: "El motivo" };

type LooseTable = any;
/** Las tres listas hijas comparten forma: se tratan con un cliente sin tipos de columna. */
function child(db: Db, table: ChildTable): LooseTable {
  return (db as unknown as { from(t: string): unknown }).from(table);
}

interface ChildRow {
  id: string;
  case_type_id: string;
  name: string;
  position: number;
  archived_at: string | null;
  updated_at: string;
  kind?: string;
  color?: string | null;
  is_high_priority?: boolean;
}

function toStage(r: ChildRow): StageConfig {
  return {
    id: r.id,
    caseTypeId: r.case_type_id,
    name: r.name,
    color: r.color ?? null,
    position: r.position,
    kind: r.kind as StageKind,
    archived: r.archived_at !== null,
    updatedAt: r.updated_at,
  };
}
function toCategory(r: ChildRow): CategoryConfig {
  return {
    id: r.id,
    caseTypeId: r.case_type_id,
    name: r.name,
    position: r.position,
    isHighPriority: !!r.is_high_priority,
    archived: r.archived_at !== null,
    updatedAt: r.updated_at,
  };
}
function toReason(r: ChildRow): ReasonConfig {
  return {
    id: r.id,
    caseTypeId: r.case_type_id,
    name: r.name,
    kind: r.kind as OutcomeKind,
    position: r.position,
    archived: r.archived_at !== null,
    updatedAt: r.updated_at,
  };
}

interface RuleRow {
  id: string;
  case_type_id: string;
  position: number;
  enabled: boolean;
  trigger: CaseRuleTrigger;
  trigger_stage_id: string | null;
  condition: Json;
  action: CaseRuleAction;
  params: Json;
  updated_at: string;
}
function toRule(r: RuleRow): RuleConfig {
  return {
    id: r.id,
    caseTypeId: r.case_type_id,
    position: r.position,
    enabled: r.enabled,
    trigger: r.trigger,
    triggerStageId: r.trigger_stage_id,
    condition: asObject(r.condition) as CaseRuleCondition,
    action: r.action,
    params: asObject(r.params),
    updatedAt: r.updated_at,
  };
}

/** Todas las reglas del espacio (para saber qué elementos mencionan). */
async function loadWorkspaceRules(db: Db, workspaceId: string): Promise<RuleConfig[]> {
  const { data: types } = must(await db.from("case_types").select("id").eq("workspace_id", workspaceId), "case_types");
  const ids = (types ?? []).map((t) => t.id);
  if (ids.length === 0) return [];
  const { data } = must(
    await db.from("case_rules").select("*").in("case_type_id", ids).order("position", { ascending: true }),
    "case_rules",
  );
  return (data ?? []).map((r) => toRule(r as RuleRow));
}

async function loadConfig(db: Db, workspaceId: string): Promise<CaseConfigData> {
  const [ws, types, contactTypes, teams] = await Promise.all([
    db.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle(),
    db.from("case_types").select("*").eq("workspace_id", workspaceId).order("position", { ascending: true }),
    db.from("contact_types").select("*").eq("workspace_id", workspaceId).order("position", { ascending: true }),
    db.from("teams").select("id, name").eq("workspace_id", workspaceId).is("archived_at", null).order("name", { ascending: true }),
  ]);
  must(ws, "workspaces");
  must(types, "case_types");
  must(contactTypes, "contact_types");
  must(teams, "teams");

  const typeRows = types.data ?? [];
  const ids = typeRows.map((t) => t.id);
  const byOrder = { ascending: true };
  const [stages, categories, reasons, rules] = ids.length
    ? await Promise.all([
        db.from("case_stages").select("*").in("case_type_id", ids).order("position", byOrder),
        db.from("case_categories").select("*").in("case_type_id", ids).order("position", byOrder),
        db.from("case_outcome_reasons").select("*").in("case_type_id", ids).order("position", byOrder),
        db.from("case_rules").select("*").in("case_type_id", ids).order("position", byOrder),
      ])
    : [null, null, null, null];
  for (const [res, what] of [
    [stages, "case_stages"],
    [categories, "case_categories"],
    [reasons, "case_outcome_reasons"],
    [rules, "case_rules"],
  ] as const) {
    if (res) must(res, what);
  }

  const settings = asObject(ws.data?.settings);
  const label = typeof settings.key_date_label === "string" ? settings.key_date_label : "";
  const template = typeof settings.business_template === "string" ? settings.business_template : null;

  const caseTypes: CaseTypeConfig[] = typeRows.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    icon: t.icon,
    position: t.position,
    isProactive: t.is_proactive,
    suggestedForContactTypeIds: t.suggested_for_contact_type_ids ?? [],
    routing: t.routing,
    fixedTeamId: t.fixed_team_id,
    slaFirstResponseMinutes: t.sla_first_response_minutes,
    slaResolutionHours: t.sla_resolution_hours,
    requireCategory: t.require_category,
    requireOutcomeReason: t.require_outcome_reason,
    archived: t.archived_at !== null,
    updatedAt: t.updated_at,
    stages: (stages?.data ?? []).filter((r) => r.case_type_id === t.id).map((r) => toStage(r as ChildRow)),
    categories: (categories?.data ?? []).filter((r) => r.case_type_id === t.id).map((r) => toCategory(r as ChildRow)),
    reasons: (reasons?.data ?? []).filter((r) => r.case_type_id === t.id).map((r) => toReason(r as ChildRow)),
    rules: (rules?.data ?? []).filter((r) => r.case_type_id === t.id).map((r) => toRule(r as RuleRow)),
  }));

  return {
    businessTemplate: template,
    keyDateLabel: label,
    caseTypes,
    contactTypes: (contactTypes.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      position: c.position,
      isDefault: c.is_default,
      archived: c.archived_at !== null,
      updatedAt: c.updated_at,
    })),
    teams: (teams.data ?? []).map((t) => ({ id: t.id, name: t.name })),
  };
}

/** Toda la configuración de gestiones y tipos de contacto del espacio (solo administradores). */
export async function getCaseConfig(): Promise<ConfigResult<{ data: CaseConfigData }>> {
  return run(async (s) => ({ ok: true, data: await loadConfig(s.db, s.workspaceId) }));
}

// ── Carga con verificación de pertenencia ──────────────────────────────────

interface TypeRow {
  id: string;
  workspace_id: string;
  name: string;
  color: string | null;
  icon: string | null;
  position: number;
  is_proactive: boolean;
  suggested_for_contact_type_ids: string[];
  routing: CaseRouting;
  fixed_team_id: string | null;
  sla_first_response_minutes: number | null;
  sla_resolution_hours: number | null;
  require_category: boolean;
  require_outcome_reason: boolean;
  archived_at: string | null;
}

async function ownedType(s: Session, id: unknown): Promise<TypeRow | null> {
  if (!isId(id)) return null;
  const { data } = must(
    await s.db.from("case_types").select("*").eq("id", id).eq("workspace_id", s.workspaceId).maybeSingle(),
    "case_types",
  );
  return (data as TypeRow | null) ?? null;
}

async function listChildren(db: Db, table: ChildTable, caseTypeId: string): Promise<ChildRow[]> {
  const { data, error } = await child(db, table).select("*").eq("case_type_id", caseTypeId).order("position", { ascending: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as ChildRow[];
}

async function ownedChild(
  s: Session,
  list: ListName,
  id: unknown,
): Promise<{ row: ChildRow; type: TypeRow } | null> {
  if (!isId(id)) return null;
  const { data, error } = await child(s.db, LIST_TABLE[list]).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`${LIST_TABLE[list]}: ${error.message}`);
  const row = data as ChildRow | null;
  if (!row) return null;
  const type = await ownedType(s, row.case_type_id);
  return type ? { row, type } : null;
}

/** Escribe las posiciones 0..n-1 que cambian para llegar a `order`. */
async function applyOrder(
  db: Db,
  table: "case_types" | "contact_types" | "case_stages" | "case_categories" | "case_outcome_reasons" | "case_rules",
  rows: readonly { id: string; position: number }[],
  order: readonly string[],
): Promise<void> {
  const stamp = nowIso();
  for (const change of positionChanges(rows, order)) {
    const { error } = await child(db, table as ChildTable)
      .update({ position: change.position, updated_at: stamp })
      .eq("id", change.id);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

// ── Uso (cliente de servicio, solo lectura) ────────────────────────────────

type CaseColumn = "stage_id" | "category_id" | "outcome_reason_id" | "case_type_id";

async function countCases(svc: Db, workspaceId: string, column: CaseColumn, id: string, onlyActive = false): Promise<number> {
  let query = svc.from("cases").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq(column, id);
  if (onlyActive) query = query.in("status", ACTIVE_STATUSES);
  const { count, error } = await query;
  if (error) throw new Error(`cases: ${error.message}`);
  return count ?? 0;
}

async function countContactsOfType(svc: Db, workspaceId: string, contactTypeId: string): Promise<number> {
  const { count, error } = await svc
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("contact_type_id", contactTypeId);
  if (error) throw new Error(`contacts: ${error.message}`);
  return count ?? 0;
}

function countRuleRefs(rules: readonly RuleConfig[], target: RuleRefTarget, exceptCaseTypeId?: string): number {
  return rules.filter((r) => r.caseTypeId !== exceptCaseTypeId && ruleReferences(r, target)).length;
}

/** Gestiones que están o estuvieron en una etapa, y reglas que dependen de ella. */
export async function getStageUsage(
  stageId: string,
): Promise<ConfigResult<{ usage: { openCases: number; closedCases: number; rules: number; isLastOpen: boolean } }>> {
  return run(async (s) => {
    const found = await ownedChild(s, "stage", stageId);
    if (!found) return { error: "No se encontró la etapa." };
    const svc = await service();
    const [total, open, rules, stages] = await Promise.all([
      countCases(svc, s.workspaceId, "stage_id", found.row.id),
      countCases(svc, s.workspaceId, "stage_id", found.row.id, true),
      loadWorkspaceRules(s.db, s.workspaceId),
      listChildren(s.db, "case_stages", found.type.id),
    ]);
    const plan = planStageRemoval({
      stages: stages.map(toStage),
      stageId: found.row.id,
      openCases: 0,
    });
    return {
      ok: true,
      usage: {
        openCases: open,
        closedCases: Math.max(0, total - open),
        rules: countRuleRefs(rules, { stageId: found.row.id }),
        isLastOpen: "error" in plan,
      },
    };
  });
}

// ── Tipos de gestión ───────────────────────────────────────────────────────

async function allTypeNames(db: Db, workspaceId: string): Promise<{ id: string; name: string; position: number; archived: boolean }[]> {
  const { data } = must(await db.from("case_types").select("id, name, position, archived_at").eq("workspace_id", workspaceId), "case_types");
  return (data ?? []).map((t) => ({ id: t.id, name: t.name, position: t.position, archived: t.archived_at !== null }));
}

export interface CreateCaseTypeInput {
  name: string;
  color?: string | null;
  icon?: string | null;
  isProactive?: boolean;
}

/** Crea un tipo con dos etapas para que sea usable desde el primer momento: Abierta y Resuelta. */
export async function createCaseType(input: CreateCaseTypeInput): Promise<ConfigResult<{ id: string }>> {
  return run(async (s) => {
    const name = cleanName(input?.name);
    if (!name) return { error: NAME_ERROR };
    const color = input.color === undefined ? null : normalizeColor(input.color);
    if (color === undefined) return { error: "El color no es válido." };
    const icon = input.icon ?? null;
    if (icon !== null && !CASE_TYPE_ICONS.includes(icon)) return { error: "El ícono no es válido." };

    const types = await allTypeNames(s.db, s.workspaceId);
    if (hasDuplicateName(types, name)) return { error: "Ya existe un tipo de gestión con ese nombre." };

    const { data } = must(
      await s.db
        .from("case_types")
        .insert({
          workspace_id: s.workspaceId,
          name,
          color,
          icon,
          position: nextPosition(types),
          is_proactive: input.isProactive === true,
        })
        .select("id")
        .single(),
      "insert case_types",
    );
    const id = (data as { id: string }).id;
    must(
      await s.db.from("case_stages").insert([
        { case_type_id: id, name: "Abierta", kind: "open", position: 0 },
        { case_type_id: id, name: "Resuelta", kind: "resolved", position: 1 },
      ]),
      "insert case_stages",
    );
    await audit(s, "case_type_created", "case_type", { entityId: id, name, to: name });
    return { ok: true, id };
  });
}

export interface UpdateCaseTypeInput {
  id: string;
  name?: string;
  color?: string | null;
  icon?: string | null;
  isProactive?: boolean;
  suggestedForContactTypeIds?: string[];
  routing?: CaseRouting;
  fixedTeamId?: string | null;
  /** Número, texto con número o vacío (= sin objetivo). */
  slaFirstResponseMinutes?: number | string | null;
  slaResolutionHours?: number | string | null;
  requireCategory?: boolean;
  requireOutcomeReason?: boolean;
}

/** Cambia los datos generales, el destino, los tiempos y los interruptores de un tipo. Solo toca lo que viene. */
export async function updateCaseType(input: UpdateCaseTypeInput): Promise<ConfigResult> {
  return run(async (s) => {
    const row = await ownedType(s, input?.id);
    if (!row) return { error: TYPE_NOT_FOUND };

    const patch: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = cleanName(input.name);
      if (!name) return { error: NAME_ERROR };
      const types = await allTypeNames(s.db, s.workspaceId);
      if (hasDuplicateName(types, name, row.id)) return { error: "Ya existe un tipo de gestión con ese nombre." };
      patch.name = name;
      before.name = row.name;
    }
    if (input.color !== undefined) {
      const color = normalizeColor(input.color);
      if (color === undefined) return { error: "El color no es válido." };
      patch.color = color;
      before.color = row.color;
    }
    if (input.icon !== undefined) {
      if (input.icon !== null && input.icon !== row.icon && !CASE_TYPE_ICONS.includes(input.icon)) {
        return { error: "El ícono no es válido." };
      }
      patch.icon = input.icon;
      before.icon = row.icon;
    }
    if (input.isProactive !== undefined) {
      patch.is_proactive = input.isProactive === true;
      before.is_proactive = row.is_proactive;
    }
    if (input.requireCategory !== undefined) {
      patch.require_category = input.requireCategory === true;
      before.require_category = row.require_category;
    }
    if (input.requireOutcomeReason !== undefined) {
      patch.require_outcome_reason = input.requireOutcomeReason === true;
      before.require_outcome_reason = row.require_outcome_reason;
    }
    if (input.suggestedForContactTypeIds !== undefined) {
      const ids = [...new Set(input.suggestedForContactTypeIds)];
      if (!Array.isArray(input.suggestedForContactTypeIds) || !ids.every(isId)) return { error: INVALID };
      if (ids.length > 0) {
        const { data } = must(
          await s.db.from("contact_types").select("id").eq("workspace_id", s.workspaceId).in("id", ids),
          "contact_types",
        );
        if ((data ?? []).length !== ids.length) return { error: "Algún tipo de contacto no existe." };
      }
      patch.suggested_for_contact_type_ids = ids;
      before.suggested_for_contact_type_ids = row.suggested_for_contact_type_ids;
    }
    if (input.routing !== undefined || input.fixedTeamId !== undefined) {
      const routing = input.routing ?? row.routing;
      if (!ROUTINGS.includes(routing)) return { error: INVALID };
      let fixedTeamId: string | null = null;
      if (routing === "fixed_team") {
        fixedTeamId = input.fixedTeamId !== undefined ? input.fixedTeamId : row.fixed_team_id;
        if (!isId(fixedTeamId)) return { error: "Elige el equipo al que irán estas gestiones." };
        const { data: team } = must(
          await s.db
            .from("teams")
            .select("id")
            .eq("id", fixedTeamId)
            .eq("workspace_id", s.workspaceId)
            .is("archived_at", null)
            .maybeSingle(),
          "teams",
        );
        if (!team) return { error: "El equipo elegido no existe o está archivado." };
      }
      patch.routing = routing;
      patch.fixed_team_id = fixedTeamId;
      before.routing = row.routing;
      before.fixed_team_id = row.fixed_team_id;
    }
    if (input.slaFirstResponseMinutes !== undefined) {
      const minutes = parseOptionalPositiveInt(input.slaFirstResponseMinutes, MAX_SLA_MINUTES);
      if (minutes === undefined) return { error: `La primera respuesta debe ser un número entero de minutos, de 1 a ${MAX_SLA_MINUTES}, o vacío.` };
      patch.sla_first_response_minutes = minutes;
      before.sla_first_response_minutes = row.sla_first_response_minutes;
    }
    if (input.slaResolutionHours !== undefined) {
      const hours = parseOptionalPositiveInt(input.slaResolutionHours, MAX_SLA_HOURS);
      if (hours === undefined) return { error: `La resolución debe ser un número entero de horas, de 1 a ${MAX_SLA_HOURS}, o vacío.` };
      patch.sla_resolution_hours = hours;
      before.sla_resolution_hours = row.sla_resolution_hours;
    }

    const changes = diffFields(before, patch);
    if (Object.keys(changes).length === 0) return { ok: true };

    const { data } = must(
      await s.db
        .from("case_types")
        .update({ ...patch, updated_at: nowIso() })
        .eq("id", row.id)
        .eq("workspace_id", s.workspaceId)
        .select("id"),
      "update case_types",
    );
    if ((data ?? []).length === 0) return { error: ADMIN_ONLY_MESSAGE };
    await audit(s, "case_type_updated", "case_type", {
      entityId: row.id,
      name: (patch.name as string | undefined) ?? row.name,
      from: changes.name ? String(changes.name.from) : null,
      to: changes.name ? String(changes.name.to) : null,
      meta: { changes },
    });
    return { ok: true };
  });
}

export async function reorderCaseTypes(orderedIds: string[]): Promise<ConfigResult> {
  return run(async (s) => {
    if (!Array.isArray(orderedIds) || !orderedIds.every(isId)) return { error: INVALID };
    const rows = await allTypeNames(s.db, s.workspaceId);
    const order = planReorder(rows, orderedIds);
    if (!order) return { error: "La lista cambió. Recarga la página e inténtalo de nuevo." };
    await applyOrder(s.db, "case_types", rows, order);
    await audit(s, "case_types_reordered", "case_type", { meta: { order: orderedIds } });
    return { ok: true };
  });
}

async function setTypeArchived(s: Session, row: TypeRow, archived: boolean): Promise<void> {
  const { data } = must(
    await s.db
      .from("case_types")
      .update({ archived_at: archived ? nowIso() : null, updated_at: nowIso() })
      .eq("id", row.id)
      .eq("workspace_id", s.workspaceId)
      .select("id"),
    "update case_types",
  );
  if ((data ?? []).length === 0) throw new Error("case_types: sin permiso");
}

export async function archiveCaseType(id: string): Promise<ConfigResult> {
  return run(async (s) => {
    const row = await ownedType(s, id);
    if (!row) return { error: TYPE_NOT_FOUND };
    if (row.archived_at === null) {
      await setTypeArchived(s, row, true);
      await audit(s, "case_type_archived", "case_type", { entityId: row.id, name: row.name });
    }
    return { ok: true };
  });
}

export async function restoreCaseType(id: string): Promise<ConfigResult> {
  return run(async (s) => {
    const row = await ownedType(s, id);
    if (!row) return { error: TYPE_NOT_FOUND };
    if (row.archived_at !== null) {
      await setTypeArchived(s, row, false);
      await audit(s, "case_type_restored", "case_type", { entityId: row.id, name: row.name });
    }
    return { ok: true };
  });
}

/** Quitar un tipo: se borra si nunca se usó y ninguna regla ni equipo lo menciona; si no, se archiva. */
export async function removeCaseType(id: string): Promise<ConfigResult<{ outcome: RemovalOutcome; message: string }>> {
  return run(async (s) => {
    const row = await ownedType(s, id);
    if (!row) return { error: TYPE_NOT_FOUND };
    const svc = await service();
    const [history, rules, members] = await Promise.all([
      countCases(svc, s.workspaceId, "case_type_id", row.id),
      loadWorkspaceRules(s.db, s.workspaceId),
      svc.from("team_members").select("team_id").contains("case_type_ids", [row.id]),
    ]);
    must(members, "team_members");
    const configRefs = countRuleRefs(rules, { caseTypeId: row.id }, row.id) + (members.data ?? []).length;
    const outcome = decideRemoval({ historyCount: history, configRefs });
    const what = `El tipo «${row.name}»`;
    if (outcome === "archive") {
      if (row.archived_at === null) await setTypeArchived(s, row, true);
      await audit(s, "case_type_archived", "case_type", { entityId: row.id, name: row.name, meta: { history_cases: history, config_refs: configRefs } });
      return { ok: true, outcome, message: removalMessage(outcome, what, history > 0 ? "history" : "config") };
    }
    const { data } = must(
      await s.db.from("case_types").delete().eq("id", row.id).eq("workspace_id", s.workspaceId).select("id"),
      "delete case_types",
    );
    if ((data ?? []).length === 0) throw new Error("case_types: sin permiso");
    await audit(s, "case_type_deleted", "case_type", { entityId: row.id, name: row.name });
    return { ok: true, outcome, message: removalMessage(outcome, what) };
  });
}

// ── Etapas, categorías y motivos ───────────────────────────────────────────

export type AddItemInput =
  | { list: "stage"; caseTypeId: string; name: string; kind: StageKind; color?: string | null }
  | { list: "category"; caseTypeId: string; name: string; isHighPriority?: boolean }
  | { list: "reason"; caseTypeId: string; name: string; kind: OutcomeKind };

/** Nombres repetidos: las etapas y categorías por nombre; los motivos por nombre y clase. */
function duplicateScope(list: ListName, rows: readonly ChildRow[], kind?: string): ChildRow[] {
  return list === "reason" ? rows.filter((r) => r.kind === kind) : [...rows];
}

export async function addItem(input: AddItemInput): Promise<ConfigResult<{ id: string }>> {
  return run(async (s) => {
    const list = input?.list;
    if (!list || !(list in LIST_TABLE)) return { error: INVALID };
    const type = await ownedType(s, input.caseTypeId);
    if (!type) return { error: TYPE_NOT_FOUND };
    const name = cleanName(input.name);
    if (!name) return { error: NAME_ERROR };

    const table = LIST_TABLE[list];
    const rows = await listChildren(s.db, table, type.id);

    let insert: Record<string, unknown>;
    if (input.list === "stage") {
      if (!STAGE_KINDS.includes(input.kind)) return { error: "Elige la clase de la etapa." };
      const color = input.color === undefined ? null : normalizeColor(input.color);
      if (color === undefined) return { error: "El color no es válido." };
      if (hasDuplicateName(duplicateScope(list, rows), name)) return { error: "Ya hay una etapa con ese nombre en este tipo." };
      insert = { case_type_id: type.id, name, kind: input.kind, color, position: nextPosition(rows) };
    } else if (input.list === "category") {
      if (hasDuplicateName(duplicateScope(list, rows), name)) return { error: "Ya hay una categoría con ese nombre en este tipo." };
      insert = { case_type_id: type.id, name, is_high_priority: input.isHighPriority === true, position: nextPosition(rows) };
    } else {
      if (!OUTCOME_KINDS.includes(input.kind)) return { error: "Elige la clase del motivo." };
      if (hasDuplicateName(duplicateScope(list, rows, input.kind), name)) {
        return { error: "Ya hay un motivo con ese nombre y esa clase en este tipo." };
      }
      insert = { case_type_id: type.id, name, kind: input.kind, position: nextPosition(rows) };
    }

    const { data, error } = await child(s.db, table).insert(insert).select("id").single();
    if (error) throw new Error(`insert ${table}: ${error.message}`);
    const id = (data as { id: string }).id;

    // Una etapa abierta nueva entra antes de las de cierre.
    if (input.list === "stage") {
      const active = rows.filter((r) => r.archived_at === null).map(toStage);
      const index = newStageIndex(active, input.kind);
      if (index < active.length) {
        const order = [...active.map((r) => r.id)];
        order.splice(index, 0, id);
        const archivedIds = rows.filter((r) => r.archived_at !== null).map((r) => r.id);
        await applyOrder(s.db, "case_stages", [...rows, { id, position: nextPosition(rows) }], [...order, ...archivedIds]);
      }
    }

    await audit(s, `${list}_created`, list, { entityId: id, name, to: name, meta: { case_type_id: type.id, case_type: type.name } });
    return { ok: true, id };
  });
}

export interface UpdateItemInput {
  list: ListName;
  id: string;
  name?: string;
  /** Solo etapas. */
  color?: string | null;
  /** Etapas y motivos. */
  kind?: string;
  /** Solo categorías. */
  isHighPriority?: boolean;
  /** Confirmó el aviso de cambio de clase (etapas y motivos). */
  confirmedKindChange?: boolean;
}

export async function updateItem(input: UpdateItemInput): Promise<ConfigResult> {
  return run(async (s) => {
    const list = input?.list;
    if (!list || !(list in LIST_TABLE)) return { error: INVALID };
    const found = await ownedChild(s, list, input.id);
    if (!found) return { error: `${LIST_LABEL[list]} no existe.` };
    const { row, type } = found;
    const table = LIST_TABLE[list];
    const siblings = await listChildren(s.db, table, type.id);

    const patch: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = cleanName(input.name);
      if (!name) return { error: NAME_ERROR };
      const nextKind = input.kind ?? row.kind;
      if (hasDuplicateName(duplicateScope(list, siblings, nextKind), name, row.id)) {
        return { error: "Ya hay otro elemento con ese nombre en este tipo." };
      }
      patch.name = name;
      before.name = row.name;
    }
    if (list === "stage" && input.color !== undefined) {
      const color = normalizeColor(input.color);
      if (color === undefined) return { error: "El color no es válido." };
      patch.color = color;
      before.color = row.color ?? null;
    }
    if (list === "category" && input.isHighPriority !== undefined) {
      patch.is_high_priority = input.isHighPriority === true;
      before.is_high_priority = !!row.is_high_priority;
    }
    if ((list === "stage" || list === "reason") && input.kind !== undefined && input.kind !== row.kind) {
      const valid = list === "stage" ? (STAGE_KINDS as readonly string[]) : (OUTCOME_KINDS as readonly string[]);
      if (!valid.includes(input.kind)) return { error: INVALID };
      if (list === "stage") {
        const problem = checkStageKindChange({ stages: siblings.map(toStage), stageId: row.id, newKind: input.kind as StageKind });
        if (problem) return { error: problem };
      } else {
        const rules = await loadWorkspaceRules(s.db, s.workspaceId);
        if (countRuleRefs(rules, { outcomeReasonId: row.id }) > 0) {
          return { error: "Una regla usa este motivo como condición. Quítala o cámbiala antes de cambiar la clase del motivo." };
        }
      }
      if (input.confirmedKindChange !== true) return { error: STAGE_KIND_CHANGE_NOTICE, needsConfirmation: true };
      patch.kind = input.kind;
      before.kind = row.kind;
    }

    const changes = diffFields(before, patch);
    if (Object.keys(changes).length === 0) return { ok: true };

    const { data, error } = await child(s.db, table)
      .update({ ...patch, updated_at: nowIso() })
      .eq("id", row.id)
      .select("id");
    if (error) throw new Error(`update ${table}: ${error.message}`);
    if (((data ?? []) as unknown[]).length === 0) return { error: ADMIN_ONLY_MESSAGE };
    await audit(s, `${list}_updated`, list, {
      entityId: row.id,
      name: (patch.name as string | undefined) ?? row.name,
      from: changes.name ? String(changes.name.from) : null,
      to: changes.name ? String(changes.name.to) : null,
      meta: { case_type_id: type.id, case_type: type.name, changes },
    });
    return { ok: true };
  });
}

export async function reorderItems(input: { list: ListName; caseTypeId: string; orderedIds: string[] }): Promise<ConfigResult> {
  return run(async (s) => {
    const list = input?.list;
    if (!list || !(list in LIST_TABLE)) return { error: INVALID };
    if (!Array.isArray(input.orderedIds) || !input.orderedIds.every(isId)) return { error: INVALID };
    const type = await ownedType(s, input.caseTypeId);
    if (!type) return { error: TYPE_NOT_FOUND };
    const table = LIST_TABLE[list];
    const rows = await listChildren(s.db, table, type.id);
    const order = planReorder(
      rows.map((r) => ({ id: r.id, position: r.position, archived: r.archived_at !== null })),
      input.orderedIds,
    );
    if (!order) return { error: "La lista cambió. Recarga la página e inténtalo de nuevo." };
    await applyOrder(s.db, table, rows, order);
    await audit(s, `${list}_reordered`, list, { meta: { case_type_id: type.id, case_type: type.name, order: input.orderedIds } });
    return { ok: true };
  });
}

/** Mueve las gestiones abiertas o programadas de una etapa a otra y deja constancia en cada una. */
async function moveCasesBetweenStages(s: Session, from: ChildRow, to: ChildRow): Promise<number> {
  const svc = await service();
  const { data, error } = await svc
    .from("cases")
    .update({ stage_id: to.id, updated_at: nowIso() })
    .eq("workspace_id", s.workspaceId)
    .eq("stage_id", from.id)
    .in("status", ACTIVE_STATUSES)
    .select("id, contact_id");
  if (error) throw new Error(`cases: ${error.message}`);
  const moved = data ?? [];
  await logActivity(
    svc,
    moved.map((c) => ({
      workspace_id: s.workspaceId,
      type: "stage_changed" as const,
      case_id: c.id,
      contact_id: c.contact_id,
      actor_id: s.userId,
      from_value: from.id,
      to_value: to.id,
      meta: { source: "config", reason: "stage_removed" },
    })),
  );
  return moved.length;
}

async function setChildArchived(s: Session, list: ListName, row: ChildRow, archived: boolean): Promise<void> {
  const { data, error } = await child(s.db, LIST_TABLE[list])
    .update({ archived_at: archived ? nowIso() : null, updated_at: nowIso() })
    .eq("id", row.id)
    .select("id");
  if (error) throw new Error(`${LIST_TABLE[list]}: ${error.message}`);
  if (((data ?? []) as unknown[]).length === 0) throw new Error(`${LIST_TABLE[list]}: sin permiso`);
}

async function deleteChild(s: Session, list: ListName, row: ChildRow): Promise<void> {
  const { data, error } = await child(s.db, LIST_TABLE[list]).delete().eq("id", row.id).select("id");
  if (error) throw new Error(`${LIST_TABLE[list]}: ${error.message}`);
  if (((data ?? []) as unknown[]).length === 0) throw new Error(`${LIST_TABLE[list]}: sin permiso`);
}

interface RemoveItemInput {
  list: ListName;
  id: string;
  /** Etapa abierta activa del mismo tipo a la que mover las gestiones abiertas o programadas. */
  moveToStageId?: string | null;
}

/** Para etapas: valida (al menos una abierta, destino de las gestiones) y las mueve. */
async function prepareStageRemoval(
  s: Session,
  found: { row: ChildRow; type: TypeRow },
  moveToStageId: string | null | undefined,
): Promise<{ error: string } | { moved: number; openCases: number }> {
  const svc = await service();
  const [siblings, openCases] = await Promise.all([
    listChildren(s.db, "case_stages", found.type.id),
    countCases(svc, s.workspaceId, "stage_id", found.row.id, true),
  ]);
  const plan = planStageRemoval({
    stages: siblings.map(toStage),
    stageId: found.row.id,
    openCases,
    moveToStageId,
  });
  if ("error" in plan) return plan;
  if (!plan.move) return { moved: 0, openCases };
  const target = siblings.find((r) => r.id === moveToStageId)!;
  return { moved: await moveCasesBetweenStages(s, found.row, target), openCases };
}

/** Archiva (sin borrar) una etapa, categoría o motivo. Una etapa con gestiones abiertas las mueve antes. */
export async function archiveItem(input: RemoveItemInput): Promise<ConfigResult<{ moved: number }>> {
  return run(async (s) => {
    const list = input?.list;
    if (!list || !(list in LIST_TABLE)) return { error: INVALID };
    const found = await ownedChild(s, list, input.id);
    if (!found) return { error: `${LIST_LABEL[list]} no existe.` };
    if (found.row.archived_at !== null) return { ok: true, moved: 0 };
    let moved = 0;
    if (list === "stage") {
      const prepared = await prepareStageRemoval(s, found, input.moveToStageId);
      if ("error" in prepared) return prepared;
      moved = prepared.moved;
    }
    await setChildArchived(s, list, found.row, true);
    await audit(s, `${list}_archived`, list, {
      entityId: found.row.id,
      name: found.row.name,
      meta: {
        case_type_id: found.type.id,
        case_type: found.type.name,
        ...(moved > 0 ? { moved_cases: moved, moved_to_stage_id: input.moveToStageId } : {}),
      },
    });
    return { ok: true, moved };
  });
}

export async function restoreItem(input: { list: ListName; id: string }): Promise<ConfigResult> {
  return run(async (s) => {
    const list = input?.list;
    if (!list || !(list in LIST_TABLE)) return { error: INVALID };
    const found = await ownedChild(s, list, input.id);
    if (!found) return { error: `${LIST_LABEL[list]} no existe.` };
    if (found.row.archived_at === null) return { ok: true };
    await setChildArchived(s, list, found.row, false);
    await audit(s, `${list}_restored`, list, {
      entityId: found.row.id,
      name: found.row.name,
      meta: { case_type_id: found.type.id, case_type: found.type.name },
    });
    return { ok: true };
  });
}

/**
 * Quita una etapa, categoría o motivo: se borra si nunca se usó (ni en
 * gestiones ni en reglas); si tiene historial o una regla lo menciona, se
 * archiva. Una etapa con gestiones abiertas o programadas las mueve antes.
 */
export async function removeItem(input: RemoveItemInput): Promise<ConfigResult<{ outcome: RemovalOutcome; moved: number; message: string }>> {
  return run(async (s) => {
    const list = input?.list;
    if (!list || !(list in LIST_TABLE)) return { error: INVALID };
    const found = await ownedChild(s, list, input.id);
    if (!found) return { error: `${LIST_LABEL[list]} no existe.` };
    const { row, type } = found;
    const svc = await service();
    const what = `${LIST_LABEL[list]} «${row.name}»`;

    let moved = 0;
    if (list === "stage") {
      const prepared = await prepareStageRemoval(s, found, input.moveToStageId);
      if ("error" in prepared) return prepared;
      moved = prepared.moved;
    }

    const column: CaseColumn = list === "stage" ? "stage_id" : list === "category" ? "category_id" : "outcome_reason_id";
    // Las gestiones abiertas ya se movieron: lo que queda es historial (cerradas, canceladas).
    const history = await countCases(svc, s.workspaceId, column, row.id);
    const rules = await loadWorkspaceRules(s.db, s.workspaceId);
    const target: RuleRefTarget =
      list === "stage" ? { stageId: row.id } : list === "category" ? { categoryId: row.id } : { outcomeReasonId: row.id };
    const ruleRefs = countRuleRefs(rules, target);
    // Las reglas que arrancan en una etapa se borran con ella (cascada); no cuentan como uso.
    const configRefs = list === "stage" ? 0 : ruleRefs;
    const outcome = decideRemoval({ historyCount: history, configRefs });

    if (outcome === "archive") {
      if (row.archived_at === null) await setChildArchived(s, list, row, true);
      await audit(s, `${list}_archived`, list, {
        entityId: row.id,
        name: row.name,
        meta: { case_type_id: type.id, case_type: type.name, history_cases: history, config_refs: configRefs, moved_cases: moved },
      });
      return { ok: true, outcome, moved, message: removalMessage(outcome, what, history > 0 ? "history" : "config") };
    }

    let deletedRules = 0;
    if (list === "stage") {
      const dependent = rules.filter((r) => r.triggerStageId === row.id);
      for (const r of dependent) {
        must(await s.db.from("case_rules").delete().eq("id", r.id), "delete case_rules");
        deletedRules += 1;
      }
    }
    await deleteChild(s, list, row);
    await audit(s, `${list}_deleted`, list, {
      entityId: row.id,
      name: row.name,
      meta: { case_type_id: type.id, case_type: type.name, moved_cases: moved, deleted_rules: deletedRules },
    });
    const suffix = deletedRules > 0 ? ` También se ${deletedRules === 1 ? "borró la regla" : `borraron las ${deletedRules} reglas`} que empezaban en ella.` : "";
    return { ok: true, outcome, moved, message: `${removalMessage(outcome, what)}${suffix}` };
  });
}

// ── Reglas ─────────────────────────────────────────────────────────────────

async function ruleContext(s: Session, typeId: string): Promise<{
  ctx: Parameters<typeof validateRuleInput>[1];
}> {
  const [stages, categories, reasons, contactTypes, caseTypes, ws] = await Promise.all([
    listChildren(s.db, "case_stages", typeId),
    listChildren(s.db, "case_categories", typeId),
    listChildren(s.db, "case_outcome_reasons", typeId),
    s.db.from("contact_types").select("id, archived_at").eq("workspace_id", s.workspaceId),
    s.db.from("case_types").select("id, archived_at").eq("workspace_id", s.workspaceId),
    s.db.from("workspaces").select("settings").eq("id", s.workspaceId).maybeSingle(),
  ]);
  must(contactTypes, "contact_types");
  must(caseTypes, "case_types");
  const label = asObject(ws.data?.settings).key_date_label;
  return {
    ctx: {
      caseTypeId: typeId,
      stages: stages.map(toStage),
      categories: categories.map(toCategory),
      reasons: reasons.map(toReason),
      contactTypes: (contactTypes.data ?? []).map((c) => ({ id: c.id, archived: c.archived_at !== null })),
      caseTypes: (caseTypes.data ?? []).map((c) => ({ id: c.id, archived: c.archived_at !== null })),
      keyDateLabel: typeof label === "string" ? label : "",
    },
  };
}

export async function addRule(input: { caseTypeId: string; rule: RuleInput }): Promise<ConfigResult<{ id: string }>> {
  return run(async (s) => {
    const type = await ownedType(s, input?.caseTypeId);
    if (!type) return { error: TYPE_NOT_FOUND };
    const { ctx } = await ruleContext(s, type.id);
    const valid = validateRuleInput(input.rule, ctx);
    if ("error" in valid) return valid;
    const { data: existing } = must(await s.db.from("case_rules").select("position").eq("case_type_id", type.id), "case_rules");
    const { data } = must(
      await s.db
        .from("case_rules")
        .insert({
          case_type_id: type.id,
          position: nextPosition(existing ?? []),
          enabled: true,
          trigger: valid.rule.trigger,
          trigger_stage_id: valid.rule.triggerStageId,
          condition: valid.rule.condition as Json,
          action: valid.rule.action,
          params: valid.rule.params as Json,
        })
        .select("id")
        .single(),
      "insert case_rules",
    );
    const id = (data as { id: string }).id;
    await audit(s, "rule_created", "rule", {
      entityId: id,
      meta: { case_type_id: type.id, case_type: type.name, rule: valid.rule },
    });
    return { ok: true, id };
  });
}

async function ownedRule(s: Session, id: unknown): Promise<{ row: RuleRow; type: TypeRow } | null> {
  if (!isId(id)) return null;
  const { data } = must(await s.db.from("case_rules").select("*").eq("id", id).maybeSingle(), "case_rules");
  if (!data) return null;
  const type = await ownedType(s, data.case_type_id);
  return type ? { row: data as RuleRow, type } : null;
}

export async function updateRule(input: { id: string; rule: RuleInput }): Promise<ConfigResult> {
  return run(async (s) => {
    const found = await ownedRule(s, input?.id);
    if (!found) return { error: "No se encontró la regla." };
    const { ctx } = await ruleContext(s, found.type.id);
    const valid = validateRuleInput(input.rule, ctx);
    if ("error" in valid) return valid;
    const { data } = must(
      await s.db
        .from("case_rules")
        .update({
          trigger: valid.rule.trigger,
          trigger_stage_id: valid.rule.triggerStageId,
          condition: valid.rule.condition as Json,
          action: valid.rule.action,
          params: valid.rule.params as Json,
          updated_at: nowIso(),
        })
        .eq("id", found.row.id)
        .select("id"),
      "update case_rules",
    );
    if ((data ?? []).length === 0) return { error: ADMIN_ONLY_MESSAGE };
    await audit(s, "rule_updated", "rule", {
      entityId: found.row.id,
      meta: { case_type_id: found.type.id, case_type: found.type.name, rule: valid.rule },
    });
    return { ok: true };
  });
}

export async function setRuleEnabled(input: { id: string; enabled: boolean }): Promise<ConfigResult> {
  return run(async (s) => {
    const found = await ownedRule(s, input?.id);
    if (!found) return { error: "No se encontró la regla." };
    const enabled = input.enabled === true;
    if (found.row.enabled === enabled) return { ok: true };
    const { data } = must(
      await s.db.from("case_rules").update({ enabled, updated_at: nowIso() }).eq("id", found.row.id).select("id"),
      "update case_rules",
    );
    if ((data ?? []).length === 0) return { error: ADMIN_ONLY_MESSAGE };
    await audit(s, enabled ? "rule_enabled" : "rule_disabled", "rule", {
      entityId: found.row.id,
      meta: { case_type_id: found.type.id, case_type: found.type.name },
    });
    return { ok: true };
  });
}

export async function reorderRules(input: { caseTypeId: string; orderedIds: string[] }): Promise<ConfigResult> {
  return run(async (s) => {
    if (!Array.isArray(input?.orderedIds) || !input.orderedIds.every(isId)) return { error: INVALID };
    const type = await ownedType(s, input.caseTypeId);
    if (!type) return { error: TYPE_NOT_FOUND };
    const { data } = must(await s.db.from("case_rules").select("id, position").eq("case_type_id", type.id), "case_rules");
    const rows = (data ?? []).map((r) => ({ id: r.id, position: r.position, archived: false }));
    const order = planReorder(rows, input.orderedIds);
    if (!order) return { error: "La lista cambió. Recarga la página e inténtalo de nuevo." };
    await applyOrder(s.db, "case_rules", rows, order);
    await audit(s, "rules_reordered", "rule", { meta: { case_type_id: type.id, case_type: type.name, order: input.orderedIds } });
    return { ok: true };
  });
}

/** Las reglas no tienen historial: se borran de verdad. */
export async function removeRule(id: string): Promise<ConfigResult> {
  return run(async (s) => {
    const found = await ownedRule(s, id);
    if (!found) return { error: "No se encontró la regla." };
    const { data } = must(await s.db.from("case_rules").delete().eq("id", found.row.id).select("id"), "delete case_rules");
    if ((data ?? []).length === 0) return { error: ADMIN_ONLY_MESSAGE };
    await audit(s, "rule_deleted", "rule", {
      entityId: found.row.id,
      meta: { case_type_id: found.type.id, case_type: found.type.name, trigger: found.row.trigger, rule_action: found.row.action },
    });
    return { ok: true };
  });
}

// ── Tipos de contacto ──────────────────────────────────────────────────────

interface ContactTypeRow {
  id: string;
  name: string;
  color: string | null;
  position: number;
  is_default: boolean;
  archived_at: string | null;
}

async function listContactTypes(s: Session): Promise<ContactTypeRow[]> {
  const { data } = must(
    await s.db.from("contact_types").select("*").eq("workspace_id", s.workspaceId).order("position", { ascending: true }),
    "contact_types",
  );
  return (data ?? []) as ContactTypeRow[];
}

const CONTACT_TYPE_NOT_FOUND = "No se encontró el tipo de contacto.";

async function ownedContactType(s: Session, id: unknown): Promise<ContactTypeRow | null> {
  if (!isId(id)) return null;
  const { data } = must(
    await s.db.from("contact_types").select("*").eq("id", id).eq("workspace_id", s.workspaceId).maybeSingle(),
    "contact_types",
  );
  return (data as ContactTypeRow | null) ?? null;
}

export async function createContactType(input: { name: string; color?: string | null }): Promise<ConfigResult<{ id: string }>> {
  return run(async (s) => {
    const name = cleanName(input?.name);
    if (!name) return { error: NAME_ERROR };
    const color = input.color === undefined ? null : normalizeColor(input.color);
    if (color === undefined) return { error: "El color no es válido." };
    const rows = await listContactTypes(s);
    if (hasDuplicateName(rows, name)) return { error: "Ya existe un tipo de contacto con ese nombre." };
    const { data } = must(
      await s.db
        .from("contact_types")
        .insert({ workspace_id: s.workspaceId, name, color, position: nextPosition(rows), is_default: false })
        .select("id")
        .single(),
      "insert contact_types",
    );
    const id = (data as { id: string }).id;
    await audit(s, "contact_type_created", "contact_type", { entityId: id, name, to: name });
    return { ok: true, id };
  });
}

export async function updateContactType(input: { id: string; name?: string; color?: string | null }): Promise<ConfigResult> {
  return run(async (s) => {
    const row = await ownedContactType(s, input?.id);
    if (!row) return { error: CONTACT_TYPE_NOT_FOUND };
    const patch: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = cleanName(input.name);
      if (!name) return { error: NAME_ERROR };
      if (hasDuplicateName(await listContactTypes(s), name, row.id)) return { error: "Ya existe un tipo de contacto con ese nombre." };
      patch.name = name;
      before.name = row.name;
    }
    if (input.color !== undefined) {
      const color = normalizeColor(input.color);
      if (color === undefined) return { error: "El color no es válido." };
      patch.color = color;
      before.color = row.color;
    }
    const changes = diffFields(before, patch);
    if (Object.keys(changes).length === 0) return { ok: true };
    const { data } = must(
      await s.db
        .from("contact_types")
        .update({ ...patch, updated_at: nowIso() })
        .eq("id", row.id)
        .eq("workspace_id", s.workspaceId)
        .select("id"),
      "update contact_types",
    );
    if ((data ?? []).length === 0) return { error: ADMIN_ONLY_MESSAGE };
    await audit(s, "contact_type_updated", "contact_type", {
      entityId: row.id,
      name: (patch.name as string | undefined) ?? row.name,
      from: changes.name ? String(changes.name.from) : null,
      to: changes.name ? String(changes.name.to) : null,
      meta: { changes },
    });
    return { ok: true };
  });
}

/** Deja un solo tipo de contacto por defecto (o ninguno, con null). */
export async function setDefaultContactType(id: string | null): Promise<ConfigResult> {
  return run(async (s) => {
    if (id !== null && !isId(id)) return { error: INVALID };
    const rows = await listContactTypes(s);
    const plan = planDefaultContactType(
      rows.map((r) => ({ id: r.id, isDefault: r.is_default, archived: r.archived_at !== null })),
      id,
    );
    if ("error" in plan) return plan;
    const stamp = nowIso();
    // Primero se libera el anterior: el índice único admite un solo por defecto activo.
    if (plan.clear.length > 0) {
      must(
        await s.db.from("contact_types").update({ is_default: false, updated_at: stamp }).eq("workspace_id", s.workspaceId).in("id", plan.clear),
        "update contact_types",
      );
    }
    if (plan.set) {
      const { data } = must(
        await s.db.from("contact_types").update({ is_default: true, updated_at: stamp }).eq("id", plan.set).eq("workspace_id", s.workspaceId).select("id"),
        "update contact_types",
      );
      if ((data ?? []).length === 0) return { error: ADMIN_ONLY_MESSAGE };
    }
    const name = rows.find((r) => r.id === plan.set)?.name ?? null;
    await audit(s, "contact_type_default_changed", "contact_type", {
      entityId: plan.set,
      name,
      from: rows.find((r) => r.is_default)?.name ?? null,
      to: name,
    });
    return { ok: true };
  });
}

export async function reorderContactTypes(orderedIds: string[]): Promise<ConfigResult> {
  return run(async (s) => {
    if (!Array.isArray(orderedIds) || !orderedIds.every(isId)) return { error: INVALID };
    const rows = await listContactTypes(s);
    const order = planReorder(
      rows.map((r) => ({ id: r.id, position: r.position, archived: r.archived_at !== null })),
      orderedIds,
    );
    if (!order) return { error: "La lista cambió. Recarga la página e inténtalo de nuevo." };
    await applyOrder(s.db, "contact_types", rows, order);
    await audit(s, "contact_types_reordered", "contact_type", { meta: { order: orderedIds } });
    return { ok: true };
  });
}

async function setContactTypeArchived(s: Session, row: ContactTypeRow, archived: boolean): Promise<void> {
  const { data } = must(
    await s.db
      .from("contact_types")
      .update({
        archived_at: archived ? nowIso() : null,
        // Un tipo archivado no puede ser el de por defecto.
        ...(archived ? { is_default: false } : {}),
        updated_at: nowIso(),
      })
      .eq("id", row.id)
      .eq("workspace_id", s.workspaceId)
      .select("id"),
    "update contact_types",
  );
  if ((data ?? []).length === 0) throw new Error("contact_types: sin permiso");
}

export async function archiveContactType(id: string): Promise<ConfigResult> {
  return run(async (s) => {
    const row = await ownedContactType(s, id);
    if (!row) return { error: CONTACT_TYPE_NOT_FOUND };
    if (row.archived_at === null) {
      await setContactTypeArchived(s, row, true);
      await audit(s, "contact_type_archived", "contact_type", { entityId: row.id, name: row.name, meta: { was_default: row.is_default } });
    }
    return { ok: true };
  });
}

export async function restoreContactType(id: string): Promise<ConfigResult> {
  return run(async (s) => {
    const row = await ownedContactType(s, id);
    if (!row) return { error: CONTACT_TYPE_NOT_FOUND };
    if (row.archived_at !== null) {
      await setContactTypeArchived(s, row, false);
      await audit(s, "contact_type_restored", "contact_type", { entityId: row.id, name: row.name });
    }
    return { ok: true };
  });
}

/** Se borra si ningún contacto lo tiene ni ninguna regla o tipo de gestión lo menciona; si no, se archiva. */
export async function removeContactType(id: string): Promise<ConfigResult<{ outcome: RemovalOutcome; message: string }>> {
  return run(async (s) => {
    const row = await ownedContactType(s, id);
    if (!row) return { error: CONTACT_TYPE_NOT_FOUND };
    const svc = await service();
    const [history, rules, suggested] = await Promise.all([
      countContactsOfType(svc, s.workspaceId, row.id),
      loadWorkspaceRules(s.db, s.workspaceId),
      s.db
        .from("case_types")
        .select("id")
        .eq("workspace_id", s.workspaceId)
        .contains("suggested_for_contact_type_ids", [row.id]),
    ]);
    must(suggested, "case_types");
    const configRefs = countRuleRefs(rules, { contactTypeId: row.id }) + (suggested.data ?? []).length;
    const outcome = decideRemoval({ historyCount: history, configRefs });
    const what = `El tipo de contacto «${row.name}»`;
    if (outcome === "archive") {
      if (row.archived_at === null) await setContactTypeArchived(s, row, true);
      await audit(s, "contact_type_archived", "contact_type", {
        entityId: row.id,
        name: row.name,
        meta: { contacts: history, config_refs: configRefs, was_default: row.is_default },
      });
      return { ok: true, outcome, message: removalMessage(outcome, what, history > 0 ? "history" : "config") };
    }
    const { data } = must(
      await s.db.from("contact_types").delete().eq("id", row.id).eq("workspace_id", s.workspaceId).select("id"),
      "delete contact_types",
    );
    if ((data ?? []).length === 0) throw new Error("contact_types: sin permiso");
    await audit(s, "contact_type_deleted", "contact_type", { entityId: row.id, name: row.name });
    return { ok: true, outcome, message: removalMessage(outcome, what) };
  });
}

// ── Etiqueta de la fecha clave ─────────────────────────────────────────────

/** `workspaces.settings.key_date_label`; vacía = se quita. Conserva el resto de la configuración. */
export async function saveKeyDateLabel(label: string): Promise<ConfigResult<{ label: string }>> {
  return run(async (s) => {
    const clean = cleanKeyDateLabel(label);
    if (clean === undefined) return { error: NAME_ERROR };
    const { data: ws } = must(await s.db.from("workspaces").select("settings").eq("id", s.workspaceId).maybeSingle(), "workspaces");
    if (!ws) return { error: "No se encontró el espacio de trabajo." };
    const settings = asObject(ws.settings);
    const previous = typeof settings.key_date_label === "string" ? settings.key_date_label : null;
    if (previous === clean) return { ok: true, label: clean ?? "" };
    const next = { ...settings };
    if (clean === null) delete next.key_date_label;
    else next.key_date_label = clean;
    const { data } = must(
      await s.db.from("workspaces").update({ settings: next as Json }).eq("id", s.workspaceId).select("id"),
      "update workspaces",
    );
    if ((data ?? []).length === 0) return { error: ADMIN_ONLY_MESSAGE };
    await audit(s, "key_date_label_changed", "workspace", { from: previous, to: clean });
    return { ok: true, label: clean ?? "" };
  });
}


// ── Plantilla al activarse (docs/FASE-2-TECNICO.md 3.4 y 8) ────────────────

export interface AutoTemplateContext {
  /** Canales de WhatsApp activos del espacio. Sin ellos no se ofrece la plantilla. */
  channels: { id: string; name: string }[];
  customFields: CustomFieldOption[];
  current: CaseTypeAutoTemplate | null;
}

/** Datos para configurar la plantilla de un tipo: canales de WhatsApp, campos personalizados y la plantilla actual. */
export async function getAutoTemplateContext(caseTypeId: string): Promise<ConfigResult<{ context: AutoTemplateContext }>> {
  return run(async (s) => {
    const row = await ownedType(s, caseTypeId);
    if (!row) return { error: TYPE_NOT_FOUND };
    const [channels, fields, type] = await Promise.all([
      s.db
        .from("channels")
        .select("id, display_name, username")
        .eq("workspace_id", s.workspaceId)
        .eq("platform", "whatsapp")
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
      s.db.from("custom_field_definitions").select("name, slug").eq("workspace_id", s.workspaceId).order("name", { ascending: true }),
      s.db.from("case_types").select("auto_template").eq("id", row.id).eq("workspace_id", s.workspaceId).maybeSingle(),
    ]);
    must(channels, "channels");
    must(fields, "custom_field_definitions");
    must(type, "case_types");
    return {
      ok: true as const,
      context: {
        channels: (channels.data ?? []).map((c) => ({ id: c.id, name: c.display_name || c.username || "WhatsApp" })),
        customFields: (fields.data ?? []).map((f) => ({ name: f.name, slug: f.slug })),
        current: parseAutoTemplate(type.data?.auto_template),
      },
    };
  });
}

/**
 * Guarda (o quita, con null) la plantilla que se envía al activarse una
 * gestión de este tipo. Solo tipos proactivos; cada variable debe ser
 * {nombre}, {fecha_clave}, {empresa} o un campo personalizado existente.
 */
export async function saveAutoTemplate(input: {
  caseTypeId: string;
  autoTemplate: { template_name: string; language: string; params: string[] } | null;
}): Promise<ConfigResult> {
  return run(async (s) => {
    const row = await ownedType(s, input?.caseTypeId);
    if (!row) return { error: TYPE_NOT_FOUND };

    let value: CaseTypeAutoTemplate | null = null;
    if (input.autoTemplate !== null) {
      if (!row.is_proactive) return { error: "Solo los tipos proactivos pueden enviar una plantilla al activarse." };
      const { data: fields } = must(
        await s.db.from("custom_field_definitions").select("slug").eq("workspace_id", s.workspaceId),
        "custom_field_definitions",
      );
      const built = buildAutoTemplate({
        templateName: input.autoTemplate?.template_name,
        language: input.autoTemplate?.language,
        params: input.autoTemplate?.params,
        fieldSlugs: new Set((fields ?? []).map((f) => f.slug)),
      });
      if (!built.ok) return { error: built.error };
      value = built.value;
    }

    const { data } = must(
      await s.db
        .from("case_types")
        .update({ auto_template: value as unknown as Json | null, updated_at: nowIso() })
        .eq("id", row.id)
        .eq("workspace_id", s.workspaceId)
        .select("id"),
      "update case_types",
    );
    if ((data ?? []).length === 0) return { error: ADMIN_ONLY_MESSAGE };
    await audit(s, "auto_template_changed", "case_type", {
      entityId: row.id,
      name: row.name,
      to: value ? value.template_name : null,
      meta: { auto_template: value },
    });
    return { ok: true };
  });
}
