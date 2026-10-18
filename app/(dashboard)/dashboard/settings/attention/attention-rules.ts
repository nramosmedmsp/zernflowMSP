// Reglas puras de la configuración de atención (docs/PLAN-CRM.md 4.3 y 5.2):
// opciones, valores por defecto y la mezcla con el resto de
// `workspaces.settings` sin pisar otras claves.

import type { AgentVisibility, AssignmentMode } from "@/lib/types/database";
import { AGENT_VISIBILITIES, DEFAULT_AGENT_VISIBILITY } from "@/lib/permissions";

export const ASSIGNMENT_MODE_DEFAULT: AssignmentMode = "round_robin";

export interface AttentionSettings {
  agentVisibility: AgentVisibility;
  assignmentMode: AssignmentMode;
  agentCanReturnToQueue: boolean;
}

export const AGENT_VISIBILITY_OPTIONS: readonly {
  value: AgentVisibility;
  label: string;
  description: string;
  recommended?: boolean;
}[] = [
  {
    value: "own",
    label: "Solo sus gestiones",
    description:
      "El asesor ve únicamente lo que le asignaron. No ve la cola ni toma gestiones por su cuenta.",
    recommended: true,
  },
  {
    value: "own_and_unassigned",
    label: "Las suyas y las sin asignar de su equipo",
    description: "Además de las suyas, ve las gestiones sin asignar de su equipo y puede tomarlas.",
  },
  {
    value: "team",
    label: "Todas las de su equipo",
    description: "Ve todas las gestiones y contactos de su equipo.",
  },
];

const ASSIGNMENT_MODES: readonly AssignmentMode[] = ["round_robin", "least_load", "manual"];

function asRecord(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>)
    : {};
}

/** Lee la configuración de atención de `workspaces.settings` con sus valores por defecto. */
export function attentionFromSettings(settings: unknown): AttentionSettings {
  const s = asRecord(settings);
  return {
    agentVisibility: (AGENT_VISIBILITIES as readonly unknown[]).includes(s.agent_visibility)
      ? (s.agent_visibility as AgentVisibility)
      : DEFAULT_AGENT_VISIBILITY,
    assignmentMode: (ASSIGNMENT_MODES as readonly unknown[]).includes(s.assignment_mode)
      ? (s.assignment_mode as AssignmentMode)
      : ASSIGNMENT_MODE_DEFAULT,
    agentCanReturnToQueue: s.agent_can_return_to_queue === true,
  };
}

/** Valida lo que llega del navegador; devuelve el motivo en español si algo no es válido. */
export function parseAttentionInput(input: unknown): { value: AttentionSettings } | { error: string } {
  const i = asRecord(input);
  if (!(AGENT_VISIBILITIES as readonly unknown[]).includes(i.agentVisibility)) {
    return { error: "Elige qué gestiones puede ver un asesor." };
  }
  if (!(ASSIGNMENT_MODES as readonly unknown[]).includes(i.assignmentMode)) {
    return { error: "El modo de reparto no es válido." };
  }
  if (typeof i.agentCanReturnToQueue !== "boolean") {
    return { error: "La opción de devolver gestiones a la cola no es válida." };
  }
  return {
    value: {
      agentVisibility: i.agentVisibility as AgentVisibility,
      assignmentMode: i.assignmentMode as AssignmentMode,
      agentCanReturnToQueue: i.agentCanReturnToQueue,
    },
  };
}

/**
 * Settings nuevos: los actuales con solo las tres claves de atención
 * cambiadas. Conserva `business_template`, `key_date_label` y cualquier clave
 * desconocida.
 */
export function mergeAttentionSettings(
  current: unknown,
  next: AttentionSettings,
): Record<string, unknown> {
  return {
    ...asRecord(current),
    agent_visibility: next.agentVisibility,
    assignment_mode: next.assignmentMode,
    agent_can_return_to_queue: next.agentCanReturnToQueue,
  };
}
