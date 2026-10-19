"use client";

// Explorador de caminos: genera todos los caminos posibles de un flujo con el
// simulador (en el navegador; no se escribe en la base ni se envía nada) y
// muestra cómo termina cada uno.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Download, FlaskConical, Play, Route } from "lucide-react";
import { buildSampleProfiles } from "@/lib/flow-lab";
import {
  DEFAULT_EXPLORE_CLOCK,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_PATHS,
  END_KIND_LABELS,
  exploreFlow,
  exploreSummaryText,
  highlightOfPath,
  pathTreeIds,
  type ExploreEndKind,
  type ExploreResult,
} from "@/lib/flow-lab/explorer";
import { LAB_CHANNELS, LAB_CHANNEL_LABELS, type LabCatalog, type LabChannel } from "@/lib/flow-lab/types";
import { Field, inputClass, primaryButtonClass, secondaryButtonClass, selectClass } from "@/components/inbox/ui";
import { FlowMap } from "@/components/flow-lab/map/flow-map";
import { CoveragePanel, type CoverageFocus } from "./coverage-panel";
import { PathDetail } from "./path-detail";
import { END_BADGE, PathTree } from "./path-tree";
import { cn } from "@/lib/utils";

const AUTO_PROFILE = "auto";
const STATUS_TEXT = { draft: "Borrador", published: "Publicado", archived: "Archivado" } as const;

interface ExplorerConfig {
  flowId: string;
  profileId: string;
  channel: LabChannel;
  maxDepth: number;
  maxPaths: number;
}

function runExplore(catalog: LabCatalog, config: ExplorerConfig): { result: ExploreResult | null; error: string | null } {
  if (!config.flowId) return { result: null, error: null };
  try {
    const profile = config.profileId === AUTO_PROFILE ? undefined : buildSampleProfiles(catalog, DEFAULT_EXPLORE_CLOCK).find((p) => p.id === config.profileId);
    const result = exploreFlow(catalog, {
      flowId: config.flowId,
      profile,
      channel: config.channel,
      clock: DEFAULT_EXPLORE_CLOCK,
      maxDepth: config.maxDepth,
      maxPaths: config.maxPaths,
    });
    return { result, error: null };
  } catch (e) {
    return { result: null, error: `No se pudo explorar el flujo: ${e instanceof Error ? e.message : "error desconocido"}` };
  }
}

