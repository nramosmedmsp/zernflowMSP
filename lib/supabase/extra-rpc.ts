import type { SupabaseClient } from "@supabase/supabase-js";

// Funciones agregadas en la migración 00017. `lib/types/database.ts` todavía no
// las declara, así que las llamamos con un tipado propio en lugar de tocar los
// tipos generados. Cuando se regeneren los tipos, esto puede pasar a
// `supabase.rpc(...)` directo.

type AnyClient = { rpc: unknown };

function untyped(client: AnyClient): SupabaseClient {
  return client as unknown as SupabaseClient;
}

/** Crea un espacio de trabajo con el usuario actual como dueño. Devuelve su id. */
export async function rpcCreateWorkspace(
  client: AnyClient,
  name: string,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await untyped(client).rpc("create_workspace", { p_name: name });
  if (error) return { id: null, error: error.message };
  return { id: typeof data === "string" ? data : null, error: null };
}

/** Solo con el cliente de servicio: ¿ya existe una cuenta con este correo? */
export async function rpcAuthUserExists(
  serviceClient: AnyClient,
  email: string,
): Promise<{ exists: boolean; error: string | null }> {
  const { data, error } = await untyped(serviceClient).rpc("auth_user_exists", {
    p_email: email,
  });
  if (error) return { exists: false, error: error.message };
  return { exists: data === true, error: null };
}

/**
 * Lo que la base aplicó a esta petición de "Ver como" (00040). Devuelve el jsonb
 * crudo (null si la petición no está en vista); se interpreta con parseViewAsInfo.
 */
export async function rpcViewAsCurrent(client: AnyClient): Promise<{ data: unknown; error: string | null }> {
  const { data, error } = await untyped(client).rpc("view_as_current");
  if (error) return { data: null, error: error.message };
  return { data: data ?? null, error: null };
}

/** Solo con el cliente de servicio sin candado (lib/view-as/service.ts). */
export async function rpcViewAsStart(
  serviceClient: AnyClient,
  args: {
    viewer: string;
    authSession: string;
    workspace: string;
    kind: "person" | "role";
    targetUser?: string | null;
    role?: string | null;
    team?: string | null;
  },
): Promise<{ data: unknown; error: string | null }> {
  const { data, error } = await untyped(serviceClient).rpc("view_as_start", {
    p_viewer: args.viewer,
    p_auth_session: args.authSession,
    p_workspace: args.workspace,
    p_kind: args.kind,
    p_target_user: args.targetUser ?? null,
    p_role: args.role ?? null,
    p_team: args.team ?? null,
  });
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function rpcViewAsStop(
  serviceClient: AnyClient,
  args: { viewer: string; authSession: string; reason?: "manual" | "revoked" },
): Promise<{ stopped: boolean; error: string | null }> {
  const { data, error } = await untyped(serviceClient).rpc("view_as_stop", {
    p_viewer: args.viewer,
    p_auth_session: args.authSession,
    p_reason: args.reason ?? "manual",
  });
  if (error) return { stopped: false, error: error.message };
  return { stopped: data === true, error: null };
}

/** Devuelve la caducidad si la vista sigue activa, o null. */
export async function rpcViewAsTouch(
  serviceClient: AnyClient,
  args: { viewer: string; authSession: string; section?: string | null },
): Promise<{ expiresAt: string | null; error: string | null }> {
  const { data, error } = await untyped(serviceClient).rpc("view_as_touch", {
    p_viewer: args.viewer,
    p_auth_session: args.authSession,
    p_section: args.section ?? null,
  });
  if (error) return { expiresAt: null, error: error.message };
  return { expiresAt: typeof data === "string" ? data : null, error: null };
}
