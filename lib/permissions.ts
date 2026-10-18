// Reglas puras de permisos de la fase 1 (docs/FASE-1-TECNICO.md 2.1), sin
// dependencias de servidor, para probarlas con vitest y usarlas en la UI y en
// las acciones del servidor.
//
// La fuente de verdad es la base: la función `can_see_contact_row` de la
// migración 00019 y las políticas RLS. `contactVisibilityReason` replica esa
// regla en TypeScript para decidir qué mostrar y para validar en código las
// acciones que usan el cliente de servicio. Si cambias una, cambia la otra
// (supabase/tests/fase1_rls_check.sql y lib/permissions.test.ts usan el mismo
// escenario).

import type {
  AgentVisibility,
  ActiveCaseStatus,
  CaseStatus,
  TeamRole,
  WorkspaceRole,
} from "@/lib/types/database";

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ["owner", "admin", "member"];
export const AGENT_VISIBILITIES: readonly AgentVisibility[] = ["own", "own_and_unassigned", "team"];
export const DEFAULT_AGENT_VISIBILITY: AgentVisibility = "own";
/** Estados de una gestión no cerrada. */
export const ACTIVE_CASE_STATUSES: readonly ActiveCaseStatus[] = ["scheduled", "open"];

export const ADMIN_ONLY_MESSAGE = "Solo el Dueño o un Administrador pueden hacer esto.";
export const OWNER_ONLY_SECRETS_MESSAGE = "Solo el Dueño puede cambiar las claves de API.";

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

/** Dueño o Administrador: todo lo operativo (configuración, flujos, canales, difusiones...). */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function isOwnerRole(role: string | null | undefined): boolean {
  return role === "owner";
}

/**
 * Claves de Zernio y de IA: solo el Dueño (docs/PLAN-CRM.md 4.2, "No toca
 * claves"). El servidor las guarda con el cliente de servicio.
 */
export function canManageSecrets(role: string | null | undefined): boolean {
  return isOwnerRole(role);
}

export function isActiveCaseStatus(status: string | null | undefined): status is ActiveCaseStatus {
  return status === "scheduled" || status === "open";
}

/** Valor válido de visibilidad o el de por defecto ('own'). */
export function normalizeAgentVisibility(raw: unknown): AgentVisibility {
  return typeof raw === "string" && (AGENT_VISIBILITIES as readonly string[]).includes(raw)
    ? (raw as AgentVisibility)
    : DEFAULT_AGENT_VISIBILITY;
}

/** Lee `agent_visibility` de `workspaces.settings` (jsonb). */
export function agentVisibilityFromSettings(settings: unknown): AgentVisibility {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return DEFAULT_AGENT_VISIBILITY;
  }
  return normalizeAgentVisibility((settings as Record<string, unknown>).agent_visibility);
}

export interface TeamMembershipInfo {
  teamId: string;
  role: TeamRole;
  /** Equipos archivados no dan visibilidad (se ignoran). */
  archived?: boolean;
}

export interface CaseVisibilityInfo {
  status: CaseStatus;
  assigneeId: string | null;
  teamId: string | null;
}

export interface ContactVisibilityInput {
  userId: string;
  /** Rol del usuario en el espacio del contacto; null si no es miembro. */
  role: string | null | undefined;
  /** `workspaces.settings.agent_visibility` (se normaliza). */
  agentVisibility: string | null | undefined;
  /** ¿El espacio tiene equipos activos (no archivados)? */
  workspaceHasTeams: boolean;
  /** Equipos del usuario en el espacio del contacto. */
  memberships: readonly TeamMembershipInfo[];
  contact: { ownerId: string | null; teamId: string | null };
  /** Todas las gestiones del contacto (abiertas y cerradas). */
  cases: readonly CaseVisibilityInfo[];
}

/**
 * Por qué el usuario ve el contacto (la primera regla que se cumple), o null:
 * 1. `admin`: Dueño o Administrador del espacio.
 * 2. `assigned`: tiene una gestión no cerrada asignada a él.
 * 3. `owner`: es el responsable del contacto.
 * 4. `supervisor`: supervisa el equipo del contacto o el de una de sus
 *    gestiones no cerradas.
 * 5. según la visibilidad de asesores:
 *    - `own`: nada más;
 *    - `own_and_unassigned` → `unassigned_queue`: gestión abierta sin asignar
 *      de uno de sus equipos (sin equipos en el espacio: cualquiera);
 *    - `team` → `team`: contacto de uno de sus equipos, o con una gestión no
 *      cerrada de uno de sus equipos (sin equipos en el espacio: todos).
 */
export type ContactVisibilityReason =
  | "admin"
  | "assigned"
  | "owner"
  | "supervisor"
  | "unassigned_queue"
  | "team";

export function contactVisibilityReason(
  input: ContactVisibilityInput,
): ContactVisibilityReason | null {
  const { userId, role, contact, cases } = input;
  if (!userId || !isWorkspaceRole(role)) return null;

  // 1
  if (isAdminRole(role)) return "admin";

  // 2
  if (cases.some((c) => c.assigneeId === userId && isActiveCaseStatus(c.status))) {
    return "assigned";
  }

  // 3
  if (contact.ownerId !== null && contact.ownerId === userId) return "owner";

  const activeMemberships = input.memberships.filter((m) => !m.archived);
  const myTeams = new Set(activeMemberships.map((m) => m.teamId));
  const supervisedTeams = new Set(
    activeMemberships.filter((m) => m.role === "supervisor").map((m) => m.teamId),
  );
  const activeCaseTeams = cases
    .filter((c) => isActiveCaseStatus(c.status) && c.teamId !== null)
    .map((c) => c.teamId as string);

  // 4
  if (
    (contact.teamId !== null && supervisedTeams.has(contact.teamId)) ||
    activeCaseTeams.some((t) => supervisedTeams.has(t))
  ) {
    return "supervisor";
  }

  // 5
  const visibility = normalizeAgentVisibility(input.agentVisibility);
  if (visibility === "own") return null;

  if (visibility === "own_and_unassigned") {
    const queue = cases.filter((c) => c.status === "open" && c.assigneeId === null);
    if (!input.workspaceHasTeams) return queue.length > 0 ? "unassigned_queue" : null;
    return queue.some((c) => c.teamId !== null && myTeams.has(c.teamId))
      ? "unassigned_queue"
      : null;
  }

  // team
  if (!input.workspaceHasTeams) return "team";
  if (contact.teamId !== null && myTeams.has(contact.teamId)) return "team";
  if (activeCaseTeams.some((t) => myTeams.has(t))) return "team";
  return null;
}

/** Regla 2.1 en TypeScript: ¿el usuario puede ver el contacto? */
export function canSeeContactRules(input: ContactVisibilityInput): boolean {
  return contactVisibilityReason(input) !== null;
}
