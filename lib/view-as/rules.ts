// Reglas puras de "Ver como": etiquetas, opciones del selector y secciones del
// registro. Sin dependencias de servidor.

import { memberStatus, type MemberStatus } from "@/lib/team-rules";

export type ViewAsKind = "person" | "role";
export type ViewAsRoleKey = "admin" | "supervisor" | "agent";

/** Lo que el Dueño elige ver. */
export type ViewAsTarget =
  | { kind: "person"; userId: string }
  | { kind: "role"; role: "admin" }
  | { kind: "role"; role: "supervisor" | "agent"; teamId: string };

/** Estado de la vista tal como lo aplicó la base (view_as_current). */
export interface ViewAsInfo {
  sessionId: string;
  workspaceId: string;
  /** Dueño real que mira. */
  viewerId: string;
  kind: ViewAsKind;
  /** Persona real, o id inventado si es por rol. */
  targetUserId: string;
  label: string;
  detail: string | null;
  name: string;
  email: string | null;
  /** Solo por rol. */
  roleWs: "admin" | "member" | null;
  teamId: string | null;
  teamName: string | null;
  teamRole: "supervisor" | "agent" | null;
  startedAt: string;
  expiresAt: string;
}

export const VIEW_AS_ROLE_LABELS: Record<ViewAsRoleKey, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  agent: "Asesor",
};

const WS_ROLE_LABELS: Record<string, string> = { owner: "Dueño", admin: "Administrador", member: "Miembro" };
const TEAM_ROLE_LABELS: Record<string, string> = { supervisor: "Supervisor", agent: "Asesor" };

export function viewAsWorkspaceRoleLabel(role: string): string {
  return WS_ROLE_LABELS[role] ?? role;
}

/** Etiqueta del rol por equipo: "Supervisor de Ventas". */
export function viewAsRoleOptionLabel(role: ViewAsRoleKey, teamName?: string | null): string {
  if (role === "admin") return VIEW_AS_ROLE_LABELS.admin;
  return `${VIEW_AS_ROLE_LABELS[role]} de ${teamName ?? "equipo"}`;
}

export interface ViewAsPersonOption {
  userId: string;
  name: string;
  email: string;
  /** Rol en el espacio: Dueño, Administrador o Miembro. */
  roleLabel: string;
  /** "Supervisor de Ventas", "Asesor de Postventa"... */
  teams: string[];
  /** Invitada que aún no entró (se puede ver igual). */
  status: MemberStatus;
}

export interface ViewAsRoleOption {
  key: string;
  role: ViewAsRoleKey;
  teamId: string | null;
  label: string;
}

export interface ViewAsOptions {
  people: ViewAsPersonOption[];
  roles: ViewAsRoleOption[];
}

interface MemberInput {
  userId: string;
  name: string;
  email: string | null | undefined;
  role: string;
  lastSignInAt?: string | null;
}

/**
 * Opciones del selector. Personas: todas las del espacio menos quien mira (sin
 * excluir a otros Dueños). Roles: Administrador más Supervisor y Asesor de cada
 * equipo activo.
 */
