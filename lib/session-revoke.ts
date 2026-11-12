// Cerrar las sesiones abiertas de una persona (SEG-09).
//
// Con @supabase/supabase-js 2.95.3 (@supabase/auth-js 2.95.3) la API de
// administración NO puede cerrar las sesiones de un usuario por su id:
// `auth.admin.signOut(jwt, scope)` exige el JWT de esa persona. Por eso la
// migración 00043 trae la función `revoke_user_sessions(user_id)`, que borra sus
// filas de auth.sessions (y los tokens de refresco). Efecto:
//   * el token de renovación deja de servir al instante: la persona no puede
//     obtener un token de acceso nuevo;
//   * el token de acceso que ya tenía sigue siendo válido hasta su vencimiento
//     (1 hora por defecto en Supabase; es el "JWT expiry" del panel de Auth),
//     porque la app lo verifica en local (getClaims) sin preguntar a Auth.
// Mientras tanto la frena la membresía: getWorkspace() y requireApi*() leen
// workspace_members en CADA petición (sin membresía: /sin-espacio o 404), la
// RLS usa la membresía actual y el rol se vuelve a leer siempre, así que quitar
// o bajar de rol surte efecto al instante aunque el token siga vivo.

export interface SessionRevokeClient {
  rpc: unknown;
}

type RpcFn = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * Cierra todas las sesiones de `userId`. Nunca lanza: devuelve false si no pudo
 * (por ejemplo, migración sin aplicar) y deja el motivo en el log. Quien llama
 * decide si avisa; la operación principal (quitar, cambiar correo o rol) ya se hizo.
 */
export async function revokeUserSessions(client: SessionRevokeClient, userId: string): Promise<boolean> {
  try {
    const { error } = await (client.rpc as RpcFn).call(client, "revoke_user_sessions", { p_user_id: userId });
    if (error) {
      console.error("[session-revoke] no se pudieron cerrar las sesiones:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[session-revoke] no se pudieron cerrar las sesiones:", err);
    return false;
  }
}

const ROLE_ORDER = ["member", "admin", "owner"] as const;

/** ¿El rol nuevo tiene menos poder que el anterior? (Dueño > Administrador > Miembro). */
export function isRoleDowngrade(from: string, to: string): boolean {
  const a = ROLE_ORDER.indexOf(from as (typeof ROLE_ORDER)[number]);
  const b = ROLE_ORDER.indexOf(to as (typeof ROLE_ORDER)[number]);
  return a >= 0 && b >= 0 && b < a;
}
