"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Flag, GitBranch, ListTree, Workflow, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowCard, MapStage } from "@/lib/flow-lab/map/types";

/** Estado visual de un nodo cuando hay algo resaltado en el mapa. */
export type MapEmphasis = "none" | "lit" | "dim";

const SIDES: Array<[string, Position]> = [
  ["t", Position.Top],
  ["b", Position.Bottom],
  ["l", Position.Left],
  ["r", Position.Right],
];

/** Un punto de conexión invisible por lado y por sentido: las conexiones eligen el lado más corto. */
function Anchors() {
  return (
    <>
      {SIDES.map(([side, position]) => (
        <span key={side}>
          <Handle id={`${side}-s`} type="source" position={position} isConnectable={false} className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
          <Handle id={`${side}-t`} type="target" position={position} isConnectable={false} className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent !opacity-0" />
        </span>
      ))}
    </>
  );
}

const emphasisClass: Record<MapEmphasis, string> = {
  none: "",
  lit: "",
  dim: "opacity-35",
};

// ── Carril ──────────────────────────────────────────────────────────────────

export interface LaneNodeData {
  title: string;
  compact: boolean;
  [key: string]: unknown;
}

export function LaneNode({ data, width, height }: NodeProps) {
  const d = data as LaneNodeData;
  return (
    <div style={{ width, height }} className="rounded-2xl border border-border/70 bg-muted/40 dark:bg-muted/20">
      <p className={cn("px-5 font-semibold text-muted-foreground", d.compact ? "pt-2 text-[11px]" : "pt-3.5 text-xs uppercase tracking-wide")}>{d.title}</p>
    </div>
  );
}

// ── Tarjeta de flujo ────────────────────────────────────────────────────────

export interface FlowCardNodeData {
  card: FlowCard;
  compact: boolean;
  emphasis: MapEmphasis;
  /** Resaltado por un aviso seleccionado. */
  flagged: boolean;
  /** Nodos del flujo recorridos (lo pasa el laboratorio). */
  visitedNodeIds: string[];
  [key: string]: unknown;
}

