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
 * Usuario verificado a partir de los claims del JWT (sin viaje al servidor de
 * Auth): solo lo que la app usa. `getClaims` valida la firma contra las llaves
 * públicas (JWKS, en caché) y, si el proyecto usa una llave simétrica, cae a
 * `getUser` por dentro, así que sigue siendo una verificación válida.
 */
export interface SessionUser {
  id: string;
  email: string | undefined;
  user_metadata: Record<string, unknown>;
}

/**
 * Cached per-request: deduplicates across layout + page in the same render.
 * Una sola consulta trae todas las membresías con su espacio; se elige el de
 * la cookie y, si no, el primero.
 */
export const getWorkspace = cache(async () => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (!claims?.sub) redirect("/login");

  const user: SessionUser = {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    user_metadata: (claims.user_metadata as Record<string, unknown> | undefined) ?? {},
  };

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, availability, workspaces(*)")
    .eq("user_id", user.id);

  const usable = (memberships ?? []).filter((m) => m.workspaces);
  const membership = usable.find((m) => m.workspace_id === selectedId) ?? usable[0];

  // Sesión válida pero sin membresía: /login devolvería al dashboard (bucle).
  if (!membership?.workspaces) redirect("/sin-espacio");

  return {
    user,
    workspace: withoutLegacySecrets(membership.workspaces),
    role: membership.role,
    availability: membership.availability,
    /** Espacios de la persona (solo id, nombre y slug; nada de secretos). */
    workspaces: usable.map((m) => {
      const w = m.workspaces as unknown as { id: string; name: string; slug: string };
      return { id: w.id, name: w.name, slug: w.slug, role: m.role };
    }),
    supabase,
  };
});
