"use server";

// Acciones de servidor de gestiones para la interfaz (docs/FASE-1-TECNICO.md
// 3 y 4). Cada acción valida en el servidor, con getWorkspace() y las reglas
// de lib/permissions.ts y lib/cases/access.ts, antes de usar el cliente de
// servicio. Devuelven { ok: true, ... } o { error } con el mensaje en español.

import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import * as engine from "@/lib/cases";
import {
  CASE_NOT_ALLOWED,
  CASE_NOT_FOUND,
  canAssignTo,
  casePermissions,
  supervisedTeamIds,
  type CasePermissions,
} from "@/lib/cases/access";
import { isDateString } from "@/lib/cases/dates";
import { GENERIC_ERROR, type CaseRow, type Db } from "@/lib/cases/io";
import { actorSeesContact, loadContactCaseSummaries, loadWorkspaceActor, type WorkspaceActor } from "@/lib/cases/visibility";
import { isOutcomeKind } from "@/lib/cases/rules";
import type { RuleEffects } from "@/lib/cases/effects";
import type { ClosePreview } from "@/lib/cases/close";
import {
  BUSINESS_TEMPLATES,
  applyBusinessTemplate as applyTemplate,
  isBusinessTemplateKey,
  type TemplateApplyResult,
} from "@/lib/business-templates";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import { displayName } from "@/lib/team-rules";
import type {
  CaseOrigin,
  CasePriority,
  CaseStatus,
  MemberAvailability,
  OutcomeKind,
  StageKind,
  TeamRole,
  WorkspaceRole,
} from "@/lib/types/database";

// ── Tipos públicos ─────────────────────────────────────────────────────────

export type CaseActionResult<T extends object = object> = ({ ok: true } & T) | { error: string };

export interface CaseView {
  id: string;
  contactId: string;
  status: CaseStatus;
  origin: CaseOrigin;
  caseTypeId: string | null;
  stageId: string | null;
  categoryId: string | null;
  teamId: string | null;
  assigneeId: string | null;
  priority: CasePriority;
  scheduledFor: string | null;
  openedAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  waitingSince: string | null;
  firstResponseAt: string | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
  closedAt: string | null;
  closedBy: string | null;
  outcomeReasonId: string | null;
  outcomeNote: string | null;
  legalDueAt: string | null;
  createdAt: string;
  permissions: CasePermissions;
}

export interface CaseTypeOption {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  isProactive: boolean;
  archived: boolean;
  requireCategory: boolean;
  requireOutcomeReason: boolean;
  stages: { id: string; name: string; color: string | null; kind: StageKind; archived: boolean }[];
  categories: { id: string; name: string; isHighPriority: boolean; archived: boolean }[];
  outcomeReasons: { id: string; name: string; kind: OutcomeKind; archived: boolean }[];
}

export interface ContactCasesView {
  contact: {
    id: string;
    displayName: string | null;
    contactTypeId: string | null;
    ownerId: string | null;
    teamId: string | null;
    keyDate: string | null;
  };
  /** Gestión activa en el chat (la pedida, o la abierta más reciente, priorizando la mía). */
  activeCaseId: string | null;
  /** Abiertas y programadas. */
  cases: CaseView[];
  /** Últimas cerradas (hasta 10), de la más reciente a la más antigua. */
  recentClosed: CaseView[];
  /** Tipos activos más los archivados que usan estas gestiones, ordenados. */
  caseTypes: CaseTypeOption[];
  contactTypes: { id: string; name: string; color: string | null; isDefault: boolean }[];
  teams: { id: string; name: string; isDefault: boolean }[];
  keyDateLabel: string | null;
  me: { userId: string; role: WorkspaceRole | null; isAdmin: boolean; supervisedTeamIds: string[] };
  canOpenCase: boolean;
}

export interface CaseMemberView {
  userId: string;
  name: string;
  email: string | null;
  role: WorkspaceRole;
  availability: MemberAvailability;
  teams: { teamId: string; role: TeamRole; caseTypeIds: string[] | null }[];
}

