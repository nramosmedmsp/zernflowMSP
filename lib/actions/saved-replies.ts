"use server";

// Acciones de servidor de las respuestas guardadas (docs/PLAN-CRM.md 7.4).
//
// Se usa siempre el cliente del usuario: las políticas RLS de `saved_replies`
// (migración 00019) son la fuente de verdad de quién ve y escribe cada alcance:
//   - empresa: leen los miembros, escribe el Dueño o un Administrador;
//   - equipo: leen los miembros del equipo, escriben su supervisor y los
//     administradores;
//   - personal: solo el autor.
// Aquí se replican esas reglas solo para dar mensajes claros en español y
// marcar `canEdit` en la interfaz. Devuelven { ok: true, ... } o { error }.

import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import {
  hasShortcutConflict,
  validateSavedReplyInput,
  type SavedReplyInput,
} from "@/lib/saved-replies";
import type { SavedReplyScope, TeamRole } from "@/lib/types/database";

export type SavedReplyResult<T extends object = object> = ({ ok: true } & T) | { error: string };

export interface SavedReplyView {
  id: string;
  scope: SavedReplyScope;
  teamId: string | null;
  teamName: string | null;
  caseTypeId: string | null;
  title: string;
  shortcut: string | null;
  body: string;
  /** ¿El usuario puede editarla o borrarla? */
  canEdit: boolean;
}

export interface ReplyTeamOption {
  id: string;
  name: string;
  /** ¿Puede crear y editar respuestas de este equipo? */
  canManage: boolean;
}

export interface ReplyCaseTypeOption {
  id: string;
  name: string;
}

export interface SavedRepliesData {
  userId: string;
  replies: SavedReplyView[];
  teams: ReplyTeamOption[];
  caseTypes: ReplyCaseTypeOption[];
  /** Puede crear y editar las de la empresa. */
  canManageWorkspace: boolean;
}

export type CreateSavedReplyInput = SavedReplyInput & {
  scope: SavedReplyScope;
  /** Obligatorio si el alcance es `team`. */
  teamId?: string | null;
};

const GENERIC_ERROR = "No se pudo guardar la respuesta. Inténtalo de nuevo.";
const NOT_FOUND = "No se encontró la respuesta.";
const NOT_ALLOWED: Record<SavedReplyScope, string> = {
  workspace: "Solo el Dueño o un Administrador pueden cambiar las respuestas de la empresa.",
  team: "Solo el supervisor del equipo o un Administrador pueden cambiar las respuestas del equipo.",
  personal: "Solo puedes cambiar tus propias respuestas.",
};
const SHORTCUT_TAKEN = "Ya hay otra respuesta con ese atajo en este grupo. Elige otro.";

type Ctx = Awaited<ReturnType<typeof getWorkspace>>;

interface Access {
  isAdmin: boolean;
  teams: Array<{ id: string; name: string }>;
  supervised: Set<string>;
}

async function loadAccess(ctx: Ctx): Promise<Access> {
  const { supabase, user, workspace, role } = ctx;
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name")
    .eq("workspace_id", workspace.id)
    .is("archived_at", null)
    .order("name", { ascending: true });

  const ids = (teams ?? []).map((t) => t.id);
  const { data: memberships } = ids.length
    ? await supabase.from("team_members").select("team_id, role").eq("user_id", user.id).in("team_id", ids)
    : { data: [] as Array<{ team_id: string; role: TeamRole }> };

  return {
    isAdmin: isAdminRole(role),
    teams: teams ?? [],
    supervised: new Set((memberships ?? []).filter((m) => m.role === "supervisor").map((m) => m.team_id)),
  };
}

function canWrite(
  access: Access,
  userId: string,
  row: { scope: SavedReplyScope; team_id: string | null; user_id: string | null },
): boolean {
  if (row.scope === "workspace") return access.isAdmin;
  if (row.scope === "team") return !!row.team_id && (access.isAdmin || access.supervised.has(row.team_id));
  return row.user_id === userId;
}

interface ReplyRow {
  id: string;
  scope: SavedReplyScope;
  team_id: string | null;
  user_id: string | null;
  case_type_id: string | null;
  title: string;
  shortcut: string | null;
  body: string;
}

const REPLY_COLUMNS = "id, scope, team_id, user_id, case_type_id, title, shortcut, body";

