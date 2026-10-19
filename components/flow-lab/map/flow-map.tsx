"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildFlowMap, filterPublished } from "@/lib/flow-lab/map/build";
import { layoutFlowMap } from "@/lib/flow-lab/map/layout";
import {
  CONNECTION_LABELS,
  flowNodeId,
  type ConnectionKind,
  type FlowMapModel,
  type MapWarning,
} from "@/lib/flow-lab/map/types";
import type { LabCatalog } from "@/lib/flow-lab/types";
import {
  CaseTypeNode,
  CloseNode,
  FlowCardNode,
  LaneNode,
  SequenceNode,
  StageNode,
  type FlowCardNodeData,
  type InfoNodeData,
  type LaneNodeData,
  type MapEmphasis,
  type StageNodeData,
} from "./map-nodes";
import { WarningsPanel } from "./warnings-panel";

export interface FlowMapProps {
  catalog: LabCatalog;
  /** Flujos y nodos a iluminar (por ejemplo el camino recorrido en el laboratorio). */
  highlight?: { flowId: string; nodeIds: string[] }[];
  /** Al hacer clic en una tarjeta. Por defecto abre el flujo en el editor. */
  onOpenFlow?: (flowId: string) => void;
  /** Versión reducida para incrustar: tarjetas pequeñas, sin panel de avisos ni controles de filtro. */
  compact?: boolean;
  /** Secuencias del espacio, para mostrar sus nombres y validar las inscripciones. */
  sequences?: ReadonlyArray<{ id: string; name: string }>;
}

const nodeTypes: NodeTypes = {
  lane: LaneNode,
  flow: FlowCardNode,
  stage: StageNode,
  caseType: CaseTypeNode,
  close: CloseNode,
  sequence: SequenceNode,
};

/** Color de cada tipo de conexión (se lee bien en claro y en oscuro). */
export const CONNECTION_COLORS: Record<ConnectionKind, string> = {
  goto: "#3b82f6",
  stage: "#f59e0b",
  sequence: "#8b5cf6",
  closed: "#14b8a6",
};

