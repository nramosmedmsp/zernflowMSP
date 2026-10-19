// Posiciones del Mapa de flujos: carriles de flujos arriba, secuencias en medio
// y un carril por tipo de gestión debajo. Puro: devuelve coordenadas para que
// la pantalla las dibuje con React Flow.

import {
  caseTypeNodeId,
  closeNodeId,
  flowNodeId,
  sequenceNodeId,
  stageNodeId,
  type FlowMapModel,
  type MapConnection,
} from "./types";

export type MapNodeKind = "lane" | "flow" | "stage" | "caseType" | "close" | "sequence";

export interface LayoutNode {
  id: string;
  kind: MapNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Carril: título y descripción. Resto: id del elemento del modelo. */
  ref: string;
}

export type HandleSide = "t" | "b" | "l" | "r";

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** `<lado>-s` en el origen y `<lado>-t` en el destino (t, b, l, r). */
  sourceHandle: string;
  targetHandle: string;
  connection: MapConnection;
}

export interface MapLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  compact?: boolean;
}

const GAP = 24;
const LANE_PAD = 20;
const LANE_GAP = 28;

export function layoutFlowMap(model: FlowMapModel, options: LayoutOptions = {}): MapLayout {
  const compact = !!options.compact;
  const cardW = compact ? 208 : 272;
  const cardH = compact ? 64 : 136;
  const stageH = compact ? 56 : 88;
  const headerH = compact ? 34 : 48;
  const cols = 4;
  const laneW = LANE_PAD * 2 + cols * cardW + (cols - 1) * GAP;

  const nodes: LayoutNode[] = [];
  let y = 0;

  const addLane = (id: string, title: string, items: Array<{ id: string; kind: MapNodeKind; ref: string }>, itemH: number) => {
    const rows = Math.max(1, Math.ceil(items.length / cols));
    const height = headerH + LANE_PAD + rows * itemH + (rows - 1) * GAP + LANE_PAD;
    nodes.push({ id: `lane:${id}`, kind: "lane", x: 0, y, width: laneW, height, ref: title });
    items.forEach((item, i) => {
      nodes.push({
        id: item.id,
        kind: item.kind,
        x: LANE_PAD + (i % cols) * (cardW + GAP),
        y: y + headerH + LANE_PAD + Math.floor(i / cols) * (itemH + GAP),
        width: cardW,
        height: itemH,
        ref: item.ref,
      });
    });
    y += height + LANE_GAP;
  };

  for (const lane of model.lanes) {
    if (lane.flowIds.length === 0) continue;
    addLane(
      lane.id,
      lane.title,
      lane.flowIds.map((id) => ({ id: flowNodeId(id), kind: "flow" as const, ref: id })),
      cardH,
    );
  }

  if (model.sequences.length > 0) {
    addLane(
      "sequences",
      "Secuencias",
      model.sequences.map((s) => ({ id: sequenceNodeId(s.id), kind: "sequence" as const, ref: s.id })),
      stageH,
    );
  }

  for (const caseType of model.caseTypes) {
    addLane(
      `ct:${caseType.id}`,
      `Gestión: ${caseType.name}`,
      [
        { id: caseTypeNodeId(caseType.id), kind: "caseType" as const, ref: caseType.id },
        ...caseType.stages.map((s) => ({ id: stageNodeId(s.id), kind: "stage" as const, ref: s.id })),
        { id: closeNodeId(caseType.id), kind: "close" as const, ref: caseType.id },
      ],
      stageH,
    );
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: LayoutEdge[] = [];
  for (const connection of model.connections) {
    const from = byId.get(connection.from);
    const to = byId.get(connection.to);
    if (!from || !to) continue;
    const [fromSide, toSide] = pickSides(from, to);
    edges.push({
      id: connection.id,
      source: from.id,
      target: to.id,
      sourceHandle: `${fromSide}-s`,
      targetHandle: `${toSide}-t`,
      connection,
    });
  }

  return { nodes, edges, width: laneW, height: Math.max(0, y - LANE_GAP) };
}

/** Lados por los que sale y entra una conexión, según dónde queda un nodo respecto del otro. */
export function pickSides(from: LayoutNode, to: LayoutNode): [HandleSide, HandleSide] {
  if (to.y >= from.y + from.height) return ["b", "t"];
  if (to.y + to.height <= from.y) return ["t", "b"];
  return to.x >= from.x ? ["r", "l"] : ["l", "r"];
}
