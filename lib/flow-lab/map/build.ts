// Construcción del Mapa de flujos: puro, a partir del catálogo del laboratorio
// (loadLabCatalog / buildCatalogFromTemplates). Calcula las tarjetas por carril,
// las conexiones entre flujos, etapas y secuencias, y los avisos.

import { conditionHandleAliases } from "@/lib/flow-engine/graph";
import { nodeKind } from "@/lib/flow-engine/node-kind";
import type { LabCatalog, LabFlow, LabNode, LabTrigger } from "../types";
import {
  caseTypeNodeId,
  closeNodeId,
  flowNodeId,
  sequenceNodeId,
  stageNodeId,
  type FlowCard,
  type FlowCardStageRef,
  type FlowMapModel,
  type LaneId,
  type MapCaseType,
  type MapConnection,
  type MapLane,
  type MapSequence,
  type MapWarning,
  type WarningKind,
  type WarningSeverity,
} from "./types";

export interface BuildFlowMapOptions {
  /** Secuencias del espacio (el catálogo no las trae). Sin ellas se muestran sin nombre y no se valida su existencia. */
  sequences?: ReadonlyArray<{ id: string; name: string }>;
}

export const LANE_DEFS: ReadonlyArray<Pick<MapLane, "id" | "title" | "description">> = [
  { id: "first", title: "Primer mensaje / Gestión nueva", description: "Arrancan cuando un contacto nuevo escribe por primera vez." },
  { id: "keywords", title: "Palabras clave y botones", description: "Arrancan cuando el mensaje contiene una palabra clave o el cliente pulsa un botón." },
  { id: "events", title: "Eventos de gestión", description: "Arrancan solos al cambiar de etapa, cerrar una gestión o cuando el cliente no responde." },
  { id: "default", title: "Respuesta por defecto", description: "Responden cuando ningún otro flujo coincide." },
  { id: "none", title: "Sin disparador", description: "No arrancan solos: solo se alcanzan desde otro flujo." },
];

const OUTCOME_TEXT: Record<string, string> = { won: "ganada", lost: "perdida", resolved: "resuelta" };

const NODE_KIND_LABELS: Record<string, string> = {
  trigger: "Disparador",
  sendMessage: "Enviar mensaje",
  condition: "Condición",
  delay: "Espera",
  smartDelay: "Espera de respuesta",
  aiResponse: "Respuesta con IA",
  addTag: "Agregar etiqueta",
  removeTag: "Quitar etiqueta",
  setCustomField: "Campo personalizado",
  httpRequest: "Solicitud HTTP",
  goToFlow: "Ir a flujo",
  humanTakeover: "Atención humana",
  subscribe: "Suscribir",
  unsubscribe: "Dar de baja",
  abSplit: "Prueba A/B",
  enrollSequence: "Inscribir en secuencia",
  classifyCase: "Clasificar gestión",
  changeStage: "Cambiar etapa",
  assignTeam: "Asignar a equipo",
  distributeCase: "Repartir a asesor",
};

// ── Utilidades ──────────────────────────────────────────────────────────────

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Sin mayúsculas, tildes ni espacios sobrantes. */
export function normalizeKeyword(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Palabras clave de un disparador (acepta ["a"] y [{ value, matchType }]). */
export function triggerKeywords(config: unknown): string[] {
  const keywords = obj(config).keywords;
  if (!Array.isArray(keywords)) return [];
  const out: string[] = [];
  for (const k of keywords) {
    const value = typeof k === "string" ? k : str(obj(k).value);
    if (value && value.trim()) out.push(value.trim());
  }
  return out;
}

export function nodeLabel(node: LabNode): string {
  return str(node.data?.label) ?? NODE_KIND_LABELS[nodeKind(node)] ?? node.type;
}

/** «A», «B» y «C» (con "y N más" si hay muchos). */
function joinNames(names: string[], max = 3): string {
  const unique = [...new Set(names)];
  const shown = unique.slice(0, max).map((n) => `«${n}»`);
  if (unique.length > max) return `${shown.join(", ")} y ${unique.length - max} más`;
  return shown.join(", ").replace(/, ([^,]*)$/, " y $1");
}

function mentionsPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return value.includes("[REEMPLAZA");
  if (Array.isArray(value)) return value.some(mentionsPlaceholder);
  if (value && typeof value === "object") return Object.values(value).some(mentionsPlaceholder);
  return false;
}

