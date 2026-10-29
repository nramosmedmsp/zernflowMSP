// R2: escritura de `workspaces.settings` sin pisar cambios de otros. Antes cada
// pantalla leía todo el JSON, cambiaba su parte y lo guardaba entero: dos
// administradores guardando secciones distintas a la vez se borraban entre sí.
// Ahora solo se envían las claves que cambiaron y la base las mezcla en una
// sola instrucción (función `merge_workspace_settings`, migración 00034). Si la
// función aún no existe (código desplegado antes que la migración), cae al
// guardado de siempre.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";

type Settings = Record<string, unknown>;

function asObject(value: unknown): Settings {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Settings) : {};
}

/** Claves de primer nivel que cambian (o se quitan) al pasar de `current` a `next`. */
export function diffSettings(current: unknown, next: unknown): { set: Settings; remove: string[] } {
  const before = asObject(current);
  const after = asObject(next);
  const set: Settings = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(value)) set[key] = value;
  }
  const remove = Object.keys(before).filter((key) => !(key in after));
  return { set, remove };
}

/**
 * Guarda `next` en `workspaces.settings` tocando solo lo que cambió respecto de
 * `current`. Devuelve el mensaje de error de la base, o null si salió bien.
 */
export async function mergeWorkspaceSettings(
  db: SupabaseClient<Database>,
  workspaceId: string,
  current: unknown,
  next: unknown,
): Promise<string | null> {
  const { set, remove } = diffSettings(current, next);
  if (Object.keys(set).length === 0 && remove.length === 0) return null;
  const rpc = await (db as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  }).rpc("merge_workspace_settings", { p_workspace_id: workspaceId, p_set: set as Json, p_remove: remove });
  if (!rpc.error) return null;
  // Sin la función (42883 / PGRST202) se guarda el objeto completo como antes.
  const missing = rpc.error.code === "42883" || rpc.error.code === "PGRST202" || /merge_workspace_settings/.test(rpc.error.message);
  if (!missing) return rpc.error.message;
  const { data, error } = await db
    .from("workspaces")
    .update({ settings: asObject(next) as Json })
    .eq("id", workspaceId)
    .select("id");
  if (error) return error.message;
  return (data ?? []).length === 0 ? "sin permiso" : null;
}
