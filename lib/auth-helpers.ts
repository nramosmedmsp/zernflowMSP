// Lógica pura de autenticación e invitaciones (sin dependencias de servidor),
// para poder probarla con vitest y reutilizarla en cliente y servidor.

export const DEFAULT_AFTER_LOGIN = "/dashboard";
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Devuelve `raw` solo si es una ruta interna segura ("/algo"); si no, `fallback`.
 * Rechaza URLs absolutas, rutas protocol-relative ("//evil.com"), barras
 * invertidas ("/\evil.com", que algunos navegadores tratan como "//") y
 * caracteres de control.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_AFTER_LOGIN,
): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}

/** Valida la contraseña nueva y su confirmación. Devuelve el error en español o null. */
export function validateNewPassword(password: string, confirmation: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password !== confirmation) {
    return "Las contraseñas no coinciden.";
  }
  return null;
}

export const SIGNUP_REQUIRES_INVITE_MESSAGE =
  "El registro es solo por invitación. Pide a un administrador que te comparta tu enlace.";

/**
 * Supabase no reenvía el texto de la excepción del trigger `handle_new_user`:
 * suele llegar como "Database error saving new user". Tratamos ambos casos.
 */
export function isSignupRequiresInviteError(message: string | null | undefined): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  return (
    text.includes("signup_requires_invite") ||
    text.includes("database error saving new user") ||
    text.includes("database error creating new user")
  );
}

export interface InviteLike {
  status: string;
  expires_at: string | null;
}

/** Una invitación sirve si sigue pendiente y no ha vencido. */
export function isInviteUsable(invite: InviteLike, now: Date = new Date()): boolean {
  if (invite.status !== "pending") return false;
  if (!invite.expires_at) return false;
  const expires = new Date(invite.expires_at);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() > now.getTime();
}

/** Compara correos sin distinguir mayúsculas ni espacios alrededor. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export const ROLE_LABELS: Record<string, string> = {
  owner: "Dueño",
  admin: "Administrador",
  member: "Miembro",
};

/** Nombre del rol para mostrar; en la base siguen siendo 'owner', 'admin', 'member'. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return ROLE_LABELS.member;
  return ROLE_LABELS[role] ?? role;
}

/** Enlace público de una invitación. */
export function inviteUrl(origin: string, inviteId: string): string {
  return `${origin.replace(/\/+$/, "")}/invite/${inviteId}`;
}
