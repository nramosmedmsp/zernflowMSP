"use client";

// Árbol de decisiones del explorador: cada rama lleva la elección (botón,
// respuesta, variante) y cada hoja el camino que termina ahí.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Clock, Flag, GitBranch, Hand, MousePointerClick, PhoneOff, Play, SlidersHorizontal, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { END_KIND_LABELS, type ExploreEndKind, type ExploreTreeNode } from "@/lib/flow-lab/explorer/types";

export const END_BADGE: Record<ExploreEndKind, string> = {
  flow_end: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  waiting: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  human: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  goto: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  error: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  depth_limit: "bg-muted text-muted-foreground",
  cycle: "bg-muted text-muted-foreground",
  path_limit: "bg-muted text-muted-foreground",
};

function KindIcon({ kind }: { kind: ExploreTreeNode["kind"] }) {
  const cls = "h-3.5 w-3.5 shrink-0 text-muted-foreground";
  switch (kind) {
    case "variant":
      return <SlidersHorizontal className={cls} />;
    case "start":
      return <Play className={cls} />;
    case "button":
      return <MousePointerClick className={cls} />;
    case "text":
      return <Type className={cls} />;
    case "time":
      return <Clock className={cls} />;
    case "no_reply":
      return <PhoneOff className={cls} />;
    default:
      return <GitBranch className={cls} />;
  }
}

/** Ids de los nodos con hijos (para expandir y colapsar todo). */
function branchIds(node: ExploreTreeNode, out: string[] = []): string[] {
  if (node.children.length > 0) out.push(node.id);
  for (const c of node.children) branchIds(c, out);
  return out;
}

export function PathTree({
  tree,
  selectedPathId,
  selectedIds,
  onSelect,
}: {
  tree: ExploreTreeNode;
  selectedPathId: number | null;
  /** Nodos del camino elegido. */
  selectedIds: ReadonlySet<string>;
  onSelect: (pathId: number) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const allBranches = useMemo(() => branchIds(tree), [tree]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Árbol de decisiones</p>
        <div className="flex gap-1 text-[11px]">
          <button type="button" className="rounded border border-border px-2 py-0.5 hover:bg-accent" onClick={() => setCollapsed(new Set())}>
            Expandir todo
          </button>
          <button type="button" className="rounded border border-border px-2 py-0.5 hover:bg-accent" onClick={() => setCollapsed(new Set(allBranches))}>
            Colapsar todo
          </button>
        </div>
      </div>
      <ul className="space-y-0.5">
        {tree.children.map((child) => (
          <TreeRow key={child.id} node={child} depth={0} collapsed={collapsed} onToggle={toggle} selectedPathId={selectedPathId} selectedIds={selectedIds} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
  selectedPathId,
  selectedIds,
  onSelect,
}: {
  node: ExploreTreeNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  selectedPathId: number | null;
  selectedIds: ReadonlySet<string>;
  onSelect: (pathId: number) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const onPath = selectedIds.has(node.id);
  const isLeaf = node.pathId !== undefined;
  const selected = isLeaf && node.pathId === selectedPathId;

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm",
          onPath && "bg-primary/5",
          selected && "bg-primary/10 ring-1 ring-primary/40",
          isLeaf && "cursor-pointer hover:bg-accent",
          node.skipped && "opacity-60",
        )}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={isLeaf ? () => onSelect(node.pathId!) : undefined}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={isCollapsed ? "Expandir" : "Colapsar"}
            aria-expanded={!isCollapsed}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent"
          >
            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-[18px] shrink-0" />
        )}
        <KindIcon kind={node.kind} />
        <span className={cn("min-w-0 flex-1 truncate", onPath && "font-medium", node.kind === "variant" && "font-semibold")} title={node.label}>
          {node.label}
        </span>
        {isLeaf && node.endKind && (
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", END_BADGE[node.endKind])} title={END_KIND_LABELS[node.endKind]}>
            <Flag className="h-2.5 w-2.5" />#{node.pathId} · {END_KIND_LABELS[node.endKind]}
          </span>
        )}
        {node.skipped && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground" title="No se exploró: se alcanzó el máximo de caminos">
            <Hand className="h-2.5 w-2.5" />
            Sin explorar
          </span>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} selectedPathId={selectedPathId} selectedIds={selectedIds} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}