export interface CloseCaseActionInput {
  caseId: string;
  stageId?: string | null;
  kind?: OutcomeKind | null;
  outcomeReasonId?: string | null;
  /** undefined = conservar la categoría actual. */
  categoryId?: string | null;
  note?: string | null;
  /** "YYYY-MM-DD" cuando la vista previa trae askKeyDate. */
  keyDate?: string | null;
  /** Fecha elegida para la gestión programada ("YYYY-MM-DD" o ISO). */
  scheduleAt?: string | null;
  /** No programar nada esta vez. */
  skipSchedule?: boolean;
}

export interface OpenManualCaseInput {
  contactId: string;
  caseTypeId?: string | null;
  /** "me" (por defecto), "auto" (reparto) o el id de un miembro. */
  assignee?: "me" | "auto" | string;
  /** Fecha futura ("YYYY-MM-DD" o ISO): la gestión queda programada. */
  scheduledFor?: string | null;
}

// ── Utilidades ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "Datos no válidos.";

function isId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function optionalId(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || isId(value);
}

interface Session {
  userId: string;
  workspaceId: string;
  db: Db;
  actor: WorkspaceActor;
}

async function session(): Promise<Session | { error: string }> {
  const { user, workspace } = await getWorkspace();
  const db = await createServiceClient();
  const actor = await loadWorkspaceActor(db, workspace.id, user.id);
  if (!actor.role) return { error: "No eres miembro de este espacio de trabajo." };
  return { userId: user.id, workspaceId: workspace.id, db, actor };
}

interface CaseAccess {
  row: CaseRow;
  contact: { id: string; owner_id: string | null; team_id: string | null };
  perms: CasePermissions;
}

/** Carga la gestión del espacio actual y los permisos del usuario sobre ella. */
async function caseAccess(s: Session, caseId: unknown): Promise<CaseAccess | { error: string }> {
  if (!isId(caseId)) return { error: CASE_NOT_FOUND };
  const { data: row } = await s.db
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .eq("workspace_id", s.workspaceId)
    .maybeSingle();
  if (!row) return { error: CASE_NOT_FOUND };
  const [{ data: contact }, summaries] = await Promise.all([
    s.db
      .from("contacts")
      .select("id, owner_id, team_id")
      .eq("id", row.contact_id)
      .eq("workspace_id", s.workspaceId)
      .maybeSingle(),
    loadContactCaseSummaries(s.db, row.contact_id),
  ]);
  // Sin visibilidad respondemos "no encontrada" para no revelar que existe.
  if (!contact || !actorSeesContact(s.actor, contact, summaries)) return { error: CASE_NOT_FOUND };
  const perms = casePermissions(s.actor, {
    status: row.status,
    assigneeId: row.assignee_id,
    teamId: row.team_id,
    contactTeamId: contact.team_id,
    canSeeContact: true,
  });
  return { row, contact, perms };
}

async function withCase(
  caseId: unknown,
  check: (perms: CasePermissions) => boolean,
): Promise<{ s: Session; access: CaseAccess } | { error: string }> {
  const s = await session();
  if ("error" in s) return s;
  const access = await caseAccess(s, caseId);
  if ("error" in access) return access;
  if (!check(access.perms)) return { error: CASE_NOT_ALLOWED };
  return { s, access };
}

function toCaseView(row: CaseRow, permissions: CasePermissions): CaseView {
  return {
    id: row.id,
    contactId: row.contact_id,
    status: row.status,
    origin: row.origin,
    caseTypeId: row.case_type_id,
    stageId: row.stage_id,
    categoryId: row.category_id,
    teamId: row.team_id,
    assigneeId: row.assignee_id,
    priority: row.priority,
    scheduledFor: row.scheduled_for,
    openedAt: row.opened_at,
    lastInboundAt: row.last_inbound_at,
    lastOutboundAt: row.last_outbound_at,
    waitingSince: row.waiting_since,
    firstResponseAt: row.first_response_at,
    nextActionAt: row.next_action_at,
    nextActionNote: row.next_action_note,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    outcomeReasonId: row.outcome_reason_id,
    outcomeNote: row.outcome_note,
    legalDueAt: row.legal_due_at,
    createdAt: row.created_at,
    permissions,
  };
}

