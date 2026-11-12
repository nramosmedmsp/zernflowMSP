// R2-5: nodos de un flujo que apuntan a algo que ya no sirve (una etapa, un tipo
// de gestión, un equipo o un tipo de contacto archivado o borrado). El motor
// solo registra `case_action_failed`; esto lo hace visible en Flujos. Puro: lo
// usan la lista de flujos (servidor) y el editor (navegador).

import { nodeKind } from "./node-kind";

export interface CatalogItem {
  name: string;
  archived: boolean;
}

/** Catálogo vigente del espacio, con lo archivado incluido (lo que falta se considera borrado). */
export interface FlowCatalog {
  caseTypes: Record<string, CatalogItem>;
  stages: Record<string, CatalogItem>;
  teams: Record<string, CatalogItem>;
  contactTypes: Record<string, CatalogItem>;
}

export type BrokenRefKind = "caseType" | "stage" | "team" | "contactType";
export type BrokenState = "archived" | "missing";

export interface BrokenNode {
  nodeId: string;
  /** Cómo se llama el nodo en el lienzo («Cambiar etapa»...). */
  nodeLabel: string;
  refKind: BrokenRefKind;
  refId: string;
  /** Nombre actual o, si ya no existe, el que guardó el nodo. */
  refName: string | null;
  state: BrokenState;
  /** Frase lista para mostrar: «usa la etapa «X», que está archivada». */
  message: string;
}

export interface FlowNodeInput {
  id: string;
  type?: string;
  data?: unknown;
}

const REF_WORDS: Record<BrokenRefKind, { noun: string; article: "la" | "el"; archived: string }> = {
  stage: { noun: "etapa", article: "la", archived: "archivada" },
  caseType: { noun: "tipo de gestión", article: "el", archived: "archivado" },
  team: { noun: "equipo", article: "el", archived: "archivado" },
  contactType: { noun: "tipo de contacto", article: "el", archived: "archivado" },
};

const NODE_LABELS: Record<string, string> = {
  trigger: "Disparador",
  condition: "Condición",
  classifyCase: "Clasificar gestión",
  changeStage: "Cambiar etapa",
  assignTeam: "Asignar a equipo",
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function id(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.map(id).filter((v) => v !== "") : [];
}

function brokenMessage(kind: BrokenRefKind, state: BrokenState, name: string | null, verb: string): string {
  const w = REF_WORDS[kind];
  const status = w.archived;
  const ref = name ? `${w.article} ${w.noun} «${name}»` : `${w.article === "la" ? "una" : "un"} ${w.noun}`;
  const tail = state === "archived" ? `que está ${status}` : "que ya no existe";
  return `${verb} ${ref}, ${tail}`;
}

/**
 * Nodos del flujo cuyas referencias están archivadas o borradas. Revisa:
 * Clasificar gestión (tipo y etapa), Cambiar etapa (etapa), Asignar a equipo
 * (equipo, solo en modo fijo), disparadores de gestión (tipo, etapa y tipos de
 * contacto) y condiciones de gestión (tipo de contacto, tipo, etapa y equipo).
 * Una referencia vacía no cuenta: eso lo avisa la revisión de publicación.
 */
export function findBrokenNodes(nodes: readonly FlowNodeInput[], catalog: FlowCatalog): BrokenNode[] {
  const out: BrokenNode[] = [];
  const seen = new Set<string>();

  const check = (
    node: FlowNodeInput,
    label: string,
    kind: BrokenRefKind,
    refId: string,
    storedName: unknown,
    verb: string,
  ) => {
    if (!refId) return;
    const table =
      kind === "stage" ? catalog.stages : kind === "caseType" ? catalog.caseTypes : kind === "team" ? catalog.teams : catalog.contactTypes;
    const found = table[refId];
    if (found && !found.archived) return;
    const key = `${node.id}\u0000${kind}\u0000${refId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const state: BrokenState = found ? "archived" : "missing";
    const savedName = typeof storedName === "string" && storedName.trim() ? storedName.trim() : null;
    const refName = found ? found.name : savedName;
    out.push({
      nodeId: node.id,
      nodeLabel: label,
      refKind: kind,
      refId,
      refName,
      state,
      message: brokenMessage(kind, state, refName, verb),
    });
  };

  for (const node of nodes) {
    const data = rec(node.data);
    const config = rec(data.config);
    const type = nodeKind(node);
    const label = NODE_LABELS[type] ?? "Nodo";

    if (type === "classifyCase") {
      check(node, label, "caseType", id(data.caseTypeId), data.caseTypeName, "usa");
      check(node, label, "stage", id(data.stageId), data.stageName, "usa");
    } else if (type === "changeStage") {
      check(node, label, "stage", id(data.stageId), data.stageName, "usa");
    } else if (type === "assignTeam") {
      if (data.mode !== "reroute") check(node, label, "team", id(data.teamId), data.teamName, "usa");
    } else if (type === "trigger") {
      const triggerType = id(data.triggerType);
      if (triggerType.startsWith("case_") || triggerType === "client_no_reply") {
        check(node, label, "caseType", id(data.caseTypeId) || id(config.case_type_id), data.caseTypeName, "se activa con");
        check(node, label, "stage", id(data.stageId) || id(config.stage_id), data.stageName, "se activa con");
        const contactTypeIds = ids(data.contactTypeIds).length ? ids(data.contactTypeIds) : ids(config.contact_type_ids);
        const names = Array.isArray(data.contactTypeNames) ? data.contactTypeNames : [];
        const savedIds = ids(data.contactTypeIds);
        contactTypeIds.forEach((cid) => {
          const at = savedIds.indexOf(cid);
          check(node, label, "contactType", cid, at >= 0 ? names[at] : null, "se activa con");
        });
      }
    } else if (type === "condition") {
      const conditions = Array.isArray(data.conditions) ? data.conditions : [];
      for (const raw of conditions) {
        const c = rec(raw);
        const field = id(c.field);
        const value = id(c.value);
        const kind: BrokenRefKind | null =
          field === "contact_type" ? "contactType" : field === "case_type" ? "caseType" : field === "case_stage" ? "stage" : field === "case_team" ? "team" : null;
        if (kind) check(node, label, kind, value, null, "compara con");
      }
    }
  }
  return out;
}

/** Cuántos nodos distintos están rotos (un nodo con dos referencias rotas cuenta una vez). */
export function brokenNodeCount(broken: readonly BrokenNode[]): number {
  return new Set(broken.map((b) => b.nodeId)).size;
}

/** «N nodos rotos» / «1 nodo roto». */
export function brokenBadgeText(count: number): string {
  return `${count} ${count === 1 ? "nodo roto" : "nodos rotos"}`;
}

/** Detalle de una línea por nodo para el cursor encima o el aviso. */
export function brokenDetailLines(broken: readonly BrokenNode[]): string[] {
  return broken.map((b) => `«${b.nodeLabel}» ${b.message}.`);
}
