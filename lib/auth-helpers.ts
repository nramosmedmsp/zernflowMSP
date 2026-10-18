// Lógica pura de autenticación e invitaciones (sin dependencias de servidor),
// para poder probarla con vitest y reutilizarla en cliente y servidor.

export const DEFAULT_AFTER_LOGIN = "/dashboard";
export const MIN_PASSWORD_LENGTH = 8;
/** Página donde se crea o cambia la contraseña tras abrir un enlace de acceso. */
export const SET_PASSWORD_PATH = "/cuenta/contrasena";

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

/** Tipos de enlace que acepta /auth/confirm (los de verifyOtp con token_hash). */
export const EMAIL_OTP_TYPES = [
  "invite",
  "recovery",
  "magiclink",
  "email",
  "signup",
  "email_change",
] as const;

export type EmailOtpTypeName = (typeof EMAIL_OTP_TYPES)[number];

/** Devuelve el tipo si es uno de los permitidos; si no, null. */
export function parseEmailOtpType(raw: string | null | undefined): EmailOtpTypeName | null {
  if (typeof raw !== "string") return null;
  return (EMAIL_OTP_TYPES as readonly string[]).includes(raw) ? (raw as EmailOtpTypeName) : null;
}

/**
 * Destino tras confirmar un enlace: `next` si es una ruta interna segura; si no,
 * la página de contraseña para invitaciones y recuperaciones, y el panel para el resto.
 */
export function confirmNextPath(
  type: EmailOtpTypeName | null,
  rawNext: string | null | undefined,
): string {
  const fallback = type === "invite" || type === "recovery" ? SET_PASSWORD_PATH : DEFAULT_AFTER_LOGIN;
  return safeNextPath(rawNext, fallback);
}

export const INVALID_LINK_MESSAGE = "El enlace venció o ya se usó. Pide uno nuevo.";

/** Traduce los errores de `updateUser({ password })`. */
export function translatePasswordUpdateError(message: string | null | undefined): string {
  const text = (message ?? "").toLowerCase();
  if (text.includes("different from the old password") || text.includes("same_password")) {
    return "La contraseña nueva debe ser distinta de la actual.";
  }
  if (text.includes("auth session missing") || text.includes("session")) {
    return "Tu sesión venció. Pide un enlace nuevo e inténtalo otra vez.";
  }
  if (text.includes("reauthentication")) {
    return "Por seguridad, pide un enlace nuevo desde ¿Olvidaste tu contraseña? y vuelve a intentarlo.";
  }
  if (text.includes("weak") || text.includes("password should")) {
    return "La contraseña es muy débil. Usa una más larga y combina letras y números.";
  }
  if (text.includes("rate limit") || text.includes("security purposes")) {
    return "Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
  }
  return "No se pudo guardar la contraseña. Inténtalo de nuevo.";
}
