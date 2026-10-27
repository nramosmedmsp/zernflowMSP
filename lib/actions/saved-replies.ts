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
import { createServiceClient } from "@/lib/supabase/server";
import { parseMediaPath, replyMediaPath, safeFileName, validateReplyAttachment } from "@/lib/chat-media";
import { createUploadUrl, objectInfo, removeObjects } from "@/lib/media-store";
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
  /** Foto o PDF que sale junto con el texto (ruta en el bucket privado). */
  attachment: SavedReplyAttachment | null;
  updatedAt: string;
  /** ¿El usuario puede editarla o borrarla? */
  canEdit: boolean;
}

export interface SavedReplyAttachment {
  path: string;
  name: string;
  mime: string;
  size: number | null;
}

/** Archivo subido para la respuesta: undefined = no se toca; null = se quita. */
export type SavedReplyAttachmentInput = { path: string; name: string } | null | undefined;

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
  attachment?: SavedReplyAttachmentInput;
};

export type UpdateSavedReplyInput = SavedReplyInput & { attachment?: SavedReplyAttachmentInput };

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
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  updated_at: string;
}

const REPLY_COLUMNS =
  "id, scope, team_id, user_id, case_type_id, title, shortcut, body, attachment_url, attachment_name, attachment_mime, attachment_size, updated_at";

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
    attachment: row.attachment_url
      ? {
          path: row.attachment_url,
          name: row.attachment_name ?? "archivo",
          mime: row.attachment_mime ?? "application/octet-stream",
          size: row.attachment_size,
        }
      : null,
    updatedAt: row.updated_at,
    canEdit: canWrite(access, userId, row),
  };
}

type AttachmentColumns = {
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
};

/**
 * Revisa el archivo que el navegador subió para la respuesta: que esté en la
 * carpeta de respuestas de esta empresa, que no lo use otra respuesta, y lee
 * su tipo y tamaño reales del almacenamiento.
 */
async function resolveAttachment(
  ctx: Ctx,
  input: { path: string; name: string } | null,
  currentPath: string | null,
): Promise<{ ok: true; value: AttachmentColumns } | { error: string }> {
  if (input === null) return { ok: true, value: { attachment_url: null, attachment_name: null, attachment_mime: null, attachment_size: null } };
  const parsed = parseMediaPath(input.path);
  if (!parsed || parsed.kind !== "replies" || parsed.workspaceId !== ctx.workspace.id) return { error: "El archivo no es válido." };
  const service = await createServiceClient();
  if (input.path !== currentPath) {
    const { data: used } = await service.from("saved_replies").select("id").eq("attachment_url", input.path).limit(1);
    if (used && used.length > 0) return { error: "El archivo no es válido." };
  }
  const info = await objectInfo(service, input.path);
  if (!info) return { error: "El archivo no terminó de subir. Inténtalo de nuevo." };
  const check = validateReplyAttachment(info);
  if (!check.ok) return { error: check.error };
  if (check.compress) return { error: "La foto pesa más de 5 MB." };
  return {
    ok: true,
    value: {
      attachment_url: input.path,
      attachment_name: safeFileName(input.name, `archivo.${input.path.split(".").pop() ?? "pdf"}`),
      attachment_mime: info.mime,
      attachment_size: info.size,
    },
  };
}

async function removeReplyFile(path: string | null) {
  if (!path) return;
  await removeObjects(await createServiceClient(), [path]);
}

/**
 * Enlace de subida firmado para el archivo de una respuesta guardada. El
 * navegador sube directo al bucket; al guardar la respuesta se revisa el
 * archivo (resolveAttachment).
 */
export async function createReplyUploadUrl(file: {
  mime: string;
  size: number;
}): Promise<SavedReplyResult<{ path: string; token: string }>> {
  try {
    const ctx = await getWorkspace();
    if (typeof file?.mime !== "string" || typeof file?.size !== "number") return { error: "Faltan los datos del archivo." };
    const check = validateReplyAttachment(file);
    if (!check.ok) return { error: check.error };
    if (check.compress) return { error: "La foto pesa más de 5 MB." };
    const upload = await createUploadUrl(await createServiceClient(), replyMediaPath(ctx.workspace.id, file.mime));
    if (!upload) return { error: "No se pudo preparar la subida. Inténtalo de nuevo." };
    return { ok: true, ...upload };
  } catch (err) {
    console.error("[saved-replies] upload url", err);
    return { error: "No se pudo preparar la subida. Inténtalo de nuevo." };
  }
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

    const checked = validateSavedReplyInput({ ...input, hasAttachment: !!input.attachment });
    if (!checked.ok) return { error: checked.error };
    const { title, shortcut, body, caseTypeId } = checked.value;

    if (caseTypeId && !(await caseTypeBelongsToWorkspace(ctx, caseTypeId))) {
      return { error: "El tipo de gestión no existe." };
    }
    const owners = await shortcutOwners(ctx, { scope, teamId, userId: target.user_id });
    if (hasShortcutConflict(shortcut, owners)) return { error: SHORTCUT_TAKEN };
    const file = await resolveAttachment(ctx, input.attachment ?? null, null);
    if ("error" in file) return { error: file.error };

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
        ...file.value,
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

/** Cambia título, atajo, texto, archivo y tipo de gestión; el alcance no se cambia. */
export async function updateSavedReply(
  id: string,
  input: UpdateSavedReplyInput,
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

    const keepFile = input.attachment === undefined;
    const checked = validateSavedReplyInput({ ...input, hasAttachment: keepFile ? !!row.attachment_url : !!input.attachment });
    if (!checked.ok) return { error: checked.error };
    const { title, shortcut, body, caseTypeId } = checked.value;

    if (caseTypeId && !(await caseTypeBelongsToWorkspace(ctx, caseTypeId))) {
      return { error: "El tipo de gestión no existe." };
    }
    const owners = await shortcutOwners(ctx, { scope: row.scope, teamId: row.team_id, userId: row.user_id });
    if (hasShortcutConflict(shortcut, owners, id)) return { error: SHORTCUT_TAKEN };
    let fileColumns: AttachmentColumns | null = null;
    if (!keepFile) {
      const file = await resolveAttachment(ctx, input.attachment ?? null, row.attachment_url);
      if ("error" in file) return { error: file.error };
      fileColumns = file.value;
    }

    const { data, error } = await ctx.supabase
      .from("saved_replies")
      .update({ title, shortcut, body, case_type_id: caseTypeId, ...(fileColumns ?? {}) })
      .eq("id", id)
      .eq("workspace_id", ctx.workspace.id)
      .select(REPLY_COLUMNS);
    if (error || !data || data.length === 0) {
      console.error("[saved-replies] update", error?.message);
      const denied = error ? error.code === "42501" : true;
      return { error: denied ? NOT_ALLOWED[row.scope] : GENERIC_ERROR };
    }
    // El archivo anterior ya no lo usa nadie.
    if (fileColumns && row.attachment_url && row.attachment_url !== fileColumns.attachment_url) {
      await removeReplyFile(row.attachment_url);
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
    await removeReplyFile(row.attachment_url);
    return { ok: true };
  } catch (err) {
    console.error("[saved-replies] delete", err);
    return { error: "No se pudo borrar la respuesta. Inténtalo de nuevo." };
  }
}