/** Todos los valores `payload` de un nodo (botones, respuestas rápidas, carruseles). */
function collectPayloads(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectPayloads(v, out);
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (key === "payload" && typeof v === "string" && v) out.add(v);
      else collectPayloads(v, out);
    }
  }
}

// ── Piezas del modelo ───────────────────────────────────────────────────────

function laneOf(triggers: LabTrigger[]): LaneId {
  const types = new Set(triggers.map((t) => t.type));
  if (types.has("welcome") || types.has("case_opened")) return "first";
  if (["keyword", "comment_keyword", "postback", "quick_reply"].some((t) => types.has(t))) return "keywords";
  if (["case_stage_changed", "case_closed", "client_no_reply"].some((t) => types.has(t))) return "events";
  if (types.has("default")) return "default";
  return "none";
}

interface StageInfo {
  name: string;
  caseTypeId: string;
  caseTypeName: string;
}

function stageLookup(catalog: LabCatalog): Map<string, StageInfo> {
  const map = new Map<string, StageInfo>();
  for (const t of catalog.caseTypes) {
    for (const s of t.stages) map.set(s.id, { name: s.name, caseTypeId: t.id, caseTypeName: t.name });
  }
  return map;
}

/** Una línea por disparador, corta, para la tarjeta. */
export function summarizeTrigger(catalog: LabCatalog, trigger: LabTrigger): string {
  const config = obj(trigger.config);
  const typeName = catalog.caseTypes.find((t) => t.id === str(config.case_type_id))?.name;
  switch (trigger.type) {
    case "welcome":
      return "Primer mensaje del contacto";
    case "case_opened":
      return config.only_unclassified === true ? "Gestión nueva sin clasificar" : "Gestión nueva";
    case "default":
      return "Cualquier otro mensaje";
    case "keyword":
    case "comment_keyword": {
      const keywords = triggerKeywords(config);
      const prefix = trigger.type === "comment_keyword" ? "En comentarios: " : "";
      if (keywords.length === 0) return `${prefix}palabras clave (ninguna configurada)`;
      const shown = keywords.slice(0, 3).map((k) => `«${k}»`).join(", ");
      return `${prefix}${shown}${keywords.length > 3 ? ` +${keywords.length - 3}` : ""}`;
    }
    case "postback":
    case "quick_reply":
      return `Botón «${str(config.payload) ?? "sin carga"}»`;
    case "case_stage_changed": {
      const stageId = str(config.stage_id);
      const stage = stageId ? stageLookup(catalog).get(stageId) : undefined;
      if (stage) return `${stage.caseTypeName} › ${stage.name}`;
      return `${typeName ? `${typeName} › ` : ""}cualquier cambio de etapa`;
    }
    case "case_closed": {
      const outcome = typeof config.outcome === "string" ? OUTCOME_TEXT[config.outcome] : undefined;
      return `Cierre${typeName ? ` de ${typeName}` : " de gestión"}${outcome ? ` (${outcome})` : ""}`;
    }
    case "client_no_reply": {
      const minutes = Number(config.minutes);
      const m = Number.isInteger(minutes) && minutes > 0 ? minutes : 60;
      return `Cliente sin responder ${m} min${typeName ? ` · ${typeName}` : ""}`;
    }
    default:
      return trigger.type;
  }
}

function summarizeFlowTriggers(catalog: LabCatalog, triggers: LabTrigger[]): string {
  if (triggers.length === 0) return "Sin disparador";
  const lines = [...new Set(triggers.map((t) => summarizeTrigger(catalog, t)))];
  return lines.length > 2 ? `${lines.slice(0, 2).join(" · ")} · +${lines.length - 2} más` : lines.join(" · ");
}

