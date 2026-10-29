// Reparto de gestiones (docs/FASE-1-TECNICO.md 3.3), sin E/S.
//
// 1. Equipo de destino según el tipo de gestión.
// 2. Responsable fijo (routing = contact_owner): el responsable del contacto,
//    si es elegible y está disponible.
// 3. Elegibles: miembros del equipo que atienden el tipo; sin equipos, los
//    miembros del espacio con rol 'member'. Solo disponibles.
// 4. Modo: round_robin, least_load o manual (no asigna).
//
// La elección final la hace la función `assign_case_pick` de la migración
// 00020 bajo un bloqueo; `pickAssignee` replica su orden para las pruebas.

import type {
  AssignmentMode,
  CaseRouting,
  MemberAvailability,
  TeamRole,
  WorkspaceRole,
} from "@/lib/types/database";

export const ASSIGNMENT_MODES: readonly AssignmentMode[] = ["round_robin", "least_load", "manual"];
export const DEFAULT_ASSIGNMENT_MODE: AssignmentMode = "round_robin";

export function normalizeAssignmentMode(raw: unknown): AssignmentMode {
  return typeof raw === "string" && (ASSIGNMENT_MODES as readonly string[]).includes(raw)
    ? (raw as AssignmentMode)
    : DEFAULT_ASSIGNMENT_MODE;
}

/** Lee `assignment_mode` de `workspaces.settings` (para espacios sin equipos). */
export function assignmentModeFromSettings(settings: unknown): AssignmentMode {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return DEFAULT_ASSIGNMENT_MODE;
  }
  return normalizeAssignmentMode((settings as Record<string, unknown>).assignment_mode);
}

export interface RoutingTeam {
  id: string;
  isDefault: boolean;
  assignmentMode: AssignmentMode;
  /**
   * R2-17: "El supervisor no recibe chats". Si es true, los supervisores del
   * equipo quedan fuera del reparto automático (la asignación a mano sigue
   * permitida). Por defecto false: los supervisores entran en el reparto.
   */
  supervisorsSkipChats?: boolean;
}

export interface RoutingTeamMember {
  teamId: string;
  userId: string;
  role: TeamRole;
  /** null = atiende todos los tipos */
  caseTypeIds: string[] | null;
}

export interface RoutingMember {
  userId: string;
  role: WorkspaceRole;
  availability: MemberAvailability;
  lastAssignedAt: string | null;
}

export interface RoutingInput {
  /** null = gestión sin clasificar (se reparte como contact_owner). */
  caseTypeId: string | null;
  routing: CaseRouting;
  fixedTeamId: string | null;
  /** cases.team_id actual: si apunta a un equipo activo se respeta (transferencias). */
  currentTeamId: string | null;
  contactOwnerId: string | null;
  contactTeamId: string | null;
  /** Equipos activos (no archivados) del espacio. */
  teams: readonly RoutingTeam[];
  /** Miembros de los equipos activos. */
  teamMembers: readonly RoutingTeamMember[];
  /** Miembros del espacio. */
  members: readonly RoutingMember[];
  /** workspaces.settings.assignment_mode (solo sin equipo de destino). */
  workspaceMode: AssignmentMode;
  /**
   * Personas que no pueden recibir la gestión (fase 2: la reasignación por
   * espera excluye a la anterior). Tampoco valen como responsable fijo.
   */
  excludeUserIds?: readonly string[];
}

export type AssignmentDecision =
  /** Paso 2: el responsable del contacto. */
  | { kind: "owner"; teamId: string | null; userId: string }
  /** Paso 4: elegir entre `candidates` (ordenados como lo haría la base). */
  | {
      kind: "pick";
      teamId: string | null;
      mode: Exclude<AssignmentMode, "manual">;
      candidates: string[];
    }
  /** Modo manual: queda sin asignar hasta que un supervisor o administrador asigne. */
  | { kind: "manual"; teamId: string | null }
  /** Nadie elegible y disponible. */
  | { kind: "none"; teamId: string | null };

/** Paso 1: equipo de destino de la gestión, o null. */
export function resolveTargetTeamId(input: RoutingInput): string | null {
  const active = new Set(input.teams.map((t) => t.id));
  if (input.currentTeamId && active.has(input.currentTeamId)) return input.currentTeamId;
  if (input.teams.length === 0) return null;

  if (input.caseTypeId && input.routing === "fixed_team" && input.fixedTeamId && active.has(input.fixedTeamId)) {
    return input.fixedTeamId;
  }
  if (input.contactTeamId && active.has(input.contactTeamId)) return input.contactTeamId;
  return input.teams.find((t) => t.isDefault)?.id ?? null;
}

