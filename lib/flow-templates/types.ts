// Biblioteca de plantillas de flujos (docs/PLAN-CRM.md 7.8, docs/FASE-2-TECNICO.md 4).
//
// Cada plantilla es un grafo en el mismo formato que guarda el lienzo
// (`flows.nodes` y `flows.edges`) más `refs`: los tipos de gestión, etapas,
// equipos y tipos de contacto se referencian por NOMBRE (como en
// lib/business-templates.ts). Al instalar, `resolveFlowTemplate` los cambia por
// los ids del espacio; lo que no existe queda sin configurar y se avisa.

export type FlowTemplateBusiness = "ecommerce" | "gym" | "general";

export const BUSINESS_LABELS: Record<FlowTemplateBusiness, string> = {
  ecommerce: "E-commerce",
  gym: "Gimnasio",
  general: "General",
};

export type ConditionRefKind = "caseType" | "stage" | "team" | "contactType";

export interface ConditionRef {
  /** Posición de la condición dentro de `data.conditions`. */
  index: number;
  kind: ConditionRefKind;
  name: string;
  /** Tipo de gestión dueño de la etapa (solo kind "stage"). */
  caseType?: string;
}

/** Referencias por nombre de un nodo; el resolvedor las cambia por ids en `data`. */
export interface NodeRefs {
  /** Tipo de gestión: `data.caseTypeId` (Clasificar gestión y disparadores). */
  caseType?: string;
  /** Etapa abierta: `data.stageId`. Se busca en `stageCaseType` o, si falta, en `caseType`. */
  stage?: string;
  stageCaseType?: string;
  /** Categoría del tipo `caseType`: `data.categoryId` (Clasificar gestión). */
  category?: string;
  /** Equipo: `data.teamId` (Asignar a equipo). */
  team?: string;
  conditions?: ConditionRef[];
}

export interface TemplateNode {
  id: string;
  type: "trigger" | "sendMessage" | "condition" | "delay" | "action";
  position: { x: number; y: number };
  data: Record<string, unknown>;
  refs?: NodeRefs;
}

export interface TemplateEdge {
  id: string;
  source: string;
  target: string;
  /** "yes" / "no" en las condiciones (así los dibuja el lienzo). */
  sourceHandle?: string;
}

export interface TemplateGraph {
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

export interface TemplateCustomField {
  slug: string;
  name: string;
}

export interface FlowTemplate {
  id: string;
  name: string;
  /** Qué hace, en una o dos frases. */
  description: string;
  business: FlowTemplateBusiness;
  category: string;
  /** Qué tienes que ajustar antes de publicarla (datos de ejemplo, enlaces, plantillas...). */
  adjust: string[];
  /** Ids de otras plantillas que deben estar publicadas para que esta funcione bien. */
  requires?: string[];
  /** Campos personalizados que usa; se crean si no existen. */
  customFields?: TemplateCustomField[];
  /** Nodos Condición cuya salida "No" puede quedar sin conectar (el flujo termina ahí). */
  allowedOpenEnds?: string[];
  graph: TemplateGraph;
}

// ── Catálogo del espacio y resultado de la resolución ───────────────────────

export interface CatalogStage {
  id: string;
  name: string;
  kind: "open" | "won" | "lost" | "resolved";
}

export interface CatalogCategory {
  id: string;
  name: string;
}

export interface CatalogCaseType {
  id: string;
  name: string;
  stages: CatalogStage[];
  categories?: CatalogCategory[];
}

export interface TemplateCatalog {
  caseTypes: CatalogCaseType[];
  teams: Array<{ id: string; name: string }>;
  contactTypes: Array<{ id: string; name: string }>;
}

export interface FlowTemplateNotice {
  level: "warning" | "info";
  nodeId?: string;
  nodeLabel?: string;
  message: string;
}
