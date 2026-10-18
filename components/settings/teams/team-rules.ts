// Reglas puras de la configuración de equipos (docs/PLAN-CRM.md 4 y 5), sin
// dependencias de servidor, para usarlas en la interfaz y en las acciones de
// lib/actions/teams.ts y probarlas con vitest.

import type { AssignmentMode, TeamRole } from "@/lib/types/database";

export const MAX_TEAM_NAME_LENGTH = 100;

export const TEAMS_HELP_TEXT = "Si no creas equipos, toda la empresa funciona como un solo equipo.";

export const ASSIGNMENT_MODES: readonly AssignmentMode[] = ["round_robin", "least_load", "manual"];
export const TEAM_ROLES: readonly TeamRole[] = ["supervisor", "agent"];

export const ASSIGNMENT_MODE_OPTIONS: readonly {
  value: AssignmentMode;
  label: string;
  description: string;
}[] = [
  {
    value: "round_robin",
    label: "Por turnos",
    description:
      "Cada gestión nueva va a la persona que lleva más tiempo sin recibir una, una a una y en orden.",
  },
  {
    value: "least_load",
    label: "Al de menor carga",
    description: "Cada gestión nueva va a quien tenga menos gestiones abiertas en ese momento.",
  },
  {
    value: "manual",
    label: "Manual",
    description:
      "Las gestiones quedan sin asignar hasta que un supervisor o un administrador las asigne.",
  },
];

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  supervisor: "Supervisor",
  agent: "Asesor",
};

export function isAssignmentMode(value: unknown): value is AssignmentMode {
  return typeof value === "string" && (ASSIGNMENT_MODES as readonly string[]).includes(value);
}

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === "string" && (TEAM_ROLES as readonly string[]).includes(value);
}

export function assignmentModeLabel(mode: AssignmentMode): string {
  return ASSIGNMENT_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode;
}

/** Nombre de equipo válido (recortado) o el motivo del rechazo en español. */
export function normalizeTeamName(raw: unknown): { name: string } | { error: string } {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) return { error: "Escribe un nombre para el equipo." };
  if (name.length > MAX_TEAM_NAME_LENGTH) {
    return { error: `El nombre no puede tener más de ${MAX_TEAM_NAME_LENGTH} caracteres.` };
  }
  return { name };
}

/** ¿Ya existe otro equipo con ese nombre (sin distinguir mayúsculas)? */
export function isDuplicateTeamName(
  name: string,
  teams: readonly { id: string; name: string }[],
  exceptId?: string,
): boolean {
  const wanted = name.trim().toLowerCase();
  return teams.some((t) => t.id !== exceptId && t.name.trim().toLowerCase() === wanted);
}

/**
 * Tipos de gestión que atiende un miembro: `null` = todos; si no, una lista
 * no vacía de tipos activos del espacio (sin repetidos, en el orden recibido).
 */
export function normalizeCaseTypeSelection(
  raw: unknown,
  activeCaseTypeIds: ReadonlySet<string>,
): { value: string[] | null } | { error: string } {
  if (raw === null || raw === undefined) return { value: null };
  if (!Array.isArray(raw)) return { error: "La selección de tipos de gestión no es válida." };
  const ids = [...new Set(raw)];
  if (ids.length === 0) {
    return { error: "Elige al menos un tipo de gestión o marca «Todos los tipos»." };
  }
  if (!ids.every((id): id is string => typeof id === "string" && activeCaseTypeIds.has(id))) {
    return { error: "Alguno de los tipos de gestión elegidos no existe o está archivado." };
  }
  // Si marcó todos los tipos activos, equivale a "todos" (así los tipos nuevos también entran).
  if (activeCaseTypeIds.size > 0 && ids.length === activeCaseTypeIds.size) return { value: null };
  return { value: ids };
}

/** Texto del resumen de tipos que atiende un miembro. */
export function caseTypesSummary(
  caseTypeIds: readonly string[] | null,
  caseTypes: readonly { id: string; name: string }[],
): string {
  if (caseTypeIds === null) return "Todos los tipos";
  const names = caseTypes.filter((t) => caseTypeIds.includes(t.id)).map((t) => t.name);
  // Tipos archivados o borrados que siguen en la lista no se nombran.
  return names.length > 0 ? names.join(", ") : "Ningún tipo activo";
}

/** Miembros del espacio que todavía no están en el equipo, por nombre. */
export function membersAvailableToAdd<T extends { userId: string; name: string }>(
  workspaceMembers: readonly T[],
  teamMemberIds: readonly string[],
): T[] {
  const inTeam = new Set(teamMemberIds);
  return workspaceMembers
    .filter((m) => !inTeam.has(m.userId))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Equipos activos primero (por defecto arriba), luego los archivados; por nombre. */
export function sortTeams<T extends { name: string; isDefault: boolean; archived: boolean }>(
  teams: readonly T[],
): T[] {
  return [...teams].sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name, "es");
  });
}