function orderedNodeIds(flow: LabFlow): string[] {
  return [...flow.nodes]
    .sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0) || (a.position?.y ?? 0) - (b.position?.y ?? 0))
    .map((n) => n.id);
}

// ── Avisos ──────────────────────────────────────────────────────────────────

class WarningBag {
  readonly items: MapWarning[] = [];
  private seen = new Set<string>();

  add(w: {
    kind: WarningKind;
    severity: WarningSeverity;
    title: string;
    message: string;
    flowIds: string[];
    nodeIds?: string[];
    key?: string;
  }) {
    const id = `${w.kind}:${w.key ?? w.flowIds.join("+")}`;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.items.push({ id, kind: w.kind, severity: w.severity, title: w.title, message: w.message, flowIds: w.flowIds, nodeIds: w.nodeIds ?? [] });
  }
}

const SEVERITY_ORDER: Record<WarningSeverity, number> = { error: 0, warning: 1, info: 2 };

// ── Construcción ────────────────────────────────────────────────────────────

export function buildFlowMap(catalog: LabCatalog, options: BuildFlowMapOptions = {}): FlowMapModel {
  const flowById = new Map(catalog.flows.map((f) => [f.id, f]));
  const stageInfo = stageLookup(catalog);
  const triggersByFlow = new Map<string, LabTrigger[]>();
  for (const t of catalog.triggers) triggersByFlow.set(t.flowId, [...(triggersByFlow.get(t.flowId) ?? []), t]);
  const knownSequences = options.sequences ? new Map(options.sequences.map((s) => [s.id, s.name])) : null;
  const flowName = (id: string) => flowById.get(id)?.name ?? id;

  const bag = new WarningBag();
  const connections: MapConnection[] = [];
  const connectionIds = new Set<string>();
  const connect = (c: Omit<MapConnection, "id">) => {
    const id = `${c.kind}:${c.from}>${c.to}:${c.label}`;
    if (connectionIds.has(id)) return;
    connectionIds.add(id);
    connections.push({ id, ...c });
  };

  // Estructura por tipo de gestión.
  const caseTypes: MapCaseType[] = [...catalog.caseTypes]
    .sort((a, b) => a.position - b.position)
    .map((t) => ({
      id: t.id,
      name: t.name,
      stages: [...t.stages]
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ id: s.id, name: s.name, kind: s.kind, position: s.position, activatesFlowIds: [], setByFlowIds: [] })),
      anyStageFlowIds: [],
      closeFlowIds: [],
    }));
  const ctById = new Map(caseTypes.map((t) => [t.id, t]));
  const stageMap = new Map(caseTypes.flatMap((t) => t.stages.map((s) => [s.id, s] as const)));
  const activatedBy = new Map<string, FlowCardStageRef[]>();
  const sequences = new Map<string, MapSequence>();

  // Flujos alcanzados con «Ir a flujo» desde un flujo publicado.
  const reachedByGoto = new Set<string>();
  for (const flow of catalog.flows) {
    if (flow.status !== "published") continue;
    for (const node of flow.nodes) {
      if (nodeKind(node) !== "goToFlow") continue;
      const target = str(node.data?.flowId);
      if (target && flowById.has(target)) reachedByGoto.add(target);
    }
  }

  // Cargas (payload) que algún botón de un flujo publicado puede enviar.
  const emittedPayloads = new Set<string>();
  for (const flow of catalog.flows) {
    if (flow.status !== "published") continue;
    for (const node of flow.nodes) if (node.type !== "trigger") collectPayloads(node.data, emittedPayloads);
  }

  // ── Disparadores de eventos: etapa → flujo, cierre → flujo ───────────────
  for (const flow of catalog.flows) {
    const published = flow.status === "published";
    for (const trigger of triggersByFlow.get(flow.id) ?? []) {
      const config = obj(trigger.config);
      const typeId = str(config.case_type_id);
      const stageId = str(config.stage_id);
      const triggerNodes = trigger.nodeId ? [trigger.nodeId] : [];

      if (trigger.type !== "case_stage_changed" && trigger.type !== "case_closed") continue;

      if (typeId && !ctById.has(typeId)) {
        bag.add({
          kind: "missing_reference",
          severity: published ? "error" : "warning",
          title: `«${flow.name}» escucha un tipo de gestión que ya no existe`,
          message: `El disparador de «${flow.name}» apunta a un tipo de gestión archivado o inexistente, así que nunca se activará. Elige otro tipo en el disparador.`,
          flowIds: [flow.id],
          nodeIds: triggerNodes,
          key: `${flow.id}:type:${typeId}`,
        });
        continue;
      }

      if (trigger.type === "case_stage_changed") {
        if (stageId) {
          const stage = stageMap.get(stageId);
          const info = stageInfo.get(stageId);
          if (!stage || !info) {
            bag.add({
              kind: "missing_reference",
              severity: published ? "error" : "warning",
              title: `«${flow.name}» escucha una etapa que ya no existe`,
              message: `El disparador de «${flow.name}» apunta a una etapa archivada o inexistente, así que nunca se activará. Elige otra etapa en el disparador.`,
              flowIds: [flow.id],
              nodeIds: triggerNodes,
              key: `${flow.id}:stage:${stageId}`,
            });
            continue;
          }
          stage.activatesFlowIds.push(flow.id);
          activatedBy.set(flow.id, [
            ...(activatedBy.get(flow.id) ?? []),
            { stageId, stageName: info.name, caseTypeId: info.caseTypeId, caseTypeName: info.caseTypeName },
          ]);
          connect({
            kind: "stage",
            from: stageNodeId(stageId),
            to: flowNodeId(flow.id),
            label: `Al llegar a «${info.name}» se activa`,
            flowId: flow.id,
          });
        } else {
          const owners = typeId ? [ctById.get(typeId)!] : caseTypes;
          for (const ct of owners) {
            ct.anyStageFlowIds.push(flow.id);
            connect({
              kind: "stage",
              from: caseTypeNodeId(ct.id),
              to: flowNodeId(flow.id),
              label: "Con cualquier cambio de etapa se activa",
              flowId: flow.id,
            });
          }
          if (published) {
            bag.add({
              kind: "broad_trigger",
              severity: "info",
              title: `«${flow.name}» se activa con cualquier cambio de etapa`,
              message: `El disparador de «${flow.name}» no indica una etapa${typeId ? "" : " ni un tipo de gestión"}: se ejecutará con cada cambio de etapa${typeId ? " de ese tipo" : " de cualquier gestión"}. Si no es lo que buscas, elige la etapa en el disparador.`,
              flowIds: [flow.id],
              nodeIds: triggerNodes,
              key: flow.id,
            });
          }
        }
      }

      if (trigger.type === "case_closed") {
        const outcome = typeof config.outcome === "string" ? OUTCOME_TEXT[config.outcome] : undefined;
        const owners = typeId ? [ctById.get(typeId)!] : caseTypes;
        for (const ct of owners) {
          ct.closeFlowIds.push(flow.id);
          connect({
            kind: "closed",
            from: closeNodeId(ct.id),
            to: flowNodeId(flow.id),
            label: `Al cerrar${outcome ? ` como ${outcome}` : ""} se activa`,
            flowId: flow.id,
          });
        }
      }
    }
  }

  // ── Nodos de cada flujo: conexiones, gestiones sin configurar, referencias ─
  for (const flow of catalog.flows) {
    const published = flow.status === "published";
    const severity: WarningSeverity = published ? "error" : "warning";

    for (const node of flow.nodes) {
      const kind = nodeKind(node);
      const data = obj(node.data);
      const label = nodeLabel(node);
      const unconfigured = (what: string) =>
        bag.add({
          kind: "unconfigured_node",
          severity,
          title: `«${label}» sin configurar en «${flow.name}»`,
          message: `El nodo «${label}» de «${flow.name}» no tiene ${what}: ${published ? "al ejecutarse falla y queda registrado un error" : "configúralo antes de publicar"}.`,
          flowIds: [flow.id],
          nodeIds: [node.id],
          key: `${flow.id}:${node.id}`,
        });
      const dangling = (what: string) =>
        bag.add({
          kind: "missing_reference",
          severity,
          title: `«${label}» apunta a algo que ya no existe en «${flow.name}»`,
          message: `El nodo «${label}» de «${flow.name}» usa ${what} archivado o inexistente. Elígelo de nuevo.`,
          flowIds: [flow.id],
          nodeIds: [node.id],
          key: `${flow.id}:${node.id}`,
        });

      switch (kind) {
        case "goToFlow": {
          const target = str(data.flowId);
          if (!target) {
            unconfigured("el flujo al que ir");
          } else if (!flowById.has(target)) {
            dangling("un flujo");
          } else {
            connect({
              kind: "goto",
              from: flowNodeId(flow.id),
              to: flowNodeId(target),
              label: data.returnAfter ? "Ir a flujo y volver" : "Ir a flujo",
              flowId: flow.id,
            });
            if (published && flowById.get(target)!.status !== "published") {
              bag.add({
                kind: "draft_target",
                severity: "error",
                title: `«${flow.name}» salta a un borrador`,
                message: `«${flow.name}» tiene un nodo «Ir a flujo» que apunta a «${flowName(target)}», que está en borrador: el contacto no recibirá nada de ese flujo hasta que lo publiques.`,
                flowIds: [flow.id, target],
                nodeIds: [node.id],
                key: `${flow.id}:${node.id}`,
              });
            }
          }
          break;
        }
        case "changeStage": {
          const stageId = str(data.stageId);
          const stage = stageId ? stageMap.get(stageId) : undefined;
          if (!stageId) unconfigured("la etapa a la que cambiar");
          else if (!stage) dangling("una etapa");
          else {
            stage.setByFlowIds.push(flow.id);
            connect({
              kind: "stage",
              from: flowNodeId(flow.id),
              to: stageNodeId(stageId),
              label: `Cambia la etapa a «${stage.name}»`,
              flowId: flow.id,
            });
          }
          break;
        }
        case "classifyCase": {
          const typeId = str(data.caseTypeId);
          const stageId = str(data.stageId);
          if (!typeId) unconfigured("el tipo de gestión");
          else if (!ctById.has(typeId)) dangling("un tipo de gestión");
          else if (stageId) {
            const stage = stageMap.get(stageId);
            if (!stage) dangling("una etapa");
            else {
              stage.setByFlowIds.push(flow.id);
              connect({
                kind: "stage",
                from: flowNodeId(flow.id),
                to: stageNodeId(stageId),
                label: `Clasifica y pasa a «${stage.name}»`,
                flowId: flow.id,
              });
            }
          }
          break;
        }
        case "assignTeam": {
          const teamId = str(data.teamId);
          if (data.mode !== "reroute") {
            if (!teamId) unconfigured("el equipo");
            else if (!catalog.teams.some((t) => t.id === teamId)) dangling("un equipo");
          }
          break;
        }
        case "enrollSequence": {
          const sequenceId = str(data.sequenceId);
          if (!sequenceId) {
            unconfigured("la secuencia");
          } else if (knownSequences && !knownSequences.has(sequenceId)) {
            dangling("una secuencia");
          } else {
            const name = knownSequences?.get(sequenceId) ?? "Secuencia";
            sequences.set(sequenceId, { id: sequenceId, name, known: !!knownSequences });
            connect({
              kind: "sequence",
              from: flowNodeId(flow.id),
              to: sequenceNodeId(sequenceId),
              label: `Inscribe en «${name}»`,
              flowId: flow.id,
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // ── Avisos por flujo: textos pendientes, grafo, disparadores ──────────────
  for (const flow of catalog.flows) {
    const published = flow.status === "published";
    const triggers = triggersByFlow.get(flow.id) ?? [];
    const hasTriggerNode = flow.nodes.some((n) => n.type === "trigger");

    // Textos «[REEMPLAZA: ...]» pendientes.
    const pending = flow.nodes.filter((n) => mentionsPlaceholder(n.data));
    if (pending.length > 0) {
      bag.add({
        kind: "placeholder",
        severity: published ? "error" : "warning",
        title: `«${flow.name}» tiene datos de ejemplo sin reemplazar`,
        message: `${published ? "Está publicado y envía" : "Tiene"} textos con «[REEMPLAZA…]» pendientes en ${pending.length === 1 ? "el nodo" : "los nodos"} ${joinNames(pending.map(nodeLabel))}. Cámbialos por los datos reales${published ? ": tus clientes los reciben tal cual" : " antes de publicar"}.`,
        flowIds: [flow.id],
        nodeIds: pending.map((n) => n.id),
        key: flow.id,
      });
    }

    // Grafo: salidas y nodos sueltos.
    const nodeIds = new Set(flow.nodes.map((n) => n.id));
    const validEdges = flow.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    const outgoing = new Map<string, string[]>();
    for (const e of validEdges) outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);

    for (const node of flow.nodes) {
      const kind = nodeKind(node);
      const label = nodeLabel(node);
      const out = validEdges.filter((e) => e.source === node.id);
      if (node.type === "trigger" && out.length === 0) {
        bag.add({
          kind: "dead_end",
          severity: published ? "error" : "warning",
          title: `El disparador de «${flow.name}» no está conectado`,
          message: `«${label}» es el disparador de «${flow.name}» pero no lleva a ningún paso: el flujo se activa y no hace nada.`,
          flowIds: [flow.id],
          nodeIds: [node.id],
          key: `${flow.id}:${node.id}`,
        });
      } else if ((kind === "delay" || kind === "smartDelay") && out.length === 0) {
        bag.add({
          kind: "dead_end",
          severity: "warning",
          title: `Espera sin paso siguiente en «${flow.name}»`,
          message: `«${label}» de «${flow.name}» espera y después no hay nada: el camino termina ahí. Conecta el siguiente paso o quita la espera.`,
          flowIds: [flow.id],
          nodeIds: [node.id],
          key: `${flow.id}:${node.id}`,
        });
      } else if (kind === "condition") {
        const missing: string[] = [];
        for (const [handle, text] of [["yes", "Sí"], ["no", "No"]] as const) {
          const accepted = conditionHandleAliases(handle);
          if (!out.some((e) => e.sourceHandle && accepted.includes(e.sourceHandle))) missing.push(text);
        }
        if (missing.length > 0) {
          bag.add({
            kind: "dead_end",
            severity: missing.length === 2 ? "warning" : "info",
            title: `Camino sin salida en «${flow.name}»`,
            message: `La condición «${label}» de «${flow.name}» no tiene salida para ${missing.map((m) => `«${m}»`).join(" ni ")}: si se da ese caso, la conversación termina sin respuesta.`,
            flowIds: [flow.id],
            nodeIds: [node.id],
            key: `${flow.id}:${node.id}`,
          });
        }
      }
    }

    if (hasTriggerNode) {
      const reached = new Set<string>(flow.nodes.filter((n) => n.type === "trigger").map((n) => n.id));
      const queue = [...reached];
      while (queue.length > 0) {
        const id = queue.pop()!;
        for (const target of outgoing.get(id) ?? []) {
          if (!reached.has(target)) {
            reached.add(target);
            queue.push(target);
          }
        }
      }
      const loose = flow.nodes.filter((n) => !reached.has(n.id));
      if (loose.length > 0) {
        bag.add({
          kind: "disconnected_node",
          severity: "warning",
          title: `Nodos sin conectar en «${flow.name}»`,
          message: `${loose.length === 1 ? "Un nodo" : `${loose.length} nodos`} de «${flow.name}» no se alcanza${loose.length === 1 ? "" : "n"} desde el disparador (${joinNames(loose.map(nodeLabel))}): nunca se ejecutará${loose.length === 1 ? "" : "n"}.`,
          flowIds: [flow.id],
          nodeIds: loose.map((n) => n.id),
          key: flow.id,
        });
      }
    }

    // Flujos publicados que nadie activa.
    if (!published) continue;
    if (triggers.length === 0) {
      if (!reachedByGoto.has(flow.id)) {
        bag.add({
          kind: "no_trigger",
          severity: "error",
          title: `«${flow.name}» está publicado sin disparador`,
          message: hasTriggerNode
            ? `«${flow.name}» está publicado pero su disparador no es de un tipo que se active, y ningún otro flujo salta a él: nunca se activaría.`
            : `«${flow.name}» está publicado pero no tiene nodo de disparador y ningún otro flujo salta a él: nunca se activaría.`,
          flowIds: [flow.id],
          key: flow.id,
        });
      }
      continue;
    }
    const incomplete = (t: LabTrigger) => {
      const c = obj(t.config);
      if (t.type === "keyword" || t.type === "comment_keyword") return triggerKeywords(c).length === 0;
      if (t.type === "postback" || t.type === "quick_reply") return !str(c.payload);
      return false;
    };
    if (triggers.every(incomplete) && !reachedByGoto.has(flow.id)) {
      bag.add({
        kind: "never_active",
        severity: "error",
        title: `«${flow.name}» nunca se activaría`,
        message: `Todos los disparadores de «${flow.name}» están incompletos (sin palabras clave o sin carga del botón), así que ningún mensaje lo activa. Complétalos en el disparador.`,
        flowIds: [flow.id],
        nodeIds: triggers.flatMap((t) => (t.nodeId ? [t.nodeId] : [])),
        key: flow.id,
      });
    }
    for (const t of triggers) {
      const payload = str(obj(t.config).payload);
      if ((t.type === "postback" || t.type === "quick_reply") && payload && !emittedPayloads.has(payload)) {
        bag.add({
          kind: "orphan_payload",
          severity: "info",
          title: `Ningún botón activa «${flow.name}»`,
          message: `«${flow.name}» arranca con el botón «${payload}», pero ningún flujo publicado tiene un botón con esa carga. Solo se activará si el botón viene de otro lugar (por ejemplo un menú del canal).`,
          flowIds: [flow.id],
          nodeIds: t.nodeId ? [t.nodeId] : [],
          key: `${flow.id}:${payload}`,
        });
      }
    }
  }

  // ── Avisos entre flujos publicados ───────────────────────────────────────
  const publishedIds = new Set(catalog.flows.filter((f) => f.status === "published").map((f) => f.id));
  const byKeyword = new Map<string, { label: string; flowIds: Set<string> }>();
  const welcomeFlows = new Set<string>();
  const defaultFlows = new Set<string>();
  for (const t of catalog.triggers) {
    if (!t.isActive || !publishedIds.has(t.flowId)) continue;
    if (t.type === "welcome") welcomeFlows.add(t.flowId);
    if (t.type === "default") defaultFlows.add(t.flowId);
    if (t.type !== "keyword") continue;
    for (const k of triggerKeywords(t.config)) {
      const norm = normalizeKeyword(k);
      if (!norm) continue;
      const entry = byKeyword.get(norm) ?? { label: k, flowIds: new Set<string>() };
      entry.flowIds.add(t.flowId);
      byKeyword.set(norm, entry);
    }
  }
  for (const [norm, entry] of byKeyword) {
    if (entry.flowIds.size < 2) continue;
    const ids = [...entry.flowIds];
    bag.add({
      kind: "duplicate_keyword",
      severity: "warning",
      title: `Palabra clave repetida: «${entry.label}»`,
      message: `La palabra clave «${entry.label}» está en ${ids.length} flujos publicados (${joinNames(ids.map(flowName))}). Solo responde uno por mensaje: gana el de mayor prioridad y los demás no se activan con esa palabra.`,
      flowIds: ids,
      key: norm,
    });
  }
  for (const g of catalog.globalKeywords) {
    const norm = normalizeKeyword(g.keyword ?? "");
    const entry = norm ? byKeyword.get(norm) : undefined;
    if (!entry) continue;
    const ids = [...entry.flowIds];
    const action = g.action === "unsubscribe" ? "baja" : g.action === "subscribe" ? "alta" : "acción propia";
    bag.add({
      kind: "keyword_global",
      severity: "warning",
      title: `«${g.keyword}» es también una palabra clave global`,
      message: `«${g.keyword}» es una palabra clave global del espacio (${action}) y también activa ${joinNames(ids.map(flowName))}. La global se revisa antes, así que el flujo no se activa con ese texto exacto.`,
      flowIds: ids,
      key: norm,
    });
  }
  for (const [kind, set, text] of [
    ["duplicate_welcome", welcomeFlows, "de bienvenida (primer mensaje)"],
    ["duplicate_default", defaultFlows, "de respuesta por defecto"],
  ] as const) {
    if (set.size < 2) continue;
    const ids = [...set];
    bag.add({
      kind,
      severity: "warning",
      title: `Hay ${ids.length} flujos ${text} publicados`,
      message: `${joinNames(ids.map(flowName))} están publicados como flujo ${text}. Solo se ejecuta uno (el de mayor prioridad): los demás compiten sin necesidad.`,
      flowIds: ids,
      key: "all",
    });
  }

  // ── Tarjetas y carriles ──────────────────────────────────────────────────
  const warnings = [...bag.items].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title),
  );
  const warningIdsByFlow = new Map<string, string[]>();
  for (const w of warnings) {
    for (const id of w.flowIds) warningIdsByFlow.set(id, [...(warningIdsByFlow.get(id) ?? []), w.id]);
  }

  const cards: FlowCard[] = catalog.flows.map((flow) => {
    const triggers = triggersByFlow.get(flow.id) ?? [];
    const ids = warningIdsByFlow.get(flow.id) ?? [];
    return {
      id: flow.id,
      name: flow.name,
      status: flow.status,
      lane: laneOf(triggers),
      triggerSummary: summarizeFlowTriggers(catalog, triggers),
      triggerTypes: [...new Set(triggers.map((t) => t.type))],
      nodeCount: flow.nodes.length,
      nodeIds: orderedNodeIds(flow),
      warningIds: ids,
      warningCount: ids.length,
      activatedBy: activatedBy.get(flow.id) ?? [],
    };
  });

  const lanes: MapLane[] = LANE_DEFS.map((def) => ({ ...def, flowIds: cards.filter((c) => c.lane === def.id).map((c) => c.id) }));

  return {
    workspaceName: catalog.workspaceName,
    lanes,
    cards,
    caseTypes,
    sequences: [...sequences.values()],
    connections,
    warnings,
  };
}

/** Vista del modelo con solo los flujos publicados (y lo que queda conectado a ellos). */
export function filterPublished(model: FlowMapModel): FlowMapModel {
  const keep = new Set(model.cards.filter((c) => c.status === "published").map((c) => c.id));
  const connections = model.connections.filter(
    (c) => keep.has(c.flowId) && (!c.to.startsWith("flow:") || keep.has(c.to.slice("flow:".length))),
  );
  const usedSequences = new Set(connections.filter((c) => c.to.startsWith("seq:")).map((c) => c.to.slice("seq:".length)));
  return {
    ...model,
    lanes: model.lanes.map((l) => ({ ...l, flowIds: l.flowIds.filter((id) => keep.has(id)) })),
    cards: model.cards.filter((c) => keep.has(c.id)),
    caseTypes: model.caseTypes.map((t) => ({
      ...t,
      stages: t.stages.map((s) => ({
        ...s,
        activatesFlowIds: s.activatesFlowIds.filter((id) => keep.has(id)),
        setByFlowIds: s.setByFlowIds.filter((id) => keep.has(id)),
      })),
      anyStageFlowIds: t.anyStageFlowIds.filter((id) => keep.has(id)),
      closeFlowIds: t.closeFlowIds.filter((id) => keep.has(id)),
    })),
    sequences: model.sequences.filter((s) => usedSequences.has(s.id)),
    connections,
    warnings: model.warnings.filter((w) => w.flowIds.length === 0 || w.flowIds.some((id) => keep.has(id))),
  };
}