async function targetMembership(s: Session, userId: string) {
  const teamIds = s.actor.teams.map((t) => t.id);
  const [{ data: member }, { data: teams }] = await Promise.all([
    s.db.from("workspace_members").select("user_id").eq("workspace_id", s.workspaceId).eq("user_id", userId).maybeSingle(),
    teamIds.length
      ? s.db.from("team_members").select("team_id").eq("user_id", userId).in("team_id", teamIds)
      : Promise.resolve({ data: [] as { team_id: string }[] }),
  ]);
  return { userId, isWorkspaceMember: !!member, teamIds: (teams ?? []).map((t) => t.team_id) };
}

// ── Lectura ────────────────────────────────────────────────────────────────

/** Gestiones de un contacto con su tipo, etapa y opciones para la tarjeta del chat. */
export async function getContactCases(
  contactId: string,
  caseId?: string | null,
): Promise<CaseActionResult<{ data: ContactCasesView }>> {
  if (!isId(contactId) || !optionalId(caseId)) return { error: INVALID };
  const s = await session();
  if ("error" in s) return s;

  const { data: contact } = await s.db
    .from("contacts")
    .select("id, display_name, contact_type_id, owner_id, team_id, key_date")
    .eq("id", contactId)
    .eq("workspace_id", s.workspaceId)
    .maybeSingle();
  if (!contact) return { error: "No se encontró el contacto." };

  const [{ data: active }, { data: closed }, { data: ws }, { data: types }, { data: contactTypes }] =
    await Promise.all([
      s.db
        .from("cases")
        .select("*")
        .eq("contact_id", contact.id)
        .in("status", ["open", "scheduled"])
        .order("created_at", { ascending: false }),
      s.db
        .from("cases")
        .select("*")
        .eq("contact_id", contact.id)
        .in("status", ["won", "lost", "resolved", "cancelled"])
        .order("closed_at", { ascending: false, nullsFirst: false })
        .limit(10),
      s.db.from("workspaces").select("settings").eq("id", s.workspaceId).maybeSingle(),
      s.db
        .from("case_types")
        .select("*")
        .eq("workspace_id", s.workspaceId)
        .order("position", { ascending: true }),
      s.db
        .from("contact_types")
        .select("id, name, color, is_default")
        .eq("workspace_id", s.workspaceId)
        .is("archived_at", null)
        .order("position", { ascending: true }),
    ]);

  const activeCases = active ?? [];
  if (!actorSeesContact(s.actor, contact, activeCases)) return { error: "No se encontró el contacto." };

  const permsOf = (row: CaseRow) =>
    casePermissions(s.actor, {
      status: row.status,
      assigneeId: row.assignee_id,
      teamId: row.team_id,
      contactTeamId: contact.team_id,
      canSeeContact: true,
    });

  const closedCases = closed ?? [];
  const usedTypeIds = new Set(
    [...activeCases, ...closedCases].map((c) => c.case_type_id).filter((id): id is string => !!id),
  );
  const visibleTypes = (types ?? []).filter((t) => t.archived_at === null || usedTypeIds.has(t.id));
  const typeIds = visibleTypes.map((t) => t.id);
  const [{ data: stages }, { data: categories }, { data: reasons }] = typeIds.length
    ? await Promise.all([
        s.db
          .from("case_stages")
          .select("id, case_type_id, name, color, kind, position, archived_at")
          .in("case_type_id", typeIds)
          .order("position", { ascending: true }),
        s.db
          .from("case_categories")
          .select("id, case_type_id, name, is_high_priority, position, archived_at")
          .in("case_type_id", typeIds)
          .order("position", { ascending: true }),
        s.db
          .from("case_outcome_reasons")
          .select("id, case_type_id, name, kind, position, archived_at")
          .in("case_type_id", typeIds)
          .order("position", { ascending: true }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const caseTypes: CaseTypeOption[] = visibleTypes.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    icon: t.icon,
    isProactive: t.is_proactive,
    archived: t.archived_at !== null,
    requireCategory: t.require_category,
    requireOutcomeReason: t.require_outcome_reason,
    stages: (stages ?? [])
      .filter((x) => x.case_type_id === t.id)
      .map((x) => ({ id: x.id, name: x.name, color: x.color, kind: x.kind, archived: x.archived_at !== null })),
    categories: (categories ?? [])
      .filter((x) => x.case_type_id === t.id)
      .map((x) => ({ id: x.id, name: x.name, isHighPriority: x.is_high_priority, archived: x.archived_at !== null })),
    outcomeReasons: (reasons ?? [])
      .filter((x) => x.case_type_id === t.id)
      .map((x) => ({ id: x.id, name: x.name, kind: x.kind, archived: x.archived_at !== null })),
  }));

  const views = activeCases.map((row) => toCaseView(row, permsOf(row)));
  let activeCaseId: string | null = null;
  if (caseId && [...activeCases, ...closedCases].some((c) => c.id === caseId)) {
    activeCaseId = caseId;
  } else {
    const open = activeCases.filter((c) => c.status === "open");
    activeCaseId =
      open.find((c) => c.assignee_id === s.userId)?.id ?? open[0]?.id ?? activeCases[0]?.id ?? null;
  }

  const settings = ws?.settings && typeof ws.settings === "object" && !Array.isArray(ws.settings) ? ws.settings : {};
  const keyDateLabel = typeof settings.key_date_label === "string" ? settings.key_date_label : null;

  return {
    ok: true,
    data: {
      contact: {
        id: contact.id,
        displayName: contact.display_name,
        contactTypeId: contact.contact_type_id,
        ownerId: contact.owner_id,
        teamId: contact.team_id,
        keyDate: contact.key_date,
      },
      activeCaseId,
      cases: views,
      recentClosed: closedCases.map((row) => toCaseView(row, permsOf(row))),
      caseTypes,
      contactTypes: (contactTypes ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color, isDefault: t.is_default })),
      teams: s.actor.teams,
      keyDateLabel,
      me: {
        userId: s.userId,
        role: s.actor.role,
        isAdmin: isAdminRole(s.actor.role),
        supervisedTeamIds: [...supervisedTeamIds(s.actor)],
      },
      canOpenCase: true,
    },
  };
}

