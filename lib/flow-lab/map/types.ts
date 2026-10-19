// Tipos del Mapa de flujos: el modelo que arma build.ts a partir del catálogo.
// Todo es JSON y no depende de React ni del servidor.

import type { FlowStatus, StageKind } from "@/lib/types/database";

/** Carriles de los flujos, según cómo arrancan. */
export type LaneId = "first" | "keywords" | "events" | "default" | "none";

export interface MapLane {
  id: LaneId;
  title: string;
  description: string;
  flowIds: string[];
}

export type WarningSeverity = "error" | "warning" | "info";

export type WarningKind =
  | "duplicate_keyword"
  | "keyword_global"
  | "duplicate_welcome"
  | "duplicate_default"
  | "no_trigger"
  | "never_active"
  | "orphan_payload"
  | "dead_end"
  | "disconnected_node"
  | "unconfigured_node"
  | "placeholder"
  | "missing_reference"
  | "draft_target"
  | "broad_trigger";

export interface MapWarning {
  id: string;
  kind: WarningKind;
  severity: WarningSeverity;
  /** Frase corta, para la lista. */
  title: string;
  /** Explicación completa, en español. */
  message: string;
  /** Flujos involucrados (las tarjetas que se resaltan). */
  flowIds: string[];
  /** Nodos del primer flujo involucrado a los que apunta el aviso. */
  nodeIds: string[];
}

export interface FlowCardStageRef {
  stageId: string;
  stageName: string;
  caseTypeId: string;
  caseTypeName: string;
}

export interface FlowCard {
  id: string;
  name: string;
  status: FlowStatus;
  lane: LaneId;
  /** Disparadores en una línea: «hola», «precio» · Venta › Esperando pago... */
  triggerSummary: string;
  triggerTypes: string[];
  nodeCount: number;
  /** Ids de nodos en orden de lectura (izquierda a derecha, arriba a abajo). */
  nodeIds: string[];
  warningIds: string[];
  warningCount: number;
  /** Etapas a las que, al llegar, se activa este flujo. */
  activatedBy: FlowCardStageRef[];
}

export interface MapStage {
  id: string;
  name: string;
  kind: StageKind;
  position: number;
  /** Flujos que se activan al llegar a esta etapa. */
  activatesFlowIds: string[];
  /** Flujos que cambian la gestión a esta etapa. */
  setByFlowIds: string[];
}

export interface MapCaseType {
  id: string;
  name: string;
  stages: MapStage[];
  /** Flujos que se activan con cualquier cambio de etapa de este tipo. */
  anyStageFlowIds: string[];
  /** Flujos que se activan al cerrar una gestión de este tipo. */
  closeFlowIds: string[];
}

export interface MapSequence {
  id: string;
  name: string;
  /** false si el flujo la usa pero no figura entre las secuencias conocidas. */
  known: boolean;
}

export type ConnectionKind = "goto" | "stage" | "sequence" | "closed";

export const CONNECTION_LABELS: Record<ConnectionKind, string> = {
  goto: "Ir a flujo",
  stage: "Cambio de etapa",
  sequence: "Inscribe en secuencia",
  closed: "Cierre de gestión",
};

/**
 * Conexión entre dos elementos del mapa. Los extremos son ids de nodo del
 * mapa: `flow:<id>`, `stage:<id>`, `ct:<id>` (tipo de gestión, para "cualquier
 * etapa"), `close:<id>` (cierre del tipo) y `seq:<id>`.
 */
export interface MapConnection {
  id: string;
  kind: ConnectionKind;
  from: string;
  to: string;
  label: string;
  /** Flujo que origina la conexión o que se activa con ella (para resaltar). */
  flowId: string;
}

export interface FlowMapModel {
  workspaceName: string;
  lanes: MapLane[];
  cards: FlowCard[];
  caseTypes: MapCaseType[];
  sequences: MapSequence[];
  connections: MapConnection[];
  warnings: MapWarning[];
}

export const flowNodeId = (id: string) => `flow:${id}`;
export const stageNodeId = (id: string) => `stage:${id}`;
export const caseTypeNodeId = (id: string) => `ct:${id}`;
export const closeNodeId = (caseTypeId: string) => `close:${caseTypeId}`;
export const sequenceNodeId = (id: string) => `seq:${id}`;
