import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { effectiveUserFor, getRealSession, getViewAsState } from "@/lib/view-as/state";
import { IdentityReadError, readOnceMore } from "@/lib/identity-read";
import type { Database, MemberAvailability, WorkspaceRole } from "@/lib/types/database";

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
 *
 * Devuelve la identidad EFECTIVA: con una vista de "Ver como" activa, `user`,
 * `role`, `availability` y `workspace` son los de la persona (o rol de ejemplo)
 * que se está viendo, y `viewAs` lleva el detalle; `realUser` es siempre quien
 * inició sesión. Sin vista, es exactamente la identidad de siempre.
 */
export const getWorkspace = cache(async () => {
  const supabase = await createClient();
  const real = await getRealSession();

  if (!real) redirect("/login");

  const viewAs = await getViewAsState();
  const user: SessionUser = effectiveUserFor(real.user, viewAs);
  const info = viewAs.active ? viewAs.info : null;

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;

  type Membership = {
    workspace_id: string;
    role: string;
    availability: string;
    workspaces: Database["public"]["Tables"]["workspaces"]["Row"] | null;
  };
  let memberships: Membership[] | null;
  if (info && info.kind === "role") {
    // Identidad de ejemplo: no tiene filas en workspace_members. El espacio y el
    // rol vienen de la vista; el espacio se lee con la identidad efectiva (RLS).
    const { data: ws, error: wsError } = await readOnceMore(() =>
      supabase.from("workspaces").select("*").eq("id", info.workspaceId).maybeSingle(),
    );
    // CONF-02: un fallo de lectura NO es "sin espacio": se propaga a la pantalla de error.
    if (wsError) throw new IdentityReadError("workspaces", wsError);
    memberships = ws
      ? [{ workspace_id: info.workspaceId, role: info.roleWs ?? "member", availability: "available", workspaces: ws }]
      : [];
  } else {
    const query = supabase
      .from("workspace_members")
      .select("workspace_id, role, availability, workspaces(*)")
      .eq("user_id", user.id);
    // En vista el espacio queda fijado al de la vista.
    const { data, error } = await readOnceMore(async () => await (info ? query.eq("workspace_id", info.workspaceId) : query));
    // CONF-02: si la consulta falló (parpadeo de la base) no sabemos si tiene espacio:
    // se lanza para que salga la pantalla de error con "Reintentar", nunca "/sin-espacio".
    if (error) throw new IdentityReadError("workspace_members", error);
    memberships = data as Membership[] | null;
  }

  const usable = (memberships ?? []).filter((m) => m.workspaces);
  const membership = usable.find((m) => m.workspace_id === selectedId) ?? usable[0];

  // Lectura buena pero vacía: sesión válida sin membresía (/login devolvería al dashboard: bucle).
  if (!membership?.workspaces) redirect("/sin-espacio");

  return {
    user,
    workspace: withoutLegacySecrets(membership.workspaces),
    role: membership.role as WorkspaceRole,
    availability: membership.availability as MemberAvailability,
    /** Espacios de la persona (solo id, nombre y slug; nada de secretos). */
    workspaces: usable.map((m) => {
      const w = m.workspaces as unknown as { id: string; name: string; slug: string };
      return { id: w.id, name: w.name, slug: w.slug, role: m.role };
    }),
    supabase,
    /** Persona que inició sesión (el Dueño, también durante una vista). */
    realUser: real.user,
    /** Estado de "Ver como": `active` con la vista vigente; `ended` si hay candado pero la base ya la cerró. */
    viewAs,
  };
});