export function FlowCardNode({ data }: NodeProps) {
  const { card, compact, emphasis, flagged, visitedNodeIds } = data as FlowCardNodeData;
  const published = card.status === "published";
  const visited = new Set(visitedNodeIds);
  const traversed = visited.size > 0;
  const dots = card.nodeIds.slice(0, 28);

  return (
    <div
      className={cn(
        "relative h-full w-full cursor-pointer overflow-hidden rounded-xl border bg-card px-3 shadow-sm transition-[opacity,box-shadow,border-color]",
        compact ? "py-2" : "py-3",
        published ? "border-border" : "border-dashed border-border",
        "hover:border-primary/60 hover:shadow-md",
        traversed && "border-primary shadow-md ring-2 ring-primary/40",
        flagged && "border-amber-500 ring-2 ring-amber-500/50",
        emphasis === "lit" && !traversed && !flagged && "border-primary/70",
        emphasisClass[emphasis],
      )}
    >
      <Anchors />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className={cn("truncate font-medium", compact ? "text-xs" : "text-sm")} title={card.name}>
            {card.name}
          </p>
        </div>
        {compact ? (
          <span
            className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", published ? "bg-emerald-500" : "bg-muted-foreground/40")}
            title={published ? "Publicado" : "Borrador"}
          />
        ) : (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
              published ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-muted text-muted-foreground",
            )}
          >
            {published ? "Publicado" : "Borrador"}
          </span>
        )}
      </div>

      <p className={cn("mt-1 text-muted-foreground", compact ? "truncate text-[11px]" : "line-clamp-2 text-xs")} title={card.triggerSummary}>
        {card.triggerSummary}
      </p>

      {!compact && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {card.activatedBy.length > 0 && (
              <span
                className="inline-flex min-w-0 items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                title={card.activatedBy.map((s) => `${s.caseTypeName} › ${s.stageName}`).join(", ")}
              >
                <Zap className="h-3 w-3 shrink-0" />
                <span className="truncate">{card.activatedBy.map((s) => s.stageName).join(", ")}</span>
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
            {card.warningCount > 0 && (
              <span
                className="inline-flex items-center gap-0.5 rounded-md bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                title={`${card.warningCount} ${card.warningCount === 1 ? "aviso" : "avisos"}`}
              >
                <AlertTriangle className="h-3 w-3" />
                {card.warningCount}
              </span>
            )}
            <span>{card.nodeCount} {card.nodeCount === 1 ? "nodo" : "nodos"}</span>
          </div>
        </div>
      )}
      {compact && card.warningCount > 0 && (
        <span className="absolute right-2 top-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          {card.warningCount}
        </span>
      )}

      {traversed && (
        <div className="mt-2 flex flex-wrap items-center gap-[3px]" title={`${visited.size} ${visited.size === 1 ? "nodo recorrido" : "nodos recorridos"}`}>
          {dots.map((id) => (
            <span key={id} className={cn("h-1.5 w-1.5 rounded-full", visited.has(id) ? "bg-primary" : "bg-muted-foreground/25")} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Etapas, tipo de gestión, cierre y secuencias ────────────────────────────

const stageKindStyle: Record<string, { label: string; dot: string }> = {
  open: { label: "Abierta", dot: "bg-sky-500" },
  won: { label: "Ganada", dot: "bg-emerald-500" },
  lost: { label: "Perdida", dot: "bg-rose-500" },
  resolved: { label: "Resuelta", dot: "bg-teal-500" },
};

export interface StageNodeData {
  stage: MapStage;
  /** Nombres de los flujos que se activan al llegar a esta etapa. */
  activates: string[];
  compact: boolean;
  emphasis: MapEmphasis;
  [key: string]: unknown;
}

export function StageNode({ data }: NodeProps) {
  const { stage, activates, compact, emphasis } = data as StageNodeData;
  const kind = stageKindStyle[stage.kind] ?? stageKindStyle.open;
  return (
    <div
      className={cn(
        "h-full w-full overflow-hidden rounded-lg border border-border bg-card px-3 transition-opacity",
        compact ? "py-1.5" : "py-2",
        activates.length > 0 && "border-amber-500/60",
        emphasis === "lit" && "border-primary/70",
        emphasisClass[emphasis],
      )}
    >
      <Anchors />
      <div className="flex items-center gap-1.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", kind.dot)} title={kind.label} />
        <p className={cn("truncate font-medium", compact ? "text-xs" : "text-[13px]")} title={stage.name}>
          {stage.name}
        </p>
      </div>
      {!compact && (
        <p className="mt-1 truncate text-[11px] text-muted-foreground" title={activates.join(", ")}>
          {activates.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <Zap className="h-3 w-3" />
              Activa {activates.length === 1 ? `«${activates[0]}»` : `${activates.length} flujos`}
            </span>
          ) : (
            kind.label
          )}
        </p>
      )}
    </div>
  );
}

export interface InfoNodeData {
  title: string;
  subtitle?: string;
  compact: boolean;
  emphasis: MapEmphasis;
  [key: string]: unknown;
}

export function CaseTypeNode({ data }: NodeProps) {
  const { title, subtitle, compact, emphasis } = data as InfoNodeData;
  return (
    <div className={cn("flex h-full w-full flex-col justify-center rounded-lg bg-primary px-3 text-primary-foreground transition-opacity", emphasisClass[emphasis])}>
      <Anchors />
      <div className="flex items-center gap-1.5">
        <ListTree className="h-3.5 w-3.5 shrink-0" />
        <p className={cn("truncate font-semibold", compact ? "text-xs" : "text-sm")}>{title}</p>
      </div>
      {!compact && subtitle && <p className="mt-0.5 truncate text-[11px] opacity-80">{subtitle}</p>}
    </div>
  );
}

export function CloseNode({ data }: NodeProps) {
  const { title, subtitle, compact, emphasis } = data as InfoNodeData;
  return (
    <div className={cn("flex h-full w-full flex-col justify-center rounded-lg border border-dashed border-slate-400 bg-card px-3 transition-opacity dark:border-slate-500", emphasisClass[emphasis])}>
      <Anchors />
      <div className="flex items-center gap-1.5">
        <Flag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className={cn("truncate font-medium", compact ? "text-xs" : "text-[13px]")}>{title}</p>
      </div>
      {!compact && subtitle && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function SequenceNode({ data }: NodeProps) {
  const { title, subtitle, compact, emphasis } = data as InfoNodeData;
  return (
    <div className={cn("flex h-full w-full flex-col justify-center rounded-lg border border-violet-400/70 bg-violet-50 px-3 transition-opacity dark:bg-violet-950/30", emphasisClass[emphasis])}>
      <Anchors />
      <div className="flex items-center gap-1.5">
        <Workflow className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
        <p className={cn("truncate font-medium", compact ? "text-xs" : "text-[13px]")}>{title}</p>
      </div>
      {!compact && subtitle && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