function toNumber(value: string, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function ExplorerScreen({
  catalog,
  focusFlowId,
  sequences,
}: {
  catalog: LabCatalog;
  focusFlowId: string | null;
  sequences?: ReadonlyArray<{ id: string; name: string }>;
}) {
  const initialFlowId = focusFlowId && catalog.flows.some((f) => f.id === focusFlowId) ? focusFlowId : "";
  const [config, setConfig] = useState<ExplorerConfig>({
    flowId: initialFlowId,
    profileId: AUTO_PROFILE,
    channel: "whatsapp",
    maxDepth: DEFAULT_MAX_DEPTH,
    maxPaths: DEFAULT_MAX_PATHS,
  });
  // Con ?flow= la exploración arranca sola (es rápida y no escribe nada).
  const [explored, setExplored] = useState(() => (initialFlowId ? runExplore(catalog, config) : { result: null as ExploreResult | null, error: null as string | null }));
  const [ranWith, setRanWith] = useState<string | null>(initialFlowId ? JSON.stringify(config) : null);
  const [selectedId, setSelectedId] = useState<number | null>(() => explored.result?.paths[0]?.id ?? null);
  const [focus, setFocus] = useState<CoverageFocus | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const profiles = useMemo(() => buildSampleProfiles(catalog, DEFAULT_EXPLORE_CLOCK), [catalog]);
  const { result, error } = explored;
  const stale = result !== null && ranWith !== JSON.stringify(config);
  const selected = result?.paths.find((p) => p.id === selectedId) ?? null;
  const selectedIds = useMemo(() => new Set(selected ? pathTreeIds(selected) : []), [selected]);

  function explore() {
    const next = runExplore(catalog, config);
    setExplored(next);
    setRanWith(JSON.stringify(config));
    setSelectedId(next.result?.paths[0]?.id ?? null);
    setFocus(null);
  }

  const highlight = focus ? [{ flowId: focus.flowId, nodeIds: [focus.nodeId] }] : selected ? highlightOfPath(selected) : [];
  const flowName = (id: string) => catalog.flows.find((f) => f.id === id)?.name ?? id;

  const endCounts = useMemo(() => {
    const counts = new Map<ExploreEndKind, number>();
    for (const p of result?.paths ?? []) counts.set(p.end.kind, (counts.get(p.end.kind) ?? 0) + 1);
    return [...counts];
  }, [result]);

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(exploreSummaryText(result));
      setCopyError(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("No se pudo copiar al portapapeles. Revisa los permisos del navegador o usa «Descargar .txt».");
    }
  }

  function download() {
    if (!result) return;
    const blob = new Blob([exploreSummaryText(result)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `caminos-${result.flowName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "flujo"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <Link href="/dashboard/flows" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Volver a Flujos">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Route className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold leading-tight">Explorador de caminos</h1>
          <p className="text-xs text-muted-foreground">Recorre todos los caminos posibles de un flujo y muestra cómo termina cada uno. No envía mensajes ni cambia nada en tu cuenta.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {config.flowId && (
            <Link href={`/dashboard/flows/lab?flow=${config.flowId}`} className={secondaryButtonClass}>
              <FlaskConical className="h-4 w-4" />
              Abrir en el laboratorio
            </Link>
          )}
          <button type="button" className={secondaryButtonClass} disabled={!result} onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiado" : "Copiar resumen"}
          </button>
          <button type="button" className={secondaryButtonClass} disabled={!result} onClick={download}>
            <Download className="h-4 w-4" />
            Descargar .txt
          </button>
        </div>
      </div>

      <div className="border-b border-border bg-card px-6 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Flujo">
            <select
              value={config.flowId}
              onChange={(e) => setConfig({ ...config, flowId: e.target.value })}
              className={cn(selectClass, "min-w-[240px] py-1.5")}
            >
              <option value="">Elige un flujo…</option>
              {catalog.flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({STATUS_TEXT[f.status] ?? f.status})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Perfil">
            <select value={config.profileId} onChange={(e) => setConfig({ ...config, profileId: e.target.value })} className={cn(selectClass, "min-w-[220px] py-1.5")}>
              <option value={AUTO_PROFILE}>Automático (el que active el flujo)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Canal">
            <select value={config.channel} onChange={(e) => setConfig({ ...config, channel: e.target.value as LabChannel })} className={cn(selectClass, "py-1.5")}>
              {LAB_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {LAB_CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pasos máx.">
            <input
              type="number"
              min={1}
              max={100}
              value={config.maxDepth}
              onChange={(e) => setConfig({ ...config, maxDepth: toNumber(e.target.value, DEFAULT_MAX_DEPTH) })}
              className={cn(inputClass, "w-20 py-1.5")}
              title="Respuestas del cliente como máximo en un camino"
            />
          </Field>
          <Field label="Caminos máx.">
            <input
              type="number"
              min={1}
              max={1000}
              value={config.maxPaths}
              onChange={(e) => setConfig({ ...config, maxPaths: toNumber(e.target.value, DEFAULT_MAX_PATHS) })}
              className={cn(inputClass, "w-24 py-1.5")}
              title="Cantidad máxima de caminos que se exploran"
            />
          </Field>
          <button type="button" className={primaryButtonClass} disabled={!config.flowId} onClick={explore}>
            <Play className="h-4 w-4" />
            Explorar
          </button>
        </div>
        {stale && (
          <p role="status" className="mt-2 text-xs text-amber-800 dark:text-amber-300">
            Cambiaste la configuración: pulsa «Explorar» para actualizar el resultado.
          </p>
        )}
        {copyError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {copyError}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="border-b border-border bg-destructive/10 px-6 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!result ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-muted-foreground">
          {config.flowId ? "Pulsa «Explorar» para generar los caminos de este flujo." : "Elige un flujo y pulsa «Explorar»."}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(340px,420px)_1fr]">
          <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border p-4 lg:border-b-0 lg:border-r">
            <section aria-label="Resumen" className="space-y-2">
              <p className="text-sm">
                <span className="font-semibold">{result.paths.length}</span> {result.paths.length === 1 ? "camino" : "caminos"} en «{result.flowName}»
                {result.profileName ? <span className="text-muted-foreground"> · perfil «{result.profileName}»</span> : null}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {endCounts.map(([kind, count]) => (
                  <span key={kind} className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", END_BADGE[kind])}>
                    {END_KIND_LABELS[kind]}: {count}
                  </span>
                ))}
              </div>
              {result.starts.map((s) => (
                <p key={s.nodeId} className={cn("text-xs", s.ok ? "text-muted-foreground" : "text-destructive")}>
                  {s.ok ? `Arranca con «${s.trigger}»: ${s.action}.` : `«${s.trigger}» no arrancó: ${s.problem}`}
                </p>
              ))}
              {result.variants.length > 0 && <p className="text-xs text-muted-foreground">También se probó con: {result.variants.join("; ")}.</p>}
              {result.notes.length > 0 && (
                <ul className="space-y-0.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  {result.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
            </section>

            <PathTree tree={result.tree} selectedPathId={selectedId} selectedIds={selectedIds} onSelect={(id) => { setSelectedId(id); setFocus(null); }} />

            <CoveragePanel coverage={result.coverage} focus={focus} onFocus={setFocus} />
          </div>

          <div className="min-h-0 space-y-4 overflow-y-auto p-4">
            {selected ? (
              <PathDetail path={selected} initial={result.initial} />
            ) : (
              <p className="text-sm text-muted-foreground">{result.paths.length === 0 ? "No hay caminos: el flujo no se pudo arrancar." : "Elige un camino del árbol para ver su conversación."}</p>
            )}

            <section aria-label="Mapa" className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-1.5">
                <p className="text-xs text-muted-foreground">
                  {focus
                    ? `Resaltado: «${focus.label}» en «${flowName(focus.flowId)}».`
                    : selected
                      ? `Camino ${selected.id} iluminado en el mapa${selected.flowIds.length > 1 ? ` (pasa por ${selected.flowIds.map(flowName).join(", ")})` : ""}.`
                      : "Elige un camino para iluminarlo."}
                </p>
                {focus && (
                  <button type="button" className="text-xs underline" onClick={() => setFocus(null)}>
                    Quitar
                  </button>
                )}
              </div>
              <div className="h-80">
                <FlowMap catalog={catalog} compact highlight={highlight} sequences={sequences} onOpenFlow={(id) => window.open(`/dashboard/flows/${id}`, "_blank", "noopener")} />
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
