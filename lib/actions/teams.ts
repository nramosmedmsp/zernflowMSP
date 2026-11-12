"use server";

// Acciones de servidor de la configuración de equipos (docs/FASE-1-TECNICO.md
// 4.4). Todas validan en el servidor, con getWorkspace(), que quien llama es
// Dueño o Administrador del espacio actual y que el equipo pertenece a ese
// espacio; después escriben con el cliente de servicio (así la regla vive en
// código y no depende solo de las políticas RLS).

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { auditAction } from "@/lib/audit-server";
import type { AuditAction } from "@/lib/audit";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import {
  isAssignmentMode,
  isDuplicateTeamName,
  isTeamRole,
  normalizeCaseTypeSelection,
  normalizeTeamName,
} from "@/components/settings/teams/team-rules";
import type { AssignmentMode, TeamRole } from "@/lib/types/database";

export type TeamActionResult<T extends object = object> = ({ ok: true } & T) | { error: string };

const WORKSPACE_CHANGED = "El espacio de trabajo cambió. Recarga la página e inténtalo de nuevo.";
const GENERIC_ERROR = "No se pudo guardar el cambio. Inténtalo de nuevo.";
const TEAM_NOT_FOUND = "No se encontró el equipo. Recarga la página e inténtalo de nuevo.";
const MEMBER_NOT_FOUND = "Esa persona no pertenece al espacio de trabajo.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

interface AdminContext {
  db: ServiceClient;
  workspaceId: string;
  userId: string;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

async function adminContext(): Promise<AdminContext | { error: string }> {
  const { workspace, role, user } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };
  return { db: await createServiceClient(), workspaceId: workspace.id, userId: user.id };
}

