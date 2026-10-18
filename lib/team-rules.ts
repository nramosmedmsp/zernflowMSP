// Reglas puras del equipo (permisos, validación y textos), sin dependencias de
// servidor, para poder probarlas con vitest y usarlas en cliente y servidor.

import { SET_PASSWORD_PATH, isSignupRequiresInviteError } from "@/lib/auth-helpers";

export type AssignableRole = "member" | "admin";
export const ASSIGNABLE_ROLES: readonly AssignableRole[] = ["member", "admin"];

export type MemberStatus = "active" | "pending";

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Activo",
  pending: "Pendiente de activar",
};

export const MAX_FULL_NAME_LENGTH = 100;

/** Dueño y Administradores pueden crear usuarios, enviar accesos y quitar miembros. */
export function canManageTeam(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Roles que se pueden asignar al crear un usuario (nunca "owner"). */
export function isAssignableRole(role: unknown): role is AssignableRole {
  return role === "member" || role === "admin";
}

interface ActorTarget {
  actorId: string;
  actorRole: string | null | undefined;
  targetId: string;
  targetRole?: string | null | undefined;
}

/**
 * ¿Puede `actor` quitar a `target` del espacio? Devuelve el motivo en español
 * si no puede, o null si sí. Nadie puede quitar al Dueño ni quitarse a sí mismo.
 */
export function removeMemberError(params: ActorTarget): string | null {
  if (!canManageTeam(params.actorRole)) {
    return "Solo el Dueño o un Administrador pueden quitar miembros.";
  }
  if (params.actorId === params.targetId) {
    return "No puedes quitarte a ti mismo del espacio de trabajo.";
  }
  if (params.targetRole === "owner") {
    return "No se puede quitar al Dueño del espacio de trabajo.";
  }
  return null;
}

/**
 * ¿Puede `actor` enviar a `target` un correo de activación o recuperación?
 * El correo llega al buzón de la otra persona, así que basta con administrar
 * el equipo y no ser uno mismo (para eso está /cuenta/contrasena).
 */
export function sendAccessEmailError(params: ActorTarget): string | null {
  if (!canManageTeam(params.actorRole)) {
    return "Solo el Dueño o un Administrador pueden enviar enlaces de acceso.";
  }
  if (params.actorId === params.targetId) {
    return "Para cambiar tu contraseña usa la opción Cambiar contraseña del menú.";
  }
  return null;
}

export const COPY_ACTIVE_LINK_DENIED_MESSAGE =
  "Por seguridad, el enlace de una cuenta activa solo se envía por correo. Configura el correo en Configuración → Correo o pide al Dueño que lo genere.";

interface CopyLinkParams extends ActorTarget {
  /** ¿La cuenta objetivo ya inició sesión alguna vez (estado Activo)? */
  targetActive: boolean;
}

/**
 * ¿Puede `actor` copiar un enlace de acceso de `target`? Quien tiene el enlace
 * entra como esa persona, así que:
 * - nunca se permite para el Dueño ni para uno mismo;
 * - si la cuenta aún está Pendiente de activar, lo pueden copiar el Dueño y los
 *   Administradores;
 * - si la cuenta ya está Activa, solo el Dueño (un Administrador podría
 *   suplantar a otro miembro). Para ellos queda el envío por correo.
 */
export function copyAccessLinkError(params: CopyLinkParams): string | null {
  const base = sendAccessEmailError(params);
  if (base) return base;
  if (params.targetRole === "owner") {
    return "No se puede copiar un enlace de acceso del Dueño. Envíaselo por correo.";
  }
  if (params.targetActive && params.actorRole !== "owner") {
    return COPY_ACTIVE_LINK_DENIED_MESSAGE;
  }
  return null;
}

/** Quien nunca inició sesión no ha abierto su invitación todavía. */
export function memberStatus(lastSignInAt: string | null | undefined): MemberStatus {
  return lastSignInAt ? "active" : "pending";
}

export type AccessLinkType = "invite" | "recovery";

/** Invitación para quien nunca confirmó su correo; recuperación para el resto. */
export function accessLinkTypeFor(emailConfirmed: boolean): AccessLinkType {
  // Supabase no genera enlaces de invitación para un correo ya confirmado
  // (responde email_exists), así que en ese caso se usa recuperación.
  return emailConfirmed ? "recovery" : "invite";
}

/**
 * Enlace propio de activación o recuperación: lleva a /auth/confirm con el
 * `hashed_token` que devuelve `auth.admin.generateLink`, y de ahí a
 * /cuenta/contrasena.
 */
export function accessLinkUrl(baseUrl: string, hashedToken: string, type: AccessLinkType): string {
  const params = new URLSearchParams({ token_hash: hashedToken, type, next: SET_PASSWORD_PATH });
  return `${baseUrl.replace(/\/+$/, "")}/auth/confirm?${params.toString()}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Correo en minúsculas y sin espacios, o null si no parece un correo. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Nombre sin espacios sobrantes; error en español si falta o es muy largo. */
export function normalizeFullName(
  raw: string | null | undefined,
): { name: string; error: null } | { name: null; error: string } {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) return { name: null, error: "Escribe el nombre de la persona." };
  if (name.length > MAX_FULL_NAME_LENGTH) {
    return {
      name: null,
      error: `El nombre no puede tener más de ${MAX_FULL_NAME_LENGTH} caracteres.`,
    };
  }
  return { name, error: null };
}

/**
 * URL pública de la app (NEXT_PUBLIC_APP_URL) sin barra final, o null si falta
 * o no es una URL http(s).
 */
export function appBaseUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return value;
  } catch {
    return null;
  }
}

export const APP_URL_MISSING_MESSAGE =
  "Falta configurar NEXT_PUBLIC_APP_URL con la dirección pública de la app.";

export const MAIL_NOT_CONFIGURED_MESSAGE =
  "El correo aún no está configurado. Configúralo en Configuración → Correo y luego usa Reenviar invitación.";

export const COPY_LINK_WARNING =
  "Compártelo solo por un canal privado; quien lo abra podrá activar la cuenta. Vence en 24 horas.";

/** Traduce los errores de `auth.admin.generateLink` al crear o reenviar un acceso. */
export function translateGenerateLinkError(
  message: string | null | undefined,
  code?: string | null,
): string {
  const text = (message ?? "").toLowerCase();
  const errCode = (code ?? "").toLowerCase();

  if (errCode === "email_exists" || text.includes("already been registered")) {
    return "Ya existe una cuenta con este correo.";
  }
  if (errCode === "user_not_found" || text.includes("user not found")) {
    return "No encontramos la cuenta de esta persona.";
  }
  if (errCode === "validation_failed" || text.includes("unable to validate email")) {
    return "El correo no es válido.";
  }
  if (isSignupRequiresInviteError(text)) {
    return "La base rechazó el alta de este usuario. Revisa que la migración 00017 esté aplicada e inténtalo de nuevo.";
  }
  if (text.includes("rate limit")) {
    return "Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
  }
  return "No se pudo generar el enlace de acceso. Inténtalo de nuevo en unos minutos.";
}

/** Datos mínimos de un usuario de Auth para armar la fila de la lista. */
export interface AuthUserLike {
  id: string;
  email?: string | null;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

export interface TeamMemberView {
  userId: string;
  role: string;
  joinedAt: string;
  email: string;
  name: string;
  status: MemberStatus;
  emailConfirmed: boolean;
}

/** Nombre para mostrar: full_name, name o la parte local del correo. */
export function displayName(user: AuthUserLike | null | undefined): string {
  const meta = user?.user_metadata ?? {};
  const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  const name = typeof meta.name === "string" ? meta.name.trim() : "";
  return fullName || name || user?.email?.split("@")[0] || "Sin nombre";
}

export function memberViewFromUser(
  user: AuthUserLike | null | undefined,
  membership: { userId: string; role: string; joinedAt: string },
): TeamMemberView {
  return {
    userId: membership.userId,
    role: membership.role,
    joinedAt: membership.joinedAt,
    email: user?.email ?? "Sin correo",
    name: displayName(user),
    status: memberStatus(user?.last_sign_in_at),
    emailConfirmed: !!user?.email_confirmed_at,
  };
}
