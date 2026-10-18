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