/** Miembros del espacio con nombre, disponibilidad y equipos (para asignar y mencionar). */
export async function listCaseMembers(): Promise<CaseActionResult<{ members: CaseMemberView[] }>> {
  const s = await session();
  if ("error" in s) return s;
  const teamIds = s.actor.teams.map((t) => t.id);
  const [{ data: members }, { data: teamMembers }] = await Promise.all([
    s.db
      .from("workspace_members")
      .select("user_id, role, availability")
      .eq("workspace_id", s.workspaceId),
    teamIds.length
      ? s.db.from("team_members").select("team_id, user_id, role, case_type_ids").in("team_id", teamIds)
      : Promise.resolve({ data: [] as { team_id: string; user_id: string; role: TeamRole; case_type_ids: string[] | null }[] }),
  ]);

  const result = await Promise.all(
    (members ?? []).map(async (m) => {
      const {
        data: { user },
      } = await s.db.auth.admin.getUserById(m.user_id);
      return {
        userId: m.user_id,
        name: displayName(user ? { id: user.id, email: user.email, user_metadata: user.user_metadata } : null),
        email: user?.email ?? null,
        role: m.role,
        availability: m.availability,
        teams: (teamMembers ?? [])
          .filter((t) => t.user_id === m.user_id)
          .map((t) => ({ teamId: t.team_id, role: t.role, caseTypeIds: t.case_type_ids })),
      };
    }),
  );
  result.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { ok: true, members: result };
}

// ── Cambios ────────────────────────────────────────────────────────────────

/** Cambia el tipo de la gestión (va a la primera etapa del tipo nuevo y se reenvía si cambia el destino). */
export async function classifyCase(
  caseId: string,
  caseTypeId: string,
): Promise<CaseActionResult<{ rerouted: boolean }>> {
  if (!isId(caseTypeId)) return { error: INVALID };
  const ctx = await withCase(caseId, (p) => p.canEdit);
  if ("error" in ctx) return ctx;
  return engine.classifyCase(ctx.s.db, { caseId: ctx.access.row.id, caseTypeId, actorId: ctx.s.userId });
}

