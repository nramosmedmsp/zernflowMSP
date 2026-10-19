// Solo servidor: lo que comparten las páginas del laboratorio y de escenarios.

import { createServiceClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/team-rules";

/**
 * Nombres de las personas (la base no los guarda): se leen de Auth con el cliente de servicio.
 * Si falla, el laboratorio usa "Asesor 1"... Los escenarios se refieren a los miembros por nombre,
 * así que las dos pantallas deben leerlos igual.
 */
export async function readMemberNames(workspaceId: string): Promise<Record<string, string>> {
  try {
    const service = await createServiceClient();
    const { data: members } = await service.from("workspace_members").select("user_id").eq("workspace_id", workspaceId);
    const entries = await Promise.all(
      (members ?? []).map(async (m) => {
        const {
          data: { user },
        } = await service.auth.admin.getUserById(m.user_id);
        return [m.user_id, displayName(user)] as const;
      }),
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}
