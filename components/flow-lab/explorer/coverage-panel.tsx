"use client";

// Cobertura: qué nodos y salidas de condición no recorrió ningún camino. Al
// hacer clic en uno se resalta en el mapa.

import { CheckCircle2, CircleSlash } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExploreCoverage } from "@/lib/flow-lab/explorer/types";

export interface CoverageFocus {
  flowId: string;
  nodeId: string;
  label: string;
}

export function CoveragePanel({ coverage, focus, onFocus }: { coverage: ExploreCoverage; focus: CoverageFocus | null; onFocus: (focus: CoverageFocus | null) => void }) {
  const nodes = `${coverage.nodesReached} de ${coverage.nodesTotal} nodos`;
  const outputs = coverage.outputsTotal > 0 ? ` y ${coverage.outputsReached} de ${coverage.outputsTotal} salidas de condición` : "";
  return (
    <section aria-label="Cobertura" className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cobertura</p>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", coverage.complete ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300")}>
          {coverage.percent} %
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={coverage.percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", coverage.complete ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${coverage.percent}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Recorridos {nodes}
        {outputs}.
      </p>

      {coverage.complete ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          Los caminos recorren todo el flujo.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {coverage.unreachedNodes.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium">Nodos sin recorrer ({coverage.unreachedNodes.length})</p>
              <ul className="space-y-0.5">
                {coverage.unreachedNodes.map((n) => (
                  <li key={n.nodeId}>
                    <FocusButton active={focus?.nodeId === n.nodeId} onClick={() => onFocus(focus?.nodeId === n.nodeId ? null : { flowId: n.flowId, nodeId: n.nodeId, label: n.label })}>
                      <span className="truncate">{n.label}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{n.kind}</span>
                    </FocusButton>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {coverage.unreachedOutputs.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium">Salidas sin recorrer ({coverage.unreachedOutputs.length})</p>
              <ul className="space-y-0.5">
                {coverage.unreachedOutputs.map((o) => (
                  <li key={`${o.nodeId}:${o.output}`}>
                    <FocusButton active={focus?.nodeId === o.nodeId} onClick={() => onFocus(focus?.nodeId === o.nodeId ? null : { flowId: o.flowId, nodeId: o.nodeId, label: o.description })}>
                      <CircleSlash className="h-3 w-3 shrink-0 text-amber-600" />
                      <span className="truncate">{o.description}</span>
                    </FocusButton>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Haz clic en uno para resaltarlo en el mapa.</p>
        </div>
      )}
    </section>
  );
}

function FocusButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent", active && "bg-primary/10 ring-1 ring-primary/40")}
    >
      {children}
    </button>
  );
}