/** Cambia a otra etapa abierta del tipo. */
export async function changeCaseStage(caseId: string, stageId: string): Promise<CaseActionResult> {
  if (!isId(stageId)) return { error: INVALID };
  const ctx = await withCase(caseId, (p) => p.canEdit);
  if ("error" in ctx) return ctx;
  return engine.changeStage(ctx.s.db, { caseId: ctx.access.row.id, stageId, actorId: ctx.s.userId });
}

/** Fija o quita la categoría. */
export async function setCaseCategory(caseId: string, categoryId: string | null): Promise<CaseActionResult> {
  if (!optionalId(categoryId)) return { error: INVALID };
  const ctx = await withCase(caseId, (p) => p.canEdit);
  if ("error" in ctx) return ctx;
  return engine.setCategory(ctx.s.db, {
    caseId: ctx.access.row.id,
    categoryId: categoryId ?? null,
    actorId: ctx.s.userId,
  });
}

/**
 * Asigna a una persona o, con `assigneeId` null, devuelve a la cola.
 * Administrador: a cualquiera. Supervisor: dentro de su equipo. Asesor: solo
 * devolver la suya a la cola si la empresa lo permite.
 */
export async function assignCase(caseId: string, assigneeId: string | null): Promise<CaseActionResult> {
  if (!optionalId(assigneeId)) return { error: INVALID };
  const ctx = await withCase(caseId, () => true);
  if ("error" in ctx) return ctx;
  const { s, access } = ctx;

  if (!assigneeId) {
    if (!access.perms.canReturnToQueue) return { error: CASE_NOT_ALLOWED };
    return engine.assignTo(s.db, { caseId: access.row.id, assigneeId: null, actorId: s.userId });
  }

  const target = await targetMembership(s, assigneeId);
  if (!target.isWorkspaceMember) return { error: "La persona no es miembro de este espacio de trabajo." };
  const info = {
    status: access.row.status,
    assigneeId: access.row.assignee_id,
    teamId: access.row.team_id,
    contactTeamId: access.contact.team_id,
    canSeeContact: true,
  };
  if (!canAssignTo(s.actor, info, target)) {
    return {
      error: access.perms.canAssign
        ? "Solo puedes asignar a personas de tu equipo."
        : CASE_NOT_ALLOWED,
    };
  }
  return engine.assignTo(s.db, {
    caseId: access.row.id,
    assigneeId,
    actorId: s.userId,
    enforceTeam: !isAdminRole(s.actor.role),
  });
}

/** Tomar una gestión sin asignar (según la visibilidad configurada para asesores). */
export async function takeCase(caseId: string): Promise<CaseActionResult> {
  const ctx = await withCase(caseId, (p) => p.canTake);
  if ("error" in ctx) return ctx;
  return engine.assignTo(ctx.s.db, {
    caseId: ctx.access.row.id,
    assigneeId: ctx.s.userId,
    actorId: ctx.s.userId,
    enforceTeam: !isAdminRole(ctx.s.actor.role),
  });
}

/** Cambia el equipo de la gestión (solo administradores), opcionalmente con responsable. */
export async function transferCase(
  caseId: string,
  teamId: string | null,
  assigneeId?: string | null,
): Promise<CaseActionResult> {
  if (!optionalId(teamId) || !optionalId(assigneeId)) return { error: INVALID };
  const ctx = await withCase(caseId, (p) => p.canTransfer);
  if ("error" in ctx) return ctx;
  return engine.transferCase(ctx.s.db, {
    caseId: ctx.access.row.id,
    teamId: teamId ?? null,
    assigneeId: assigneeId ?? null,
    actorId: ctx.s.userId,
  });
}

