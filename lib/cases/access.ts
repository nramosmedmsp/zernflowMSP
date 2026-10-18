// Permisos de las acciones sobre una gestión (docs/PLAN-CRM.md 4.4), sin E/S.
// Las acciones del servidor (lib/actions/cases.ts) los evalúan antes de usar
// el cliente de servicio. La visibilidad del contacto sale de
// `contactVisibilityReason` (lib/permissions.ts), réplica de la RLS.
//
// | Acción                                   | Admin | Supervisor del equipo | Asesor                          |
// |------------------------------------------|-------|-----------------------|---------------------------------|
// | Etapa, tipo, categoría, próximo contacto, cerrar | Sí | Sí                | Sus gestiones                   |
// | Notas                                    | Sí    | Sí                    | Si ve el contacto               |
// | Asignar o transferir dentro del equipo   | Sí    | Sí                    | No                              |
// | Devolver a la cola                       | Sí    | Sí                    | Las suyas, si la empresa lo permite |
// | Tomar una gestión sin asignar            | Sí    | Sí                    | Con visibilidad "own_and_unassigned" o "team" |
// | Cambiar de equipo                        | Sí    | No                    | No                              |

import { isAdminRole, isActiveCaseStatus, normalizeAgentVisibility } from "@/lib/permissions";
import type { AgentVisibility, CaseStatus, TeamRole } from "@/lib/types/database";

export const CASE_NOT_FOUND = "No se encontró la gestión.";
export const CASE_NOT_ALLOWED = "No tienes permiso para hacer esto en esta gestión.";

export interface ActorInfo {
  userId: string;
  role: string | null | undefined;
  /** Equipos activos del usuario en el espacio. */
  memberships: readonly { teamId: string; role: TeamRole }[];
  agentVisibility: AgentVisibility | string | null | undefined;
  /** workspaces.settings.agent_can_return_to_queue */
  agentCanReturnToQueue: boolean;
  workspaceHasTeams: boolean;
}

export interface CaseAccessInfo {
  status: CaseStatus;
  assigneeId: string | null;
  teamId: string | null;
  contactTeamId: string | null;
  /** ¿El usuario ve el contacto? (contactVisibilityReason !== null) */
  canSeeContact: boolean;
}

export interface CasePermissions {
  canView: boolean;
  /** Clasificar, cambiar etapa o categoría, próximo contacto. */
  canEdit: boolean;
  canClose: boolean;
  canNote: boolean;
  /** Asignar a otra persona. */
  canAssign: boolean;
  canReturnToQueue: boolean;
  canTake: boolean;
  /** Cambiar el equipo de la gestión. */
  canTransfer: boolean;
}

const NONE: CasePermissions = {
  canView: false,
  canEdit: false,
  canClose: false,
  canNote: false,
  canAssign: false,
  canReturnToQueue: false,
  canTake: false,
  canTransfer: false,
};

export function supervisedTeamIds(actor: ActorInfo): Set<string> {
  return new Set(actor.memberships.filter((m) => m.role === "supervisor").map((m) => m.teamId));
}

/** ¿Supervisa el equipo de la gestión o el del contacto? */
export function supervisesCase(actor: ActorInfo, info: Pick<CaseAccessInfo, "teamId" | "contactTeamId">): boolean {
  const supervised = supervisedTeamIds(actor);
  return (
    (info.teamId !== null && supervised.has(info.teamId)) ||
    (info.contactTeamId !== null && supervised.has(info.contactTeamId))
  );
}

export function casePermissions(actor: ActorInfo, info: CaseAccessInfo): CasePermissions {
  if (!info.canSeeContact) return NONE;
  const active = isActiveCaseStatus(info.status);

  if (isAdminRole(actor.role)) {
    return {
      canView: true,
      canEdit: active,
      canClose: info.status === "open",
      canNote: true,
      canAssign: active,
      canReturnToQueue: active && info.assigneeId !== null,
      canTake: active && info.assigneeId !== actor.userId,
      canTransfer: active,
    };
  }

  const supervises = supervisesCase(actor, info);
  const mine = info.assigneeId !== null && info.assigneeId === actor.userId;
  const canEdit = active && (supervises || mine);

  let canTake = false;
  if (active && info.assigneeId === null) {
    if (supervises) {
      canTake = true;
    } else {
      const visibility = normalizeAgentVisibility(actor.agentVisibility);
      const myTeams = new Set(actor.memberships.map((m) => m.teamId));
      const inMyTeam = !actor.workspaceHasTeams || (info.teamId !== null && myTeams.has(info.teamId));
      canTake = visibility !== "own" && inMyTeam;
    }
  }

  return {
    canView: true,
    canEdit,
    canClose: canEdit && info.status === "open",
    canNote: true,
    canAssign: active && supervises,
    canReturnToQueue:
      active && info.assigneeId !== null && (supervises || (mine && actor.agentCanReturnToQueue)),
    canTake,
    canTransfer: false,
  };
}

/**
 * ¿Puede asignar la gestión a `targetUserId`? Administrador: a cualquier
 * miembro del espacio. Supervisor: a miembros de un equipo que supervisa y
 * que sea el de la gestión (o el del contacto si la gestión no tiene equipo).
 * Cualquiera con `canTake`: a sí mismo.
 */
export function canAssignTo(
  actor: ActorInfo,
  info: CaseAccessInfo,
  target: { userId: string; isWorkspaceMember: boolean; teamIds: readonly string[] },
): boolean {
  if (!target.isWorkspaceMember) return false;
  const perms = casePermissions(actor, info);
  if (target.userId === actor.userId && perms.canTake) return true;
  if (!perms.canAssign) return false;
  if (isAdminRole(actor.role)) return true;

  const supervised = supervisedTeamIds(actor);
  const scopeTeam = info.teamId ?? info.contactTeamId;
  if (!scopeTeam || !supervised.has(scopeTeam)) return false;
  return target.teamIds.includes(scopeTeam);
}
