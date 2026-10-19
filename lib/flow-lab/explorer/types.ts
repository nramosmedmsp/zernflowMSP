// Tipos del Explorador de caminos (ver README.md, sección «Explorador»). Todo es
// JSON: el resultado se puede mostrar, guardar o exportar como texto.

import type { ClientInput, LabChannel, LabMessage, LabProfile } from "../types";

export const DEFAULT_MAX_DEPTH = 12;
export const DEFAULT_MAX_PATHS = 60;
export const DEFAULT_MAX_VARIANTS = 12;
/** Tope de acciones del simulador por exploración: corta cualquier caso que se descontrole. */
export const DEFAULT_MAX_ACTIONS = 4000;

export interface ExploreOptions {
  /** Flujo que se explora. */
  flowId: string;
  /**
   * Perfil de partida. Sin perfil, el explorador prueba los perfiles de ejemplo y un contacto de cada tipo
   * hasta encontrar uno con el que el flujo se dispare.
   */
  profile?: LabProfile;
  channel?: LabChannel;
  /** Reloj de partida (ISO). Por defecto, un lunes a las 10:00 de Lima. */
  clock?: string;
  /** Respuestas del cliente (y pasos del tiempo) como máximo en un camino. Por defecto 12. */
  maxDepth?: number;
  /** Caminos como máximo. Por defecto 60. */
  maxPaths?: number;
  /** Variantes del estado de partida como máximo (etiquetas, horario...). Por defecto 12. */
  maxVariants?: number;
  /** Probar también variantes del contacto y la gestión (etiqueta, horario, tipo...). Por defecto sí. */
  variants?: boolean;
  /** Añadir en cada espera la rama «el cliente no responde». Por defecto sí. */
  noReply?: boolean;
  /** Si el flujo arranca por un evento de gestión en WhatsApp, probar con la ventana de 24 h abierta y cerrada. Por defecto sí. */
  windowVariants?: boolean;
  /** Solo este disparador del flujo (id del nodo). Por defecto, todos. */
  triggerNodeId?: string;
  /** Mensaje inicial en vez del que se deduce del disparador. */
  startText?: string;
  /** Tope de acciones del simulador. */
  maxActions?: number;
}

export type ExploreStepKind = "variant" | "start" | "text" | "button" | "time" | "no_reply";

/** Un paso del camino: lo que dijo el cliente, la variante elegida o lo que arrancó el flujo. */
export interface ExploreStep {
  kind: ExploreStepKind;
  /** Frase corta para la rama del árbol («Pulsa «Mi pedido»», «Fuera de horario»...). */
  label: string;
  /** Lo que se envía al simulador (solo los pasos del cliente). */
  input?: ClientInput;
  /** Posición entre las opciones del mismo punto de decisión (ordena el árbol). */
  seq: number;
}

export type ExploreEndKind =
  /** El flujo llegó a su último nodo. */
  | "flow_end"
  /** Queda esperando una respuesta: el cliente no contesta. */
  | "waiting"
  /** Pasa a atención humana. */
  | "human"
  /** Terminó en otro flujo al que saltó. */
  | "goto"
  /** Algo falló (el flujo no se dispara, una acción no se pudo aplicar). */
  | "error"
  /** Se cortó por la profundidad máxima. */
  | "depth_limit"
  /** Volvió a esperar en el mismo punto y en el mismo estado. */
  | "cycle"
  /** Se cortó por el máximo de caminos. */
  | "path_limit";

export const END_KIND_LABELS: Record<ExploreEndKind, string> = {
  flow_end: "Fin del flujo",
  waiting: "Espera sin respuesta",
  human: "Atención humana",
  goto: "Salto a otro flujo",
  error: "Error",
  depth_limit: "Profundidad máxima",
  cycle: "Ciclo",
  path_limit: "Máximo de caminos",
};

export interface ExploreEnd {
  kind: ExploreEndKind;
  /** Frase en español de cómo terminó. */
  text: string;
}

