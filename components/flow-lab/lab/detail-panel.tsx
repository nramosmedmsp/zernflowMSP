"use client";

// Panel de detalle: traza, gestión y contacto, y mapa de los flujos.

import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, CheckCircle2, Circle, Info, MapPin, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatTime } from "@/lib/format";
import type { LabCatalog } from "@/lib/flow-lab/types";
import { FlowMap } from "@/components/flow-lab/map/flow-map";
import { changedLabels, countWarnings, diffSnapshots, readableSteps, type Highlight, type LabEntry, type ReadableStep, type SnapshotField } from "./lab-model";

export type DetailTab = "trace" | "case" | "map";

export interface Selection {
  /** Posición de la acción en el historial (null = ninguna). */
  entry: number | null;
  /** Número del paso dentro de esa acción (null = toda la acción). */
  step: number | null;
}

const TABS: { id: DetailTab; label: string }[] = [
  { id: "trace", label: "Traza" },
  { id: "case", label: "Gestión y contacto" },
  { id: "map", label: "Mapa" },
];

function LevelIcon({ level }: { level: ReadableStep["level"] }) {
  const cls = "mt-0.5 h-3.5 w-3.5 flex-shrink-0";
  if (level === "ok") return <CheckCircle2 className={cn(cls, "text-emerald-600")} />;
  if (level === "warning") return <AlertTriangle className={cn(cls, "text-amber-600")} />;
  if (level === "error") return <XCircle className={cn(cls, "text-destructive")} />;
  return <Info className={cn(cls, "text-muted-foreground")} />;
}

function StepRow({
  step,
  entry,
  selection,
  onSelect,
  onShowMap,
  child,
}: {
  step: ReadableStep;
  entry: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onShowMap: () => void;
  child?: boolean;
}) {
  const selected = selection.entry === entry && selection.step === step.n;
  const hasNodes = step.highlight.length > 0 || step.children.some((c) => c.highlight.length > 0);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect({ entry, step: step.n })}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect({ entry, step: step.n })}
        className={cn(
          "flex cursor-pointer gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent/60",
          selected && "bg-primary/10 ring-1 ring-primary/40",
          step.level === "warning" && !selected && "bg-amber-50 dark:bg-amber-950/30",
          step.level === "error" && !selected && "bg-destructive/10",
          child && "ml-4",
        )}
      >
        <LevelIcon level={step.level} />
        <div className="min-w-0 flex-1">
          <p className={cn("break-words", step.kind === "node" && "font-medium")}>{step.text}</p>
          {step.details.length > 0 && (
            <ul className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
              {step.details.map((d, i) => (
                <li key={i} className="break-words">
                  {d}
                </li>
              ))}
            </ul>
          )}
          {selected && hasNodes && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onShowMap();
              }}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <MapPin className="h-3 w-3" />
              Ver en el mapa
            </button>
          )}
        </div>
        <span className="flex-shrink-0 text-[10px] tabular-nums text-muted-foreground">{formatTime(step.at)}</span>
      </div>
      {step.children.length > 0 && (
        <ul className="space-y-0.5">
          {step.children.map((c) => (
            <StepRow key={c.n} step={c} entry={entry} selection={selection} onSelect={onSelect} onShowMap={onShowMap} child />
          ))}
        </ul>
      )}
    </li>
  );
}

function TraceTab({ entries, selection, onSelect, onShowMap }: { entries: LabEntry[]; selection: Selection; onSelect: (s: Selection) => void; onShowMap: () => void }) {
  const rows = useMemo(() => entries.map((e) => readableSteps(e.trace)), [entries]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  if (entries.length === 0) return <p className="p-6 text-center text-sm text-muted-foreground">Aún no hay nada que mostrar. Escribe un mensaje como cliente o avanza el tiempo.</p>;
  return (
    <div className="space-y-3 p-3">
      {entries.map((e, i) => {
        const warnings = countWarnings(e.trace);
        const selected = selection.entry === i && selection.step === null;
        return (
          <section key={i} className="rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => onSelect({ entry: i, step: null })}
              className={cn("flex w-full items-start justify-between gap-2 rounded-t-lg border-b border-border px-3 py-2 text-left hover:bg-accent/60", selected && "bg-primary/10")}
            >
              <span className="text-sm font-medium">
                <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                {e.trace.title}
              </span>
              <span className="flex flex-shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                {warnings > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3" />
                    {warnings}
                  </span>
                )}
                {formatDateTime(e.trace.startedAt)}
              </span>
            </button>
            <ul className="space-y-0.5 p-1.5">
              {rows[i].map((step) => (
                <StepRow key={step.n} step={step} entry={i} selection={selection} onSelect={onSelect} onShowMap={onShowMap} />
              ))}
            </ul>
          </section>
        );
      })}
      <div ref={end} />
    </div>
  );
}