/** Registro de cambios (nunca rompe la acción): quién y qué equipo, con antes → después si aplica. */
async function auditTeam(
  ctx: AdminContext,
  action: AuditAction,
  details: { fromValue?: string | null; toValue?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  await auditAction({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action,
    entity: "teams",
    fromValue: details.fromValue ?? null,
    toValue: details.toValue ?? null,
    meta: details.meta,
  });
}

async function loadTeam(ctx: AdminContext, teamId: unknown) {
  if (!isId(teamId)) return null;
  const { data } = await ctx.db
    .from("teams")
    .select("id, name, is_default, archived_at, assignment_mode, supervisor_skips_chats")
    .eq("id", teamId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  return data;
}

async function activeCaseTypeIds(ctx: AdminContext): Promise<Set<string>> {
  const { data } = await ctx.db
    .from("case_types")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .is("archived_at", null);
  return new Set((data ?? []).map((t) => t.id));
}

function done<T extends object>(extra?: T): { ok: true } & T {
  revalidatePath("/dashboard/settings/teams");
  return { ok: true, ...(extra ?? ({} as T)) };
}

async function teamNames(ctx: AdminContext) {
  const { data } = await ctx.db.from("teams").select("id, name").eq("workspace_id", ctx.workspaceId);
  return data ?? [];
}

// ── Equipos ────────────────────────────────────────────────────────────────

/** Crea un equipo. El equipo por defecto se marca aparte con setDefaultTeam. */
export async function createTeam(
  workspaceId: string,
  name: string,
): Promise<TeamActionResult<{ teamId: string }>> {
  const ctx = await adminContext();
  if ("error" in ctx) return ctx;
  if (ctx.workspaceId !== workspaceId) return { error: WORKSPACE_CHANGED };

  const parsed = normalizeTeamName(name);
  if ("error" in parsed) return parsed;
  if (isDuplicateTeamName(parsed.name, await teamNames(ctx))) {
    return { error: "Ya hay un equipo con ese nombre." };
  }

  // R2-1: el primer equipo activo del espacio queda como equipo por defecto (sin él, los
  // contactos sin sede no tendrían a quién repartirse).
  const { data: activeTeams } = await ctx.db
    .from("teams")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .is("archived_at", null);
  const { data, error } = await ctx.db
    .from("teams")
    .insert({ workspace_id: ctx.workspaceId, name: parsed.name, is_default: (activeTeams ?? []).length === 0 })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[teams] createTeam", error?.message);
    return { error: GENERIC_ERROR };
  }
  await auditTeam(ctx, "team_created", { toValue: parsed.name, meta: { team_name: parsed.name } });
  return done({ teamId: data.id });
}

export async function renameTeam(teamId: string, name: string): Promise<TeamActionResult> {
  const ctx = await adminContext();
  if ("error" in ctx) return ctx;
  const team = await loadTeam(ctx, teamId);
  if (!team) return { error: TEAM_NOT_FOUND };

  const parsed = normalizeTeamName(name);
  if ("error" in parsed) return parsed;
  if (isDuplicateTeamName(parsed.name, await teamNames(ctx), team.id)) {
    return { error: "Ya hay un equipo con ese nombre." };
  }

  const { error } = await ctx.db.from("teams").update({ name: parsed.name }).eq("id", team.id);
  if (error) {
    console.error("[teams] renameTeam", error.message);
    return { error: GENERIC_ERROR };
  }
  if (team.name !== parsed.name) {
    await auditTeam(ctx, "team_renamed", { fromValue: team.name, toValue: parsed.name, meta: { team_name: parsed.name } });
  }
  return done();
}

/**
 * Archiva o reactiva un equipo. Un equipo archivado deja de ser el de por
 * defecto, así que el que lo es no se archiva mientras haya otros equipos
 * activos: primero se elige otro (R2-1).
 */
export async function setTeamArchived(teamId: string, archived: boolean): Promise<TeamActionResult> {
  if (typeof archived !== "boolean") return { error: GENERIC_ERROR };
  const ctx = await adminContext();
  if ("error" in ctx) return ctx;
  const team = await loadTeam(ctx, teamId);
  if (!team) return { error: TEAM_NOT_FOUND };

  // R2-8: un tipo con este equipo como destino fijo mandaría sus gestiones a otro lado en silencio.
  if (archived && !team.archived_at) {
    const { data: fixedTypes } = await ctx.db
      .from("case_types")
      .select("name")
      .eq("workspace_id", ctx.workspaceId)
      .eq("fixed_team_id", team.id)
      .eq("routing", "fixed_team")
      .is("archived_at", null);
    if ((fixedTypes ?? []).length > 0) {
      const names = (fixedTypes ?? []).map((t) => `«${t.name}»`).join(", ");
      return {
        error: `Estos tipos de gestión mandan sus gestiones a este equipo: ${names}. Cambia su destino en Configuración → Gestiones antes de archivarlo.`,
      };
    }
  }

  if (archived && team.is_default && !team.archived_at) {
    const { data: others } = await ctx.db
      .from("teams")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .is("archived_at", null)
      .neq("id", team.id);
    if ((others ?? []).length > 0) {
      return { error: "Este es el equipo por defecto. Marca otro equipo como por defecto antes de archivarlo." };
    }
  }

  const patch = archived
    ? { archived_at: team.archived_at ?? new Date().toISOString(), is_default: false }
    : { archived_at: null };
  const { error } = await ctx.db.from("teams").update(patch).eq("id", team.id);
  if (error) {
    console.error("[teams] setTeamArchived", error.message);
    return { error: GENERIC_ERROR };
  }
  // Solo si de verdad cambió de estado (archivar uno ya archivado no deja fila).
  if (archived !== !!team.archived_at) {
    await auditTeam(ctx, archived ? "team_archived" : "team_restored", { meta: { team_name: team.name } });
  }
  return done();
}

/**
 * Marca un equipo activo como el de por defecto (queda uno solo) o, con
 * `null`, deja el espacio sin equipo por defecto.
 */
export async function setDefaultTeam(teamId: string | null): Promise<TeamActionResult> {
  const ctx = await adminContext();
  if ("error" in ctx) return ctx;

  if (teamId === null) {
    // R2-1: con equipos activos siempre tiene que haber uno por defecto.
    const { data: active } = await ctx.db
      .from("teams")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .is("archived_at", null);
    if ((active ?? []).length > 0) {
      return { error: "Tiene que haber un equipo por defecto. Para cambiarlo, marca otro equipo como por defecto." };
    }
    const { error } = await ctx.db
      .from("teams")
      .update({ is_default: false })
      .eq("workspace_id", ctx.workspaceId)
      .eq("is_default", true);
    if (error) return { error: GENERIC_ERROR };
    return done();
  }

  const team = await loadTeam(ctx, teamId);
  if (!team) return { error: TEAM_NOT_FOUND };
  if (team.archived_at) return { error: "Reactiva el equipo antes de marcarlo como equipo por defecto." };
  const { data: previousDefault } = await ctx.db
    .from("teams")
    .select("name")
    .eq("workspace_id", ctx.workspaceId)
    .eq("is_default", true)
    .neq("id", team.id)
    .maybeSingle();

  // Primero se libera el actual: el índice único solo admite un equipo por defecto activo.
  const { error: clearError } = await ctx.db
    .from("teams")
    .update({ is_default: false })
    .eq("workspace_id", ctx.workspaceId)
    .eq("is_default", true)
    .neq("id", team.id);
  if (clearError) {
    console.error("[teams] setDefaultTeam (liberar)", clearError.message);
    return { error: GENERIC_ERROR };
  }
  const { error } = await ctx.db.from("teams").update({ is_default: true }).eq("id", team.id);
  if (error) {
    console.error("[teams] setDefaultTeam", error.message);
    return { error: GENERIC_ERROR };
  }
  if (!team.is_default) {
    await auditTeam(ctx, "team_default_changed", {
      fromValue: previousDefault?.name ?? null,
      toValue: team.name,
      meta: { team_name: team.name },
    });
  }
  return done();
}

export async function setTeamAssignmentMode(
  teamId: string,
  mode: AssignmentMode,
): Promise<TeamActionResult> {
  if (!isAssignmentMode(mode)) return { error: "El modo de reparto no es válido." };
  const ctx = await adminContext();
  if ("error" in ctx) return ctx;
  const team = await loadTeam(ctx, teamId);
  if (!team) return { error: TEAM_NOT_FOUND };

  const { error } = await ctx.db.from("teams").update({ assignment_mode: mode }).eq("id", team.id);
  if (error) {
    console.error("[teams] setTeamAssignmentMode", error.message);
    return { error: GENERIC_ERROR };
  }
  if (team.assignment_mode !== mode) {
    await auditTeam(ctx, "team_assignment_mode_changed", {
      fromValue: team.assignment_mode,
      toValue: mode,
      meta: { team_name: team.name },
    });
  }
  return done();
}

/**
 * R2-17: "El supervisor no recibe chats". Con true, los supervisores del equipo
 * quedan fuera del reparto automático (se les puede asignar a mano). Por
 * defecto false: los supervisores entran en el reparto como cualquier miembro.
 */
export async function setTeamSupervisorSkipsChats(teamId: string, skips: boolean): Promise<TeamActionResult> {
  if (typeof skips !== "boolean") return { error: GENERIC_ERROR };
  const ctx = await adminContext();
  if ("error" in ctx) return ctx;
  const team = await loadTeam(ctx, teamId);
  if (!team) return { error: TEAM_NOT_FOUND };

  const { error } = await ctx.db.from("teams").update({ supervisor_skips_chats: skips }).eq("id", team.id);
  if (error) {
    console.error("[teams] setTeamSupervisorSkipsChats", error.message);
    return { error: GENERIC_ERROR };
  }
  if (!!team.supervisor_skips_chats !== skips) {
    await auditTeam(ctx, "team_supervisor_skips_changed", { toValue: skips ? "on" : "off", meta: { team_name: team.name } });
  }
  return done();
}

// ── Miembros del equipo ────────────────────────────────────────────────────

export interface TeamMemberInput {
  role: TeamRole;
  /** `null` = atiende todos los tipos de gestión. */
  caseTypeIds: string[] | null;
}

async function checkMemberInput(
  ctx: AdminContext,
  input: TeamMemberInput,
): Promise<{ role: TeamRole; caseTypeIds: string[] | null } | { error: string }> {
  if (!input || !isTeamRole(input.role)) return { error: "El rol de equipo no es válido." };
  // R2-9: los tipos archivados que la persona ya tenía guardados se descartan en vez de rechazar
  // todo el cambio (si no, no se le podría ni cambiar el rol).
  let wanted: unknown = input.caseTypeIds;
  if (Array.isArray(wanted) && wanted.length > 0) {
    const { data: archived } = await ctx.db
      .from("case_types")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .not("archived_at", "is", null);
    const gone = new Set((archived ?? []).map((t) => t.id));
    const kept = wanted.filter((id) => !(typeof id === "string" && gone.has(id)));
    // Si solo tenía tipos archivados, queda lista vacía y se pide elegir (no se vuelve "todos" a escondidas).
    wanted = kept;
  }
  const selection = normalizeCaseTypeSelection(wanted, await activeCaseTypeIds(ctx));
  if ("error" in selection) return selection;
  return { role: input.role, caseTypeIds: selection.value };
}

/** Agrega al equipo a un miembro del espacio (o actualiza su rol y tipos si ya estaba). */
export async function addTeamMember(
  teamId: string,
  userId: string,
  input: TeamMemberInput,
): Promise<TeamActionResult> {
  const ctx = await adminContext();
  if ("error" in ctx) return ctx;
  const team = await loadTeam(ctx, teamId);
  if (!team) return { error: TEAM_NOT_FOUND };
  if (!isId(userId)) return { error: MEMBER_NOT_FOUND };

  const { data: member } = await ctx.db
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return { error: MEMBER_NOT_FOUND };

  const checked = await checkMemberInput(ctx, input);
  if ("error" in checked) return checked;

  const { data: existing } = await ctx.db
    .from("team_members")
    .select("user_id, role")
    .eq("team_id", team.id)
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = existing
    ? await ctx.db
        .from("team_members")
        .update({ role: checked.role, case_type_ids: checked.caseTypeIds })
        .eq("team_id", team.id)
        .eq("user_id", userId)
    : await ctx.db.from("team_members").insert({
        team_id: team.id,
        user_id: userId,
        role: checked.role,
        case_type_ids: checked.caseTypeIds,
      });
  if (error) {
    console.error("[teams] addTeamMember", error.message);
    return { error: GENERIC_ERROR };
  }
  if (!existing) {
    await auditTeam(ctx, "team_member_added", {
      toValue: checked.role,
      meta: { team_name: team.name, user_id: userId },
    });
  } else if (existing.role !== checked.role) {
    await auditTeam(ctx, "team_member_role_changed", {
      fromValue: existing.role,
      toValue: checked.role,
      meta: { team_name: team.name, user_id: userId },
    });
  }
  return done();
}

/** Cambia el rol de equipo y los tipos de gestión que atiende un miembro. */
export async function updateTeamMember(
  teamId: string,
  userId: string,
  input: TeamMemberInput,
): Promise<TeamActionResult> {
  const ctx = await adminContext();
  if ("error" in ctx) return ctx;
  const team = await loadTeam(ctx, teamId);
  if (!team) return { error: TEAM_NOT_FOUND };
  if (!isId(userId)) return { error: MEMBER_NOT_FOUND };

  const checked = await checkMemberInput(ctx, input);
  if ("error" in checked) return checked;

  const { data: before } = await ctx.db
    .from("team_members")
    .select("role")
    .eq("team_id", team.id)
    .eq("user_id", userId)
    .maybeSingle();

  const { data, error } = await ctx.db
    .from("team_members")
    .update({ role: checked.role, case_type_ids: checked.caseTypeIds })
    .eq("team_id", team.id)
    .eq("user_id", userId)
    .select("user_id");
  if (error) {
    console.error("[teams] updateTeamMember", error.message);
    return { error: GENERIC_ERROR };
  }
  if (!data || data.length === 0) return { error: "Esa persona no está en el equipo." };
  if (before && before.role !== checked.role) {
    await auditTeam(ctx, "team_member_role_changed", {
      fromValue: before.role,
      toValue: checked.role,
      meta: { team_name: team.name, user_id: userId },
    });
  }
  return done();
}

export async function removeTeamMember(teamId: string, userId: string): Promise<TeamActionResult> {
  const ctx = await adminContext();
  if ("error" in ctx) return ctx;
  const team = await loadTeam(ctx, teamId);
  if (!team) return { error: TEAM_NOT_FOUND };
  if (!isId(userId)) return { error: MEMBER_NOT_FOUND };

  const { data: removed, error } = await ctx.db
    .from("team_members")
    .delete()
    .eq("team_id", team.id)
    .eq("user_id", userId)
    .select("role");
  if (error) {
    console.error("[teams] removeTeamMember", error.message);
    return { error: GENERIC_ERROR };
  }
  if (removed && removed.length > 0) {
    await auditTeam(ctx, "team_member_removed", {
      fromValue: removed[0].role,
      meta: { team_name: team.name, user_id: userId },
    });
  }
  return done();
}
