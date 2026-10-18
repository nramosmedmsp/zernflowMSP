import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const WORKSPACE_COOKIE = "zernflow_workspace_id";

/**
 * El espacio llega a componentes de cliente (p. ej. el menú lateral): nunca
 * con secretos. Desde 00019 estas columnas están vacías (los secretos viven en
 * workspace_secrets); esto evita filtrarlos si el código se despliega antes
 * de aplicar la migración.
 */
function withoutLegacySecrets<T extends object>(workspace: T): T {
  return { ...workspace, late_api_key_encrypted: null, ai_api_key: null, webhook_secret: null };
}

/**
 * Cached per-request: deduplicates across layout + page in the same render.
 * Reads workspace ID from cookie if set; falls back to first workspace.
 */
export const getWorkspace = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;

  // Try cookie workspace first
  if (selectedId) {
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, workspaces(*)")
      .eq("user_id", user.id)
      .eq("workspace_id", selectedId)
      .single();

    if (membership?.workspaces) {
      return {
        user,
        workspace: withoutLegacySecrets(membership.workspaces),
        role: membership.role,
        supabase,
      };
    }
  }

  // Fallback to first workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(*)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  // Sesión válida pero sin membresía: /login devolvería al dashboard (bucle).
  if (!membership?.workspaces) redirect("/sin-espacio");

  return {
    user,
    workspace: withoutLegacySecrets(membership.workspaces),
    role: membership.role,
    supabase,
  };
});
