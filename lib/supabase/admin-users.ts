import type { SupabaseClient, User } from "@supabase/supabase-js";
import { sameEmail } from "@/lib/auth-helpers";
import {
  accessLinkUrl,
  translateGenerateLinkError,
  type AccessLinkType,
} from "@/lib/team-rules";

// Operaciones de administración de Auth. Solo con el cliente de servicio.

type AnyClient = { auth: unknown };

function admin(client: AnyClient): SupabaseClient["auth"]["admin"] {
  return (client as unknown as SupabaseClient).auth.admin;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

/**
 * Busca un usuario de Auth por correo. La API de administración no filtra por
 * correo, así que se recorren las páginas (las instalaciones son pequeñas).
 * Conviene llamarla solo después de confirmar con `auth_user_exists`.
 */
export async function findAuthUserByEmail(service: AnyClient, email: string): Promise<User | null> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin(service).listUsers({ page, perPage: PAGE_SIZE });
    if (error) {
      console.error("[admin-users] listUsers", error.message);
      return null;
    }
    const found = data.users.find((u) => sameEmail(u.email, email));
    if (found) return found;
    if (data.users.length < PAGE_SIZE) return null;
  }
  return null;
}

export type AccessLinkResult =
  | { ok: true; url: string; user: User; type: AccessLinkType }
  | { ok: false; error: string };

/**
 * Genera un enlace de activación (invite) o recuperación (recovery) con
 * `auth.admin.generateLink`, sin que Supabase envíe ningún correo. Con type
 * "invite" crea el usuario si no existe (el trigger handle_new_user necesita
 * una invitación pendiente para ese correo). El enlace apunta a
 * /auth/confirm de la app y de ahí a /cuenta/contrasena.
 */
export async function generateAccessLink(
  service: AnyClient,
  params: { email: string; type: AccessLinkType; baseUrl: string; fullName?: string | null },
): Promise<AccessLinkResult> {
  const { data, error } =
    params.type === "invite"
      ? await admin(service).generateLink({
          type: "invite",
          email: params.email,
          options: params.fullName ? { data: { full_name: params.fullName } } : undefined,
        })
      : await admin(service).generateLink({ type: "recovery", email: params.email });

  const hashedToken = data?.properties?.hashed_token;
  if (error || !hashedToken || !data.user) {
    console.error("[admin-users] generateLink", params.type, error?.code, error?.message);
    return { ok: false, error: translateGenerateLinkError(error?.message, error?.code) };
  }

  return {
    ok: true,
    url: accessLinkUrl(params.baseUrl, hashedToken, params.type),
    user: data.user,
    type: params.type,
  };
}