export function buildViewAsOptions(input: {
  viewerId: string;
  members: readonly MemberInput[];
  teams: readonly { id: string; name: string; archivedAt?: string | null }[];
  teamMembers: readonly { teamId: string; userId: string; role: string }[];
}): ViewAsOptions {
  const activeTeams = input.teams.filter((t) => !t.archivedAt);
  const teamName = new Map(activeTeams.map((t) => [t.id, t.name]));

  const people = input.members
    .filter((m) => m.userId !== input.viewerId)
    .map<ViewAsPersonOption>((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email ?? "",
      roleLabel: viewAsWorkspaceRoleLabel(m.role),
      teams: input.teamMembers
        .filter((tm) => tm.userId === m.userId && teamName.has(tm.teamId))
        .map((tm) => `${TEAM_ROLE_LABELS[tm.role] ?? tm.role} de ${teamName.get(tm.teamId)}`)
        .sort((a, b) => a.localeCompare(b, "es")),
      status: memberStatus(m.lastSignInAt),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  const roles: ViewAsRoleOption[] = [
    { key: "admin", role: "admin", teamId: null, label: VIEW_AS_ROLE_LABELS.admin },
  ];
  for (const t of [...activeTeams].sort((a, b) => a.name.localeCompare(b.name, "es"))) {
    for (const role of ["supervisor", "agent"] as const) {
      roles.push({ key: `${role}:${t.id}`, role, teamId: t.id, label: viewAsRoleOptionLabel(role, t.name) });
    }
  }
  return { people, roles };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cuerpo de POST /api/v1/view-as/start → objetivo validado, o un error. */
export function parseViewAsStartBody(body: unknown): { ok: true; target: ViewAsTarget } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "Datos no válidos." };
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad;
  const b = body as Record<string, unknown>;
  if (b.kind === "person") {
    return typeof b.userId === "string" && UUID_RE.test(b.userId)
      ? { ok: true, target: { kind: "person", userId: b.userId.toLowerCase() } }
      : bad;
  }
  if (b.kind === "role") {
    if (b.role === "admin") return { ok: true, target: { kind: "role", role: "admin" } };
    if ((b.role === "supervisor" || b.role === "agent") && typeof b.teamId === "string" && UUID_RE.test(b.teamId)) {
      return { ok: true, target: { kind: "role", role: b.role, teamId: b.teamId.toLowerCase() } };
    }
  }
  return bad;
}

/** Errores estables de view_as_start (mensaje de la base) → texto para la persona. */
export const VIEW_AS_START_ERRORS: Record<string, string> = {
  view_as_not_owner: "Solo el Dueño puede usar «Ver como».",
  view_as_self: "Ya estás en tu propia vista.",
  view_as_target_invalid: "Esa persona no es parte de este espacio.",
  view_as_foreign_workspace: "Esa persona pertenece a otro espacio que no administras: no se puede ver.",
  view_as_team_invalid: "Ese equipo no existe o está archivado.",
  view_as_bad_args: "Datos no válidos.",
};

export function viewAsStartErrorMessage(dbMessage: string | undefined | null): string {
  const key = Object.keys(VIEW_AS_START_ERRORS).find((k) => (dbMessage ?? "").includes(k));
  return key ? VIEW_AS_START_ERRORS[key] : "No se pudo iniciar la vista.";
}

// ── Secciones del registro ("qué abrió") ─────────────────────────────────────

const SECTION_RULES: readonly (readonly [RegExp, string])[] = [
  [/^\/dashboard\/inbox(\/|$)/, "Bandeja"],
  [/^\/dashboard\/cases(\/|$)/, "Gestiones"],
  [/^\/dashboard\/contacts(\/|$)/, "Contactos"],
  [/^\/dashboard\/metrics(\/|$)/, "Métricas"],
  [/^\/dashboard\/analytics(\/|$)/, "Analítica"],
  [/^\/dashboard\/growth(\/|$)/, "Crecimiento"],
  [/^\/dashboard\/broadcasts(\/|$)/, "Difusiones"],
  [/^\/dashboard\/sequences(\/|$)/, "Secuencias"],
  [/^\/dashboard\/flows(\/|$)/, "Flujos"],
  [/^\/dashboard\/channels(\/|$)/, "Canales"],
  [/^\/dashboard\/settings\/replies(\/|$)/, "Respuestas guardadas"],
  [/^\/dashboard\/settings(\/|$)/, "Configuración"],
];

/** Ruta del panel → nombre de sección para el registro, o null si no se registra. Lista fija: nunca se guarda la ruta cruda. */
export function viewAsSectionForPath(path: unknown): string | null {
  if (typeof path !== "string" || path.length > 300) return null;
  const clean = path.split(/[?#]/)[0];
  for (const [re, label] of SECTION_RULES) if (re.test(clean)) return label;
  return null;
}

// ── Estado que devuelve la base (view_as_current / view_as_start) ───────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** jsonb de view_as_current / view_as_start → ViewAsInfo, o null si no es una vista válida. */
export function parseViewAsInfo(raw: unknown): ViewAsInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const sessionId = str(r.session_id);
  const workspaceId = str(r.workspace_id);
  const viewerId = str(r.viewer_id);
  const targetUserId = str(r.target_user_id);
  const label = str(r.label);
  const startedAt = str(r.started_at);
  const expiresAt = str(r.expires_at);
  if (!sessionId || !workspaceId || !viewerId || !targetUserId || !label || !startedAt || !expiresAt) return null;
  if (r.kind !== "person" && r.kind !== "role") return null;
  const roleWs = r.role_ws === "admin" || r.role_ws === "member" ? r.role_ws : null;
  const teamRole = r.team_role === "supervisor" || r.team_role === "agent" ? r.team_role : null;
  return {
    sessionId,
    workspaceId,
    viewerId,
    kind: r.kind,
    targetUserId,
    label,
    detail: str(r.detail),
    name: str(r.name) ?? label,
    email: str(r.email),
    roleWs,
    teamId: str(r.team_id),
    teamName: str(r.team_name),
    teamRole,
    startedAt,
    expiresAt,
  };
}

/**
 * Rol y equipos de una identidad de ejemplo (por rol), que no tiene filas en
 * workspace_members ni team_members. Null para una persona real (sus filas
 * existen y se leen normal).
 */
export function viewAsActorOverride(
  info: Pick<ViewAsInfo, "kind" | "roleWs" | "teamId" | "teamRole"> | null | undefined,
): { role: "admin" | "member"; memberships: { teamId: string; role: "supervisor" | "agent" }[] } | null {
  if (!info || info.kind !== "role" || !info.roleWs) return null;
  return {
    role: info.roleWs,
    memberships: info.teamId && info.teamRole ? [{ teamId: info.teamId, role: info.teamRole }] : [],
  };
}
