"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_KIND_LABELS, type StageConfig } from "./config-rules";
import { KIND_BADGE } from "./shared";

/** Cómo se verá el embudo: las etapas activas en orden, primero las abiertas y al final los cierres. */
export function FunnelPreview({ stages }: { stages: StageConfig[] }) {
  const active = [...stages].filter((s) => !s.archived).sort((a, b) => a.position - b.position);
  const open = active.filter((s) => s.kind === "open");
  const closing = active.filter((s) => s.kind !== "open");

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Vista previa del embudo">
      <h3 className="text-sm font-semibold">Vista previa del embudo</h3>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">Así verá el equipo las etapas, en este orden.</p>

      {active.length === 0 ? (
        <p className="text-xs text-muted-foreground">Este tipo no tiene etapas activas.</p>
      ) : (
        <div className="space-y-3">
          <ol className="flex flex-wrap items-center gap-y-2">
            {open.map((s, i) => (
              <li key={s.id} className="flex items-center">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color ?? "#9ca3af" }} />
                  {s.name}
                </span>
                {i < open.length - 1 && <ChevronRight className="mx-1 h-4 w-4 text-muted-foreground" aria-hidden />}
              </li>
            ))}
            {open.length === 0 && <li className="text-xs text-destructive">Falta una etapa abierta.</li>}
          </ol>

          {closing.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-3">
              <span className="text-xs text-muted-foreground">Cierres:</span>
              {closing.map((s) => (
                <span key={s.id} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium", KIND_BADGE[s.kind])}>
                  {s.name}
                  <span className="opacity-70">· {STAGE_KIND_LABELS[s.kind].toLowerCase()}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