function servesType(member: RoutingTeamMember, caseTypeId: string | null): boolean {
  // Una gestión sin clasificar la puede atender cualquiera del equipo.
  if (caseTypeId === null || member.caseTypeIds === null) return true;
  return member.caseTypeIds.includes(caseTypeId);
}

/**
 * Paso 3: miembros elegibles para el equipo de destino (sin filtrar por
 * disponibilidad). Con equipo: sus miembros que atienden el tipo. Sin equipos
 * en el espacio: los miembros con rol 'member'. Con equipos pero sin destino:
 * nadie (los contactos sin sede solo los ven los administradores).
 */
export function eligibleMembers(input: RoutingInput, teamId: string | null): RoutingMember[] {
  const byUser = new Map(input.members.map((m) => [m.userId, m]));
  if (teamId) {
    const skipSupervisors = input.teams.find((t) => t.id === teamId)?.supervisorsSkipChats === true;
    const seen = new Set<string>();
    const result: RoutingMember[] = [];
    for (const tm of input.teamMembers) {
      if (tm.teamId !== teamId || !servesType(tm, input.caseTypeId) || seen.has(tm.userId)) continue;
      if (skipSupervisors && tm.role === "supervisor") continue;
      const member = byUser.get(tm.userId);
      if (!member) continue; // ya no es miembro del espacio
      seen.add(tm.userId);
      result.push(member);
    }
    return result;
  }
  if (input.teams.length > 0) return [];
  return input.members.filter((m) => m.role === "member");
}

/** ¿El responsable del contacto puede recibir la gestión? */
function ownerEligible(input: RoutingInput, teamId: string | null): boolean {
  const ownerId = input.contactOwnerId;
  if (!ownerId) return false;
  if (input.excludeUserIds?.includes(ownerId)) return false;
  if (input.caseTypeId !== null && input.routing !== "contact_owner") return false;
  const member = input.members.find((m) => m.userId === ownerId);
  if (!member || member.availability !== "available") return false;
  if (teamId) return eligibleMembers(input, teamId).some((m) => m.userId === ownerId);
  // Sin equipo de destino: basta con que siga en el espacio.
  return true;
}

export function decideAssignment(input: RoutingInput): AssignmentDecision {
  const teamId = resolveTargetTeamId(input);

  if (ownerEligible(input, teamId)) {
    return { kind: "owner", teamId, userId: input.contactOwnerId as string };
  }

  const team = teamId ? input.teams.find((t) => t.id === teamId) : undefined;
  const mode = team ? team.assignmentMode : input.workspaceMode;
  if (mode === "manual") return { kind: "manual", teamId };

  const excluded = new Set(input.excludeUserIds ?? []);
  const available = eligibleMembers(input, teamId).filter(
    (m) => m.availability === "available" && !excluded.has(m.userId),
  );
  if (available.length === 0) return { kind: "none", teamId };

  return {
    kind: "pick",
    teamId,
    mode,
    candidates: sortCandidates(
      available.map((m) => ({ userId: m.userId, lastAssignedAt: m.lastAssignedAt, openCount: 0 })),
      mode,
    ).map((c) => c.userId),
  };
}

export interface PickCandidate {
  userId: string;
  lastAssignedAt: string | null;
  /** Gestiones 'open' asignadas (solo cuenta en least_load). */
  openCount: number;
}

function sortCandidates(candidates: readonly PickCandidate[], mode: AssignmentMode): PickCandidate[] {
  const time = (v: string | null) => (v === null ? Number.NEGATIVE_INFINITY : new Date(v).getTime());
  return [...candidates].sort((a, b) => {
    if (mode === "least_load" && a.openCount !== b.openCount) return a.openCount - b.openCount;
    const ta = time(a.lastAssignedAt);
    const tb = time(b.lastAssignedAt);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
}

/**
 * Paso 4 (réplica de `assign_case_pick`): round_robin elige el de
 * last_assigned_at más antiguo (null primero); least_load el de menos
 * gestiones abiertas, desempate por last_assigned_at; luego por user_id.
 * manual no elige.
 */
export function pickAssignee(candidates: readonly PickCandidate[], mode: AssignmentMode): string | null {
  if (mode === "manual" || candidates.length === 0) return null;
  return sortCandidates(candidates, mode)[0].userId;
}