/** Próximo contacto: fecha ("YYYY-MM-DD" o ISO) y nota. `at` null lo quita. */
export async function setNextAction(
  caseId: string,
  at: string | null,
  note?: string | null,
): Promise<CaseActionResult<{ nextActionAt: string | null }>> {
  if ((at !== null && typeof at !== "string") || (note != null && typeof note !== "string")) {
    return { error: INVALID };
  }
  const ctx = await withCase(caseId, (p) => p.canEdit);
  if ("error" in ctx) return ctx;
  return engine.setNextAction(ctx.s.db, { caseId: ctx.access.row.id, at, note, actorId: ctx.s.userId });
}

/** Nota interna con menciones (ids de miembros). */
export async function addCaseNote(
  caseId: string,
  body: string,
  mentions: string[] = [],
  conversationId?: string | null,
): Promise<CaseActionResult<{ noteId: string; notified: string[]; notNotified: string[] }>> {
  if (typeof body !== "string" || !Array.isArray(mentions) || mentions.length > 50 || !mentions.every(isId)) {
    return { error: INVALID };
  }
  if (!optionalId(conversationId)) return { error: INVALID };
  const ctx = await withCase(caseId, (p) => p.canNote);
  if ("error" in ctx) return ctx;
  return engine.addNote(ctx.s.db, {
    caseId: ctx.access.row.id,
    body,
    mentions,
    actorId: ctx.s.userId,
    conversationId: conversationId ?? null,
  });
}

function closeInput(input: CloseCaseActionInput): engine.CloseCaseInput | null {
  if (!input || typeof input !== "object") return null;
  if (!optionalId(input.stageId) || !optionalId(input.outcomeReasonId)) return null;
  if (input.categoryId !== undefined && !optionalId(input.categoryId)) return null;
  if (input.kind != null && !isOutcomeKind(input.kind)) return null;
  if (input.keyDate != null && !isDateString(input.keyDate)) return null;
  if (input.note != null && typeof input.note !== "string") return null;
  if (input.scheduleAt != null && typeof input.scheduleAt !== "string") return null;
  return {
    caseId: input.caseId,
    stageId: input.stageId ?? null,
    kind: input.kind ?? null,
    outcomeReasonId: input.outcomeReasonId ?? null,
    categoryId: input.categoryId,
    note: input.note ?? null,
    keyDate: input.keyDate ?? null,
    overrides: { schedule_at: input.scheduleAt ?? null, skip_schedule: input.skipSchedule === true },
  };
}

/**
 * Vista previa del diálogo de cierre: si hay que pedir la fecha clave, el
 * cambio de tipo de contacto y la fecha calculada de las gestiones
 * programadas (p. ej. la Recompra a 25 días), que el asesor puede cambiar.
 */
export async function previewCloseCase(
  input: CloseCaseActionInput,
): Promise<CaseActionResult<{ preview: ClosePreview }>> {
  const parsed = closeInput(input);
  if (!parsed) return { error: INVALID };
  const ctx = await withCase(parsed.caseId, (p) => p.canClose);
  if ("error" in ctx) return ctx;
  return engine.previewClose(ctx.s.db, { ...parsed, caseId: ctx.access.row.id });
}

/** Cierra la gestión con resultado, motivo, nota y lo que pidan las reglas. */
export async function closeCase(
  input: CloseCaseActionInput,
): Promise<CaseActionResult<{ status: OutcomeKind; effects: RuleEffects }>> {
  const parsed = closeInput(input);
  if (!parsed) return { error: INVALID };
  const ctx = await withCase(parsed.caseId, (p) => p.canClose);
  if ("error" in ctx) return ctx;
  return engine.closeCase(ctx.s.db, { ...parsed, caseId: ctx.access.row.id, actorId: ctx.s.userId });
}