function CaseTab({ entries, initialSnapshot, currentSnapshot, selection }: { entries: LabEntry[]; initialSnapshot: SnapshotField[]; currentSnapshot: SnapshotField[]; selection: Selection }) {
  const index = selection.entry ?? entries.length - 1;
  const after = index >= 0 ? (entries[index]?.snapshot ?? currentSnapshot) : initialSnapshot;
  const before = index > 0 ? entries[index - 1].snapshot : index === 0 ? initialSnapshot : null;
  const sections = useMemo(() => diffSnapshots(before, after), [before, after]);
  const changed = useMemo(() => changedLabels(sections), [sections]);

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs text-muted-foreground">
        {index >= 0 && entries[index] ? (
          <>
            Después de: <span className="font-medium text-foreground">{entries[index].trace.title}</span>
          </>
        ) : (
          "Estado inicial de la prueba."
        )}
        {before && (changed.length > 0 ? ` · ${changed.length} ${changed.length === 1 ? "cambio" : "cambios"} respecto del paso anterior` : " · sin cambios respecto del paso anterior")}
      </p>
      {sections.map((section) => (
        <section key={section.title} className="rounded-lg border border-border bg-card">
          <h4 className="border-b border-border px-3 py-1.5 text-xs font-semibold">{section.title}</h4>
          <dl className="divide-y divide-border/60">
            {section.fields.map((f) => (
              <div key={f.k} className={cn("flex items-start justify-between gap-3 px-3 py-1 text-xs", f.changed && "bg-amber-50 dark:bg-amber-950/30")}>
                <dt className="text-muted-foreground">{f.l}</dt>
                <dd className={cn("text-right", f.changed && "font-semibold")}>
                  {f.changed && f.previous !== undefined && <span className="mr-1.5 text-muted-foreground line-through">{f.previous}</span>}
                  {f.v}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function DetailPanel({
  catalog,
  entries,
  initialSnapshot,
  currentSnapshot,
  selection,
  onSelect,
  tab,
  onTab,
  highlight,
  highlightLabel,
}: {
  catalog: LabCatalog;
  entries: LabEntry[];
  initialSnapshot: SnapshotField[];
  currentSnapshot: SnapshotField[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
  highlight: Highlight;
  highlightLabel: string;
}) {
  return (
    <div className="flex h-full min-h-[480px] flex-col overflow-hidden rounded-xl border border-border bg-background">
      <div role="tablist" className="flex border-b border-border bg-card">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => onTab(t.id)}
            className={cn("border-b-2 px-4 py-2 text-sm font-medium transition-colors", tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "trace" && <TraceTab entries={entries} selection={selection} onSelect={onSelect} onShowMap={() => onTab("map")} />}
        {tab === "case" && <CaseTab entries={entries} initialSnapshot={initialSnapshot} currentSnapshot={currentSnapshot} selection={selection} />}
        {tab === "map" && (
          <div className="flex h-full min-h-[460px] flex-col">
            <p className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              <Circle className="h-3 w-3 fill-amber-400 text-amber-500" />
              {highlight.length > 0 ? highlightLabel : "Aún no se recorrió ningún nodo."}
            </p>
            <div className="min-h-0 flex-1">
              <FlowMap catalog={catalog} highlight={highlight} compact onOpenFlow={(id) => window.open(`/dashboard/flows/${id}`, "_blank", "noopener")} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