function toView(row: ReplyRow, access: Access, userId: string): SavedReplyView {
  return {
    id: row.id,
    scope: row.scope,
    teamId: row.team_id,
    teamName: row.team_id ? (access.teams.find((t) => t.id === row.team_id)?.name ?? null) : null,
    caseTypeId: row.case_type_id,
    title: row.title,
    shortcut: row.shortcut,
    body: row.body,
    canEdit: canWrite(access, userId, row),
  };
}

/** Respuestas del mismo grupo (alcance + equipo o autor), para el atajo único. */
async function shortcutOwners(
  ctx: Ctx,
  group: { scope: SavedReplyScope; teamId: string | null; userId: string | null },
): Promise<Array<{ id: string; shortcut: string | null }>> {
  let query = ctx.supabase
    .from("saved_replies")
    .select("id, shortcut")
    .eq("workspace_id", ctx.workspace.id)
    .eq("scope", group.scope)
    .not("shortcut", "is", null);
  if (group.scope === "team") query = query.eq("team_id", group.teamId ?? "");
  if (group.scope === "personal") query = query.eq("user_id", group.userId ?? "");
  const { data } = await query;
  return data ?? [];
}

async function caseTypeBelongsToWorkspace(ctx: Ctx, caseTypeId: string): Promise<boolean> {
  const { data } = await ctx.supabase
    .from("case_types")
    .select("id")
    .eq("id", caseTypeId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  return !!data;
}

/**
 * Respuestas que el usuario puede ver (las filtra la RLS), con los equipos y
 * tipos de gestión para el formulario. También lo usa el selector de la bandeja.
 */
export async function listSavedReplies(): Promise<SavedReplyResult<{ data: SavedRepliesData }>> {
  try {
    const ctx = await getWorkspace();
    const access = await loadAccess(ctx);

    const [{ data: rows, error }, { data: caseTypes }] = await Promise.all([
      ctx.supabase
        .from("saved_replies")
        .select(REPLY_COLUMNS)
        .eq("workspace_id", ctx.workspace.id)
        .order("title", { ascending: true }),
      ctx.supabase
        .from("case_types")
        .select("id, name")
        .eq("workspace_id", ctx.workspace.id)
        .is("archived_at", null)
        .order("position", { ascending: true }),
    ]);
    if (error) {
      console.error("[saved-replies] list", error.message);
      return { error: "No se pudieron cargar las respuestas guardadas." };
    }

    // Equipos que el usuario puede ver: todos si es administrador; si no, los
    // suyos (los de las respuestas que le llegan).
    const visibleTeamIds = new Set((rows ?? []).filter((r) => r.team_id).map((r) => r.team_id as string));
    for (const id of access.supervised) visibleTeamIds.add(id);
    const teams: ReplyTeamOption[] = access.teams
      .filter((t) => access.isAdmin || visibleTeamIds.has(t.id))
      .map((t) => ({ id: t.id, name: t.name, canManage: access.isAdmin || access.supervised.has(t.id) }));

    return {
      ok: true,
      data: {
        userId: ctx.user.id,
        replies: (rows ?? []).map((r) => toView(r as ReplyRow, access, ctx.user.id)),
        teams,
        caseTypes: caseTypes ?? [],
        canManageWorkspace: access.isAdmin,
      },
    };
  } catch (err) {
    console.error("[saved-replies] list", err);
    return { error: "No se pudieron cargar las respuestas guardadas." };
  }
}

export async function createSavedReply(
  input: CreateSavedReplyInput,
): Promise<SavedReplyResult<{ reply: SavedReplyView }>> {
  try {
    const ctx = await getWorkspace();
    const access = await loadAccess(ctx);

    const scope = input.scope;
    if (scope !== "workspace" && scope !== "team" && scope !== "personal") {
      return { error: GENERIC_ERROR };
    }
    const teamId = scope === "team" ? (input.teamId ?? null) : null;
    if (scope === "team") {
      if (!teamId || !access.teams.some((t) => t.id === teamId)) return { error: "Elige un equipo." };
    }
    const target = {
      scope,
      team_id: teamId,
      user_id: scope === "personal" ? ctx.user.id : null,
    };
    if (!canWrite(access, ctx.user.id, target)) return { error: NOT_ALLOWED[scope] };

    const checked = validateSavedReplyInput(input);
    if (!checked.ok) return { error: checked.error };
    const { title, shortcut, body, caseTypeId } = checked.value;

    if (caseTypeId && !(await caseTypeBelongsToWorkspace(ctx, caseTypeId))) {
      return { error: "El tipo de gestión no existe." };
    }
    const owners = await shortcutOwners(ctx, { scope, teamId, userId: target.user_id });
    if (hasShortcutConflict(shortcut, owners)) return { error: SHORTCUT_TAKEN };

    const { data, error } = await ctx.supabase
      .from("saved_replies")
      .insert({
        workspace_id: ctx.workspace.id,
        scope,
        team_id: target.team_id,
        user_id: target.user_id,
        case_type_id: caseTypeId,
        title,
        shortcut,
        body,
        created_by: ctx.user.id,
      })
      .select(REPLY_COLUMNS)
      .single();
    if (error || !data) {
      console.error("[saved-replies] create", error?.message);
      return { error: error?.code === "42501" ? NOT_ALLOWED[scope] : GENERIC_ERROR };
    }
    return { ok: true, reply: toView(data as ReplyRow, access, ctx.user.id) };
  } catch (err) {
    console.error("[saved-replies] create", err);
    return { error: GENERIC_ERROR };
  }
}

/** Cambia título, atajo, texto y tipo de gestión; el alcance no se cambia. */
export async function updateSavedReply(
  id: string,
  input: SavedReplyInput,
): Promise<SavedReplyResult<{ reply: SavedReplyView }>> {
  try {
    const ctx = await getWorkspace();
    const access = await loadAccess(ctx);

    const { data: current } = await ctx.supabase
      .from("saved_replies")
      .select(REPLY_COLUMNS)
      .eq("id", id)
      .eq("workspace_id", ctx.workspace.id)
      .maybeSingle();
    if (!current) return { error: NOT_FOUND };
    const row = current as ReplyRow;
    if (!canWrite(access, ctx.user.id, row)) return { error: NOT_ALLOWED[row.scope] };

    const checked = validateSavedReplyInput(input);
    if (!checked.ok) return { error: checked.error };
    const { title, shortcut, body, caseTypeId } = checked.value;

    if (caseTypeId && !(await caseTypeBelongsToWorkspace(ctx, caseTypeId))) {
      return { error: "El tipo de gestión no existe." };
    }
    const owners = await shortcutOwners(ctx, { scope: row.scope, teamId: row.team_id, userId: row.user_id });
    if (hasShortcutConflict(shortcut, owners, id)) return { error: SHORTCUT_TAKEN };

    const { data, error } = await ctx.supabase
      .from("saved_replies")
      .update({ title, shortcut, body, case_type_id: caseTypeId })
      .eq("id", id)
      .eq("workspace_id", ctx.workspace.id)
      .select(REPLY_COLUMNS);
    if (error || !data || data.length === 0) {
      console.error("[saved-replies] update", error?.message);
      const denied = error ? error.code === "42501" : true;
      return { error: denied ? NOT_ALLOWED[row.scope] : GENERIC_ERROR };
    }
    return { ok: true, reply: toView(data[0] as ReplyRow, access, ctx.user.id) };
  } catch (err) {
    console.error("[saved-replies] update", err);
    return { error: GENERIC_ERROR };
  }
}

export async function deleteSavedReply(id: string): Promise<SavedReplyResult> {
  try {
    const ctx = await getWorkspace();
    const access = await loadAccess(ctx);

    const { data: current } = await ctx.supabase
      .from("saved_replies")
      .select(REPLY_COLUMNS)
      .eq("id", id)
      .eq("workspace_id", ctx.workspace.id)
      .maybeSingle();
    if (!current) return { error: NOT_FOUND };
    const row = current as ReplyRow;
    if (!canWrite(access, ctx.user.id, row)) return { error: NOT_ALLOWED[row.scope] };

    const { data, error } = await ctx.supabase
      .from("saved_replies")
      .delete()
      .eq("id", id)
      .eq("workspace_id", ctx.workspace.id)
      .select("id");
    if (error || !data || data.length === 0) {
      console.error("[saved-replies] delete", error?.message);
      return { error: "No se pudo borrar la respuesta. Inténtalo de nuevo." };
    }
    return { ok: true };
  } catch (err) {
    console.error("[saved-replies] delete", err);
    return { error: "No se pudo borrar la respuesta. Inténtalo de nuevo." };
  }
}
