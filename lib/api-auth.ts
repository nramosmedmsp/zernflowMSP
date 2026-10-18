// Autorización para las rutas de app/api/v1 (docs/FASE-1-TECNICO.md 2.3).
//
// Resuelve el usuario, el espacio activo (cookie del selector, o el primero)
// y su rol, y devuelve una respuesta JSON de error en español si no cumple.
// Las rutas que solo usan el cliente del usuario quedan además cubiertas por
// RLS; las que usan el cliente de servicio (secretos, envíos programados)
// dependen de esta validación.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { WORKSPACE_COOKIE } from "@/lib/workspace";
import { ADMIN_ONLY_MESSAGE, OWNER_ONLY_SECRETS_MESSAGE, isAdminRole, isOwnerRole } from "@/lib/permissions";

type UserClient = Awaited<ReturnType<typeof createClient>>;

export interface ApiContext {
  supabase: UserClient;
  user: User;
  workspaceId: string;
  role: string;
}

export type ApiGuard = { ok: true; ctx: ApiContext } | { ok: false; response: NextResponse };

export const UNAUTHORIZED_MESSAGE = "No autorizado";
export const NO_WORKSPACE_MESSAGE = "No hay un espacio de trabajo";
export const WORKSPACE_CHANGED_MESSAGE =
  "El espacio de trabajo cambió. Recarga la página e inténtalo de nuevo.";

function fail(status: number, error: string): ApiGuard {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/** Usuario y membresía del espacio activo, con el mismo criterio que getWorkspace(). */
async function resolve(): Promise<ApiGuard> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, UNAUTHORIZED_MESSAGE);

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;

  if (selectedId) {
    const { data } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("workspace_id", selectedId)
      .maybeSingle();
    if (data) {
      return { ok: true, ctx: { supabase, user, workspaceId: data.workspace_id, role: data.role } };
    }
  }

  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return fail(404, NO_WORKSPACE_MESSAGE);

  return { ok: true, ctx: { supabase, user, workspaceId: data.workspace_id, role: data.role } };
}

/** Cualquier miembro del espacio activo. */
export async function requireApiMember(): Promise<ApiGuard> {
  return resolve();
}

/** Dueño o Administrador del espacio activo. */
export async function requireApiAdmin(): Promise<ApiGuard> {
  const guard = await resolve();
  if (!guard.ok) return guard;
  if (!isAdminRole(guard.ctx.role)) return fail(403, ADMIN_ONLY_MESSAGE);
  return guard;
}

/** Solo el Dueño del espacio activo (claves de API). */
export async function requireApiOwner(message: string = OWNER_ONLY_SECRETS_MESSAGE): Promise<ApiGuard> {
  const guard = await resolve();
  if (!guard.ok) return guard;
  if (!isOwnerRole(guard.ctx.role)) return fail(403, message);
  return guard;
}