export function FlowMap(props: FlowMapProps) {
  return (
    <ReactFlowProvider>
      <FlowMapInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowMapInner({ catalog, highlight, onOpenFlow, compact = false, sequences }: FlowMapProps) {
  const router = useRouter();
  const { fitView } = useReactFlow();
  const [onlyPublished, setOnlyPublished] = useState(false);
  const [selectedWarningId, setSelectedWarningId] = useState<string | null>(null);
  const [hoverFlowId, setHoverFlowId] = useState<string | null>(null);

  const fullModel = useMemo(() => buildFlowMap(catalog, { sequences }), [catalog, sequences]);
  const model: FlowMapModel = useMemo(() => (onlyPublished ? filterPublished(fullModel) : fullModel), [fullModel, onlyPublished]);
  const layout = useMemo(() => layoutFlowMap(model, { compact }), [model, compact]);

  const cardById = useMemo(() => new Map(model.cards.map((c) => [c.id, c])), [model]);
  const flowNames = useMemo(() => new Map(fullModel.cards.map((c) => [c.id, c.name])), [fullModel]);
  const stageById = useMemo(() => new Map(model.caseTypes.flatMap((t) => t.stages.map((s) => [s.id, s] as const))), [model]);
  const caseTypeById = useMemo(() => new Map(model.caseTypes.map((t) => [t.id, t])), [model]);
  const sequenceById = useMemo(() => new Map(model.sequences.map((s) => [s.id, s])), [model]);

  const activeWarning = model.warnings.find((w) => w.id === selectedWarningId) ?? null;

  const visitedByFlow = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const h of highlight ?? []) map.set(h.flowId, [...(map.get(h.flowId) ?? []), ...h.nodeIds]);
    return map;
  }, [highlight]);

  // Flujos "encendidos": los del camino recorrido, los del aviso elegido y el que tiene el cursor encima.
  const litFlows = useMemo(() => {
    const set = new Set<string>(visitedByFlow.keys());
    for (const id of activeWarning?.flowIds ?? []) set.add(id);
    if (hoverFlowId) set.add(hoverFlowId);
    return set;
  }, [visitedByFlow, activeWarning, hoverFlowId]);
  const flaggedFlows = useMemo(() => new Set(activeWarning?.flowIds ?? []), [activeWarning]);

  const { litEdgeIds, litNodeIds } = useMemo(() => {
    const edgeIds = new Set<string>();
    const nodeIds = new Set<string>();
    for (const id of litFlows) nodeIds.add(flowNodeId(id));
    for (const c of model.connections) {
      const touches = litFlows.has(c.flowId) || nodeIds.has(c.from) || nodeIds.has(c.to);
      if (!touches) continue;
      edgeIds.add(c.id);
      nodeIds.add(c.from);
      nodeIds.add(c.to);
    }
    return { litEdgeIds: edgeIds, litNodeIds: nodeIds };
  }, [litFlows, model.connections]);
  const anyLit = litFlows.size > 0;

  const nodes = useMemo<Node[]>(() => {
    const emphasisOf = (id: string): MapEmphasis => (!anyLit ? "none" : litNodeIds.has(id) ? "lit" : "dim");
    const out: Node[] = [];
    for (const n of layout.nodes) {
      const base = { id: n.id, position: { x: n.x, y: n.y }, width: n.width, height: n.height, draggable: false, selectable: false, connectable: false };
      switch (n.kind) {
        case "lane":
          out.push({ ...base, type: "lane", zIndex: -1, focusable: false, style: { pointerEvents: "none" }, data: { title: n.ref, compact } satisfies LaneNodeData });
          break;
        case "flow": {
          const card = cardById.get(n.ref);
          if (!card) break;
          out.push({
            ...base,
            type: "flow",
            data: {
              card,
              compact,
              emphasis: emphasisOf(n.id),
              flagged: flaggedFlows.has(card.id),
              visitedNodeIds: visitedByFlow.get(card.id) ?? [],
            } satisfies FlowCardNodeData,
          });
          break;
        }
        case "stage": {
          const stage = stageById.get(n.ref);
          if (!stage) break;
          out.push({
            ...base,
            type: "stage",
            data: {
              stage,
              activates: stage.activatesFlowIds.map((id) => flowNames.get(id) ?? id),
              compact,
              emphasis: emphasisOf(n.id),
            } satisfies StageNodeData,
          });
          break;
        }
        case "caseType": {
          const ct = caseTypeById.get(n.ref);
          if (!ct) break;
          out.push({
            ...base,
            type: "caseType",
            data: { title: ct.name, subtitle: `${ct.stages.length} etapas`, compact, emphasis: emphasisOf(n.id) } satisfies InfoNodeData,
          });
          break;
        }
        case "close": {
          const ct = caseTypeById.get(n.ref);
          if (!ct) break;
          out.push({
            ...base,
            type: "close",
            data: {
              title: "Cierre de gestión",
              subtitle: ct.closeFlowIds.length > 0 ? `Activa ${ct.closeFlowIds.length === 1 ? "1 flujo" : `${ct.closeFlowIds.length} flujos`}` : "No activa flujos",
              compact,
              emphasis: emphasisOf(n.id),
            } satisfies InfoNodeData,
          });
          break;
        }
        case "sequence": {
          const seq = sequenceById.get(n.ref);
          if (!seq) break;
          out.push({
            ...base,
            type: "sequence",
            data: { title: seq.name, subtitle: "Secuencia", compact, emphasis: emphasisOf(n.id) } satisfies InfoNodeData,
          });
          break;
        }
      }
    }
    return out;
  }, [layout.nodes, cardById, stageById, caseTypeById, sequenceById, flowNames, compact, anyLit, litNodeIds, flaggedFlows, visitedByFlow]);

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((e) => {
        const color = CONNECTION_COLORS[e.connection.kind];
        const lit = anyLit && litEdgeIds.has(e.id);
        const dim = anyLit && !lit;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          type: "smoothstep",
          animated: lit,
          zIndex: lit ? 10 : 0,
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
          style: { stroke: color, strokeWidth: lit ? 2.5 : 1.6, opacity: dim ? 0.12 : 0.9 },
          label: lit && !compact ? e.connection.label : undefined,
          labelStyle: { fontSize: 11, fill: "var(--foreground)" },
          labelBgStyle: { fill: "var(--card)", fillOpacity: 0.95 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 6,
        } satisfies Edge;
      }),
    [layout.edges, anyLit, litEdgeIds, compact],
  );

  const open = useCallback(
    (flowId: string) => {
      if (onOpenFlow) onOpenFlow(flowId);
      else router.push(`/dashboard/flows/${flowId}`);
    },
    [onOpenFlow, router],
  );

  // Encuadre: el camino iluminado si lo hay; si no, todo el mapa.
  const highlightKey = useMemo(() => [...visitedByFlow.keys()].sort().join(","), [visitedByFlow]);
  useEffect(() => {
    const ids = highlightKey ? highlightKey.split(",").map(flowNodeId).filter((id) => layout.nodes.some((n) => n.id === id)) : [];
    const handle = window.setTimeout(() => {
      void fitView({ nodes: ids.length > 0 ? ids.map((id) => ({ id })) : undefined, padding: compact ? 0.15 : 0.1, maxZoom: 1.1, duration: 300 });
    }, 50);
    return () => window.clearTimeout(handle);
  }, [layout, highlightKey, compact, fitView]);

  const selectWarning = useCallback(
    (warning: MapWarning | null) => {
      setSelectedWarningId(warning?.id ?? null);
      if (!warning) return;
      const ids = warning.flowIds.map(flowNodeId).filter((id) => layout.nodes.some((n) => n.id === id));
      if (ids.length > 0) void fitView({ nodes: ids.map((id) => ({ id })), padding: 0.5, maxZoom: 1.1, duration: 400 });
    },
    [fitView, layout.nodes],
  );

  const flowCount = model.cards.length;
  const canvas = (
    <div className="relative h-full min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.1}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          if (node.type === "flow") open((node.data as FlowCardNodeData).card.id);
        }}
        onNodeMouseEnter={(_, node) => {
          if (node.type === "flow") setHoverFlowId((node.data as FlowCardNodeData).card.id);
        }}
        onNodeMouseLeave={() => setHoverFlowId(null)}
        onPaneClick={() => setSelectedWarningId(null)}
        className="bg-background"
      >
        <Background gap={16} size={1} className="!bg-background" />
        <Controls
          showInteractive={false}
          className="!border-border !bg-card !shadow-sm [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground [&>button:hover]:!bg-accent"
        />
        {!compact && (
          <MiniMap
            pannable
            zoomable
            className="!border-border !bg-card"
            maskColor="rgba(0, 0, 0, 0.1)"
            nodeColor={(node) => {
              if (node.type === "lane") return "rgba(148, 163, 184, 0.18)";
              if (node.type === "flow") return (node.data as FlowCardNodeData).card.status === "published" ? "#10b981" : "#94a3b8";
              if (node.type === "stage") return "#f59e0b";
              if (node.type === "sequence") return "#8b5cf6";
              return "#6366f1";
            }}
          />
        )}
        {!compact && (
          <Panel position="top-left" className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setOnlyPublished(false)}
                aria-pressed={!onlyPublished}
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", !onlyPublished ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setOnlyPublished(true)}
                aria-pressed={onlyPublished}
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", onlyPublished ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                Solo publicados
              </button>
            </div>
            <button
              type="button"
              onClick={() => void fitView({ padding: 0.1, duration: 300 })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Ajustar a pantalla
            </button>
            <span className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
              {flowCount} {flowCount === 1 ? "flujo" : "flujos"}
            </span>
          </Panel>
        )}
        {!compact && <Legend />}
        {flowCount === 0 && (
          <Panel position="top-center" className="mt-24 rounded-xl border border-dashed border-border bg-card px-6 py-4 text-sm text-muted-foreground">
            {onlyPublished ? "No hay flujos publicados." : "Aún no hay flujos en este espacio."}
          </Panel>
        )}
      </ReactFlow>
    </div>
  );

  if (compact) return <div className="h-full w-full">{canvas}</div>;

  return (
    <div className="flex h-full w-full min-h-0">
      {canvas}
      <WarningsPanel warnings={model.warnings} flowNames={flowNames} selectedId={activeWarning?.id ?? null} onSelect={selectWarning} />
    </div>
  );
}

function Legend() {
  return (
    <Panel position="top-right" className="rounded-xl border border-border bg-card/95 px-3 py-2.5 shadow-sm">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Conexiones</p>
      <ul className="space-y-1">
        {(Object.keys(CONNECTION_LABELS) as ConnectionKind[]).map((kind) => (
          <li key={kind} className="flex items-center gap-2 text-xs">
            <span className="h-0.5 w-6 rounded-full" style={{ backgroundColor: CONNECTION_COLORS[kind] }} />
            {CONNECTION_LABELS[kind]}
          </li>
        ))}
      </ul>
      <p className="mt-2 border-t border-border pt-2 text-[11px] leading-snug text-muted-foreground">
        Borde punteado: borrador.
        <br />
        Rayo: flujo que se activa en esa etapa.
      </p>
    </Panel>
  );
}
