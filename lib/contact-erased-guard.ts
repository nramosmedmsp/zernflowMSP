// Comprobación en el servidor: ¿se puede escribir sobre este contacto?
// (criterio y textos en lib/contact-erased.ts). Una sola consulta por la clave
// primaria; se usa en acciones y rutas que cambian datos de un contacto.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { ERASED_READONLY_MESSAGE, isContactErased } from "@/lib/contact-erased";

type Db = SupabaseClient<Database>;

/** `{ error }` si los datos del contacto se eliminaron; `null` si se puede seguir. */
export async function erasedContactError(
  db: Db,
  workspaceId: string,
  contactId: string | null | undefined,
): Promise<{ error: string } | null> {
  if (!contactId) return null;
  const { data } = await db
    .from("contacts")
    .select("erased_at")
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return isContactErased(data) ? { error: ERASED_READONLY_MESSAGE } : null;
}