/** Estado de la gestión y el contacto, en palabras (con los nombres del catálogo). */
export interface ExploreStateSummary {
  contactType: string | null;
  tags: string[];
  customFields: Record<string, string>;
  subscribed: boolean;
  owner: string | null;
  /** La gestión abierta más reciente (o la última). Null si el contacto no tiene ninguna. */
  case: {
    id: string;
    type: string | null;
    stage: string | null;
    category: string | null;
    status: string;
    assignee: string | null;
    team: string | null;
  } | null;
  /** Gestiones programadas: «Recompra · 12/11/2026». */
  scheduled: string[];
  botPaused: boolean;
  /** Variables de los flujos (sin las internas). */
  variables: Record<string, string>;
  /** Notas internas de la gestión (por ejemplo la del nodo Atención humana). */
  notes: string[];
}

export interface ExploreCondition {
  flowId: string;
  nodeId: string;
  output: "yes" | "no";
}

export interface ExplorePath {
  /** 1, 2, 3... en el orden del árbol. */
  id: number;
  /** «Mi pedido → Respuesta de prueba». */
  label: string;
  /** Variantes del estado de partida de este camino (vacío = el caso base). */
  variant: string[];
  steps: ExploreStep[];
  /** La conversación completa: cliente, bot y asesor. */
  messages: LabMessage[];
  /** Nodos recorridos, sin repetir y en orden de primera visita. */
  visited: { flowId: string; nodeId: string }[];
  /** Salidas de condición que tomó. */
  conditions: ExploreCondition[];
  /** Nombres de las salidas de una prueba A/B que tomó. */
  abPaths: { flowId: string; nodeId: string; path: string }[];
  end: ExploreEnd;
  final: ExploreStateSummary;
  /** Lo que cambió respecto al estado de partida, en frases. */
  changes: string[];
  warnings: string[];
  /** Flujos por los que pasó (el explorado primero). */
  flowIds: string[];
}

export interface ExploreTreeNode {
  id: string;
  kind: ExploreStepKind | "root";
  label: string;
  children: ExploreTreeNode[];
  /** Solo en las hojas: el camino que termina aquí. */
  pathId?: number;
  endKind?: ExploreEndKind;
  /** Rama que no se exploró por el límite de caminos. */
  skipped?: boolean;
}

export interface ExploreCoverageItem {
  flowId: string;
  nodeId: string;
  label: string;
  /** Tipo de nodo en español («Condición», «Enviar mensaje»). */
  kind: string;
}

export interface ExploreOutputItem extends ExploreCoverageItem {
  /** «yes» / «no» de una condición, o el nombre del camino de una prueba A/B. */
  output: string;
  /** «¿Quiere comprar? → No». */
  description: string;
}

export interface ExploreCoverage {
  flowId: string;
  nodesTotal: number;
  nodesReached: number;
  outputsTotal: number;
  outputsReached: number;
  /** 0 a 100 (nodos y salidas juntos). */
  percent: number;
  unreachedNodes: ExploreCoverageItem[];
  unreachedOutputs: ExploreOutputItem[];
  complete: boolean;
}

export interface ExploreStartReport {
  nodeId: string;
  /** «Palabras clave: precio». */
  trigger: string;
  /** Lo que se hizo para arrancar el flujo («El cliente escribe «precio»»). */
  action: string;
  ok: boolean;
  /** Perfil con el que arrancó. */
  profile: string | null;
  /** Por qué no arrancó. */
  problem?: string;
}

export interface ExploreResult {
  flowId: string;
  flowName: string;
  options: Required<Pick<ExploreOptions, "maxDepth" | "maxPaths" | "maxVariants">> & { channel: LabChannel; clock: string };
  /** Estado de partida (el del caso base). */
  initial: ExploreStateSummary;
  profileName: string | null;
  starts: ExploreStartReport[];
  paths: ExplorePath[];
  tree: ExploreTreeNode;
  coverage: ExploreCoverage;
  /** Variantes del estado de partida que cambiaron algo: «Con la etiqueta VIP». */
  variants: string[];
  truncated: {
    /** Se alcanzó el máximo de caminos y quedaron ramas sin explorar. */
    paths: boolean;
    /** Había más variantes que el máximo. */
    variants: boolean;
    /** Algún camino se cortó por la profundidad máxima. */
    depth: boolean;
    /** Se alcanzó el tope de acciones del simulador. */
    actions: boolean;
  };
  /** Avisos del explorador («No se pudo probar fuera de horario: el espacio no tiene horario»). */
  notes: string[];
  /** Acciones del simulador que se ejecutaron. */
  actions: number;
}
