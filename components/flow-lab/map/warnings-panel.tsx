"use client";

import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MapWarning, WarningSeverity } from "@/lib/flow-lab/map/types";

const severityStyle: Record<WarningSeverity, { label: string; icon: typeof Info; text: string; bg: string }> = {
  error: { label: "Errores", icon: AlertOctagon, text: "text-red-600 dark:text-red-400", bg: "bg-red-100 dark:bg-red-900/30" },
  warning: { label: "Avisos", icon: AlertTriangle, text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30" },
  info: { label: "Para revisar", icon: Info, text: "text-sky-600 dark:text-sky-400", bg: "bg-sky-100 dark:bg-sky-900/30" },
};

interface WarningsPanelProps {
  warnings: MapWarning[];
  flowNames: Map<string, string>;
  selectedId: string | null;
  onSelect: (warning: MapWarning | null) => void;
}

export function WarningsPanel({ warnings, flowNames, selectedId, onSelect }: WarningsPanelProps) {
  const groups = (["error", "warning", "info"] as const)
    .map((severity) => ({ severity, items: warnings.filter((w) => w.severity === severity) }))
    .filter((g) => g.items.length > 0);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Avisos</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {warnings.length === 0
            ? "Todo en orden."
            : `${warnings.length} ${warnings.length === 1 ? "cosa por revisar" : "cosas por revisar"}. Haz clic en una para verla en el mapa.`}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {warnings.length === 0 && (
          <div className="mt-8 flex flex-col items-center gap-2 px-4 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            No encontramos palabras clave repetidas, caminos sin salida ni datos pendientes.
          </div>
        )}
        {groups.map(({ severity, items }) => {
          const style = severityStyle[severity];
          return (
            <section key={severity} className="mb-4">
              <h3 className={cn("mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide", style.text)}>
                {style.label} ({items.length})
              </h3>
              <ul className="space-y-1.5">
                {items.map((w) => {
                  const Icon = style.icon;
                  const selected = w.id === selectedId;
                  return (
                    <li key={w.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(selected ? null : w)}
                        aria-pressed={selected}
                        className={cn(
                          "w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent",
                          selected ? "border-primary bg-accent" : "border-border",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md", style.bg)}>
                            <Icon className={cn("h-3 w-3", style.text)} />
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-medium leading-snug">{w.title}</p>
                            <p className={cn("mt-1 text-xs leading-snug text-muted-foreground", !selected && "line-clamp-2")}>{w.message}</p>
                            {selected && w.flowIds.length > 0 && (
                              <p className="mt-1.5 text-[11px] text-muted-foreground">
                                Flujos: {w.flowIds.map((id) => flowNames.get(id) ?? id).join(", ")}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
