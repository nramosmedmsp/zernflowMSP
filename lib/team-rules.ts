// Reglas puras del equipo (permisos, validación y textos), sin dependencias de
// servidor, para poder probarlas con vitest y usarlas en cliente y servidor.

import { SET_PASSWORD_PATH, isSignupRequiresInviteError } from "@/lib/auth-helpers";

export type AssignableRole = "member" | "admin";
export const ASSIGNABLE_ROLES: readonly AssignableRole[] = ["member", "admin"];

/** Rol que se puede asignar: además de Miembro y Administrador, "owner" (solo lo da un Dueño). */
export type GrantableRole = AssignableRole | "owner";

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

/** Roles que cualquiera que administre el equipo puede asignar (el de Dueño lo da isGrantableRole). */
export function isAssignableRole(role: unknown): role is AssignableRole {
  return role === "member" || role === "admin";
}

/**
 * ¿Puede `actorRole` dar `role` a otra persona? Miembro y Administrador, los
 * puede dar cualquiera que administre el equipo; Dueño, solo otro Dueño.
 */
export function isGrantableRole(role: unknown, actorRole: string | null | undefined): role is GrantableRole {
  if (isAssignableRole(role)) return true;
  return role === "owner" && actorRole === "owner";
}

/** Solo un Dueño edita a las personas del equipo (nombre, correo y rol). */
export function canEditMembers(role: string | null | undefined): boolean {
  return role === "owner";
}

export const EDIT_MEMBER_DENIED_MESSAGE = "Solo un Dueño puede editar a las personas del equipo.";

export const LAST_OWNER_MESSAGE =
  "Siempre debe quedar al menos un Dueño. Primero nombra a otro Dueño.";

export const SOLE_OWNER_NOTICE =
  "Eres el único Dueño: no puedes dejar de serlo ni ser eliminado. Primero nombra a otro Dueño.";

export const OTHER_WORKSPACE_PROMOTION_MESSAGE =
  "Esa persona también pertenece a otro espacio de trabajo, así que no puede ser Dueño ni Administrador aquí.";

export const OWNER_GRANT_DENIED_MESSAGE = "Solo un Dueño puede nombrar a otro Dueño.";

export const OWNER_PROMOTION_WARNING =
  "será Dueño: podrá ver y cambiar todo, incluidas las claves de conexión, nombrar o quitar otros Dueños y usar «Ver como».";

interface ActorTarget {
  actorId: string;
  actorRole: string | null | undefined;
  targetId: string;
  targetRole?: string | null | undefined;
}

/**
 * ¿Puede `actor` cambiar nombre, correo y rol de `target`? Solo un Dueño. El
 * último Dueño no puede dejar de serlo (`ownerCount` = Dueños que hay hoy en el
 * espacio). Devuelve el motivo en español o null.
 */
export function editMemberError(
  params: ActorTarget & { newRole: string; ownerCount: number },
): string | null {
  if (!canEditMembers(params.actorRole)) return EDIT_MEMBER_DENIED_MESSAGE;
  if (params.newRole !== "owner" && params.newRole !== "admin" && params.newRole !== "member") {
    return "Rol no válido. Elige Miembro, Administrador o Dueño.";
  }
  if (params.targetRole === "owner" && params.newRole !== "owner" && params.ownerCount <= 1) {
    return LAST_OWNER_MESSAGE;
  }
  return null;
}

/**
 * ¿Puede `actor` quitar a `target` del espacio? Devuelve el motivo en español
 * si no puede, o null si sí. Nadie se quita a sí mismo; a un Administrador o a
 * otro Dueño solo lo quita un Dueño (R2-13), y el último Dueño nunca se quita
 * (`ownerCount` = Dueños que hay hoy; si no se pasa, no se aplica esa regla).
 */