/** Abre una gestión a mano (en paralelo a las que tenga), o la programa para una fecha. */
export async function openManualCase(
  input: OpenManualCaseInput,
): Promise<CaseActionResult<{ caseId: string; status: "open" | "scheduled" }>> {
  if (!input || !isId(input.contactId) || !optionalId(input.caseTypeId)) return { error: INVALID };
  if (input.scheduledFor != null && typeof input.scheduledFor !== "string") return { error: INVALID };
  const assigneeRaw = input.assignee ?? "me";
  if (assigneeRaw !== "me" && assigneeRaw !== "auto" && !isId(assigneeRaw)) return { error: INVALID };

  const s = await session();
  if ("error" in s) return s;

  const { data: contact } = await s.db
    .from("contacts")
    .select("id, owner_id, team_id")
    .eq("id", input.contactId)
    .eq("workspace_id", s.workspaceId)
    .maybeSingle();
  const summaries = contact ? await loadContactCaseSummaries(s.db, contact.id) : [];
  if (!contact || !actorSeesContact(s.actor, contact, summaries)) return { error: "No se encontró el contacto." };

  let assignee: string | "auto" = assigneeRaw === "me" ? s.userId : assigneeRaw;
  if (assignee !== "auto" && assignee !== s.userId && !isAdminRole(s.actor.role)) {
    // Un supervisor puede abrirla para alguien de un equipo que supervisa.
    const target = await targetMembership(s, assignee);
    const supervised = supervisedTeamIds(s.actor);
    if (!target.isWorkspaceMember || !target.teamIds.some((t) => supervised.has(t))) {
      return { error: "Solo puedes asignar a personas de tu equipo." };
    }
  }
  if (input.scheduledFor) assignee = "auto";

  const result = await engine.openCase(s.db, {
    workspaceId: s.workspaceId,
    contactId: contact.id,
    caseTypeId: input.caseTypeId ?? null,
    actorId: s.userId,
    assignee,
    scheduledFor: input.scheduledFor ?? null,
  });
  if ("error" in result) return result;
  return { ok: true, caseId: result.caseId, status: result.status };
}

// ── Personales y configuración ─────────────────────────────────────────────

/** Disponible / Ausente. Al volver a estar disponible se reintenta el reparto de la cola. */
export async function setMyAvailability(
  availability: MemberAvailability,
): Promise<CaseActionResult<{ availability: MemberAvailability }>> {
  if (availability !== "available" && availability !== "away") return { error: INVALID };
  const s = await session();
  if ("error" in s) return s;
  const { error } = await s.db
    .from("workspace_members")
    .update({ availability })
    .eq("workspace_id", s.workspaceId)
    .eq("user_id", s.userId);
  if (error) return { error: GENERIC_ERROR };

  if (availability === "available") {
    const { db, workspaceId } = s;
    after(async () => {
      try {
        await engine.retryUnassignedCases(db, { deadline: Date.now() + 20_000, workspaceId, maxCases: 200 });
      } catch (err) {
        console.error("[cases] retry after availability", err);
      }
    });
  }
  return { ok: true, availability };
}

/** Aplica una plantilla de negocio (solo Dueño o Administrador). Nunca borra nada. */
export async function applyBusinessTemplate(
  key: string,
): Promise<CaseActionResult<{ result: TemplateApplyResult }>> {
  if (!isBusinessTemplateKey(key)) return { error: "Plantilla de negocio desconocida." };
  const s = await session();
  if ("error" in s) return s;
  if (!isAdminRole(s.actor.role)) return { error: ADMIN_ONLY_MESSAGE };
  try {
    const result = await applyTemplate(s.workspaceId, key, { db: s.db, actorId: s.userId });
    return { ok: true, result };
  } catch (err) {
    console.error("[cases] applyBusinessTemplate", err);
    return { error: `No se pudo aplicar la plantilla ${BUSINESS_TEMPLATES[key].name}. Inténtalo de nuevo.` };
  }
}

/** Marca como leídas mis notificaciones (las indicadas o todas las del espacio). */
export async function markNotificationsRead(
  ids: string[] | "all",
): Promise<CaseActionResult<{ updated: number }>> {
  if (ids !== "all" && (!Array.isArray(ids) || ids.length > 500 || !ids.every(isId))) return { error: INVALID };
  if (ids !== "all" && ids.length === 0) return { ok: true, updated: 0 };
  const s = await session();
  if ("error" in s) return s;
  let query = s.db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", s.userId)
    .eq("workspace_id", s.workspaceId)
    .is("read_at", null);
  if (ids !== "all") query = query.in("id", ids);
  const { data, error } = await query.select("id");
  if (error) return { error: GENERIC_ERROR };
  return { ok: true, updated: data?.length ?? 0 };
}