export function removeMemberError(params: ActorTarget & { ownerCount?: number }): string | null {
  if (!canManageTeam(params.actorRole)) {
    return "Solo el Dueño o un Administrador pueden quitar miembros.";
  }
  if (params.actorId === params.targetId) {
    return "No puedes quitarte a ti mismo del espacio de trabajo.";
  }
  if (params.targetRole === "owner") {
    if (params.actorRole !== "owner") {
      return "Solo un Dueño puede quitar a otro Dueño del espacio de trabajo.";
    }
    if (params.ownerCount !== undefined && params.ownerCount <= 1) return LAST_OWNER_MESSAGE;
  }
  if (params.targetRole === "admin" && params.actorRole !== "owner") {
    return "Solo el Dueño puede quitar a un Administrador del espacio de trabajo.";
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
  "Por seguridad, el enlace de una cuenta activa solo se envía por correo. Envíale el acceso por correo o pídele que use «¿Olvidaste tu contraseña?».";

export const COPY_PRIVILEGED_LINK_DENIED_MESSAGE =
  "No se puede copiar un enlace de acceso de un Dueño o Administrador. Envíaselo por correo.";

export const CROSS_WORKSPACE_DENIED_MESSAGE =
  "Esta persona también pertenece a otro espacio de trabajo que no administras, así que no puedes enviarle ni copiarle un acceso.";

export const OWNER_ONLY_MAIL_MESSAGE = "Solo el Dueño puede ver y cambiar la configuración de correo.";

export const CREATE_WORKSPACE_DENIED_MESSAGE =
  "Solo el Dueño de un espacio de trabajo puede crear otros espacios.";

export const EXISTING_ACCOUNT_PRIVILEGED_MESSAGE =
  "Esa persona ya tiene una cuenta y es Dueño o Administrador de otro espacio de trabajo, así que no se puede agregar desde aquí.";

export const EXISTING_ACCOUNT_LOOKUP_MESSAGE =
  "Esa persona ya tiene una cuenta, pero no pudimos encontrarla para agregarla. Inténtalo de nuevo.";

/** Solo el Dueño ve y cambia el SMTP de la instalación (los Administradores no). */
export function canManageMailSettings(role: string | null | undefined): boolean {
  return role === "owner";
}

/**
 * ¿Se puede crear un espacio nuevo? Solo quien ya es Dueño de alguno, o
 * cualquiera si todavía no existe ningún espacio (instalación nueva). La base
 * (create_workspace, migración 00030) aplica la misma regla.
 */
export function canCreateWorkspace(params: {
  roles: ReadonlyArray<string | null | undefined>;
  anyWorkspaceExists: boolean;
}): boolean {
  return !params.anyWorkspaceExists || params.roles.some((r) => r === "owner");
}

export interface RoleMembership {
  workspaceId: string;
  role: string | null | undefined;
}

const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, member: 1 };

function rank(role: string | null | undefined): number {
  return (role && ROLE_RANK[role]) || 0;
}

/**
 * Autoridad del actor sobre el objetivo en TODOS los espacios del objetivo:
 * en cada uno el actor debe ser Dueño o Administrador y tener un rol
 * estrictamente superior al del objetivo (nadie supera a un Dueño, salvo un Dueño en el espacio actual). Devuelve el
 * motivo en español o null. Un objetivo sin espacios se rechaza.
 */
export function crossWorkspaceAuthorityError(params: {
  actorMemberships: readonly RoleMembership[];
  targetMemberships: readonly RoleMembership[];
  /**
   * Espacio donde se actúa. Allí un Dueño tiene autoridad sobre cualquier rol,
   * otro Dueño incluido (puede haber varios); en los demás espacios sigue
   * valiendo el rol estrictamente superior.
   */
  currentWorkspaceId?: string;
}): string | null {
  if (params.targetMemberships.length === 0) return CROSS_WORKSPACE_DENIED_MESSAGE;
  const actorRoles = new Map(params.actorMemberships.map((m) => [m.workspaceId, m.role]));
  for (const target of params.targetMemberships) {
    const actorRole = actorRoles.get(target.workspaceId);
    if (!canManageTeam(actorRole)) return CROSS_WORKSPACE_DENIED_MESSAGE;
    if (target.workspaceId === params.currentWorkspaceId && actorRole === "owner") continue;
    if (rank(actorRole) <= rank(target.role)) return CROSS_WORKSPACE_DENIED_MESSAGE;
  }
  return null;
}

interface CopyLinkParams extends ActorTarget {
  /** ¿La cuenta objetivo ya inició sesión alguna vez (estado Activo)? */
  targetActive: boolean;
  /** Roles del objetivo en todos sus espacios (además de targetRole). */
  targetMemberships?: readonly RoleMembership[];
}

/**
 * ¿Puede `actor` copiar un enlace de acceso de `target`? Quien tiene el enlace
 * entra como esa persona, así que solo se permite para cuentas Pendientes de
 * activar (nunca iniciaron sesión) que no sean Dueño ni Administrador en
 * ningún espacio. Para las cuentas activas queda el envío por correo.
 */
export function copyAccessLinkError(params: CopyLinkParams): string | null {
  const base = sendAccessEmailError(params);
  if (base) return base;
  const roles = [params.targetRole, ...(params.targetMemberships ?? []).map((m) => m.role)];
  if (roles.some((r) => canManageTeam(r))) return COPY_PRIVILEGED_LINK_DENIED_MESSAGE;
  if (params.targetActive) return COPY_ACTIVE_LINK_DENIED_MESSAGE;
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

/** ¿Son el mismo correo (sin distinguir mayúsculas ni espacios)? */
export function sameEmailAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Correo en minúsculas y sin espacios, o null si no parece un correo. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

const MIN_FULL_NAME_LENGTH = 2;

/** Nombre sin espacios sobrantes; error en español si falta o es muy largo. */
export function normalizeFullName(
  raw: string | null | undefined,
): { name: string; error: null } | { name: null; error: string } {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) return { name: null, error: "Escribe el nombre de la persona." };
  if (name.length < MIN_FULL_NAME_LENGTH) {
    return { name: null, error: "El nombre es muy corto. Escribe al menos 2 letras." };
  }
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

export interface TeamRoleEntry {
  name: string;
  role: string;
}

/** "Ventas (supervisor) · Atención (asesor)", o "ninguno" si no está en equipos. */
export function teamsSummary(entries: readonly TeamRoleEntry[] | null | undefined): string {
  if (!entries || entries.length === 0) return "ninguno";
  return entries.map((e) => `${e.name} (${e.role === "supervisor" ? "supervisor" : "asesor"})`).join(" · ");
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
