"use client";

import { useState, useTransition, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { startRouteProgress } from "@/components/ui/route-progress";
import { Spinner } from "@/components/ui/spinner";
import { formatNumber } from "@/lib/format";
import type { MetricsReport } from "@/lib/metrics/compute";
import type { TimeMode } from "@/lib/metrics/export";
import { PERIOD_OPTIONS } from "@/lib/metrics/period";
import type { MetricFilters } from "@/lib/metrics/types";
import { AgentsTab, FunnelTab, OverdueTab, ResultsTab, SummaryTab, VolumeTab } from "./tabs";

export type TabKey = "summary" | "agents" | "funnel" | "results" | "overdue" | "volume";

const TABS: readonly { key: TabKey; label: string; supervisorOnly?: boolean }[] = [
  { key: "summary", label: "Resumen" },
  { key: "agents", label: "Asesores", supervisorOnly: true },
  { key: "funnel", label: "Embudo" },
  { key: "results", label: "Resultados" },
  { key: "overdue", label: "Atrasados" },
  { key: "volume", label: "Volumen" },
];

const PLATFORM_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  telegram: "Telegram",
  tiktok: "TikTok",
  twitter: "X (Twitter)",
  bluesky: "Bluesky",
  reddit: "Reddit",
  sms: "SMS",
  email: "Correo",
  test: "Canal de prueba",
};

const ORIGIN_LABELS = [
  { value: "inbound", label: "Entrante" },
  { value: "proactive", label: "Proactiva" },
  { value: "manual", label: "Manual" },
] as const;

export interface FilterOptions {
  caseTypes: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  members: { userId: string; name: string }[];
  channels: string[];
  contactTypes: { id: string; name: string }[];
}

const selectClass =
  "rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function MetricsView({
  report,
  filters,
  options,
  canSeeOthers,
  staleDays,
  truncatedCases,
  truncatedInbound,
  initialTab,
}: {
  report: MetricsReport;
  filters: MetricFilters;
  options: FilterOptions;
  canSeeOthers: boolean;
  staleDays: number;
  truncatedCases: boolean;
  truncatedInbound: boolean;
  initialTab: TabKey;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [filtering, startTransition] = useTransition();
  const visibleTabs = TABS.filter((t) => canSeeOthers || !t.supervisorOnly);
  const [tab, setTab] = useState<TabKey>(visibleTabs.some((t) => t.key === initialTab) ? initialTab : "summary");
  const [mode, setMode] = useState<TimeMode>(report.hasSchedule ? "business" : "clock");
  const [custom, setCustom] = useState({ from: filters.from ?? report.range.startDay, to: filters.to ?? report.range.endDay });

  function push(patch: Record<string, string | undefined>) {
    const current: Record<string, string | undefined> = {
      period: filters.period,
      from: filters.period === "custom" ? filters.from : undefined,
      to: filters.period === "custom" ? filters.to : undefined,
      type: filters.caseTypeId,
      team: filters.teamId,
      agent: filters.assigneeId,
      channel: filters.channel,
      origin: filters.origin,
      ctype: filters.contactTypeId,
      tab,
    };
    const next = { ...current, ...patch };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) qs.set(k, v);
    startRouteProgress();
    startTransition(() => router.push(`${pathname}?${qs.toString()}`));
  }

  function selectTab(key: TabKey) {
    setTab(key);
    const qs = new URLSearchParams(window.location.search);
    qs.set("tab", key);
    window.history.replaceState(null, "", `${pathname}?${qs.toString()}`);
  }

  function applyCustom(e: FormEvent) {
    e.preventDefault();
    if (custom.from && custom.to) push({ period: "custom", from: custom.from, to: custom.to });
  }

  const memberNames = Object.fromEntries(options.members.map((m) => [m.userId, m.name]));
  const filterCount = [filters.caseTypeId, filters.teamId, filters.assigneeId, filters.channel, filters.origin, filters.contactTypeId].filter(Boolean).length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Métricas</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {canSeeOthers
                ? "Cómo atiende tu equipo: tiempos, embudo, resultados y gestiones atrasadas."
                : "Cómo vas tú: tiempos, resultados y gestiones atrasadas de tus gestiones."}
            </p>
          </div>
          {report.hasSchedule && (
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5" role="group" aria-label="Cómo medir los tiempos">
              {(["business", "clock"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  title={m === "business" ? "Cuenta solo las horas de atención" : "Cuenta todas las horas, también las de cierre"}
                  className={cn("rounded-md px-3 py-1 text-sm font-medium", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
                >
                  {m === "business" ? "En horario" : "Reloj"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            aria-label="Periodo"
            value={filters.period}
            onChange={(e) => push({ period: e.target.value, from: undefined, to: undefined })}
            className={selectClass}
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {filters.period === "custom" && (
            <form onSubmit={applyCustom} className="flex items-center gap-2">
              <input type="date" aria-label="Desde" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className={selectClass} />
              <span className="text-sm text-muted-foreground">hasta</span>
              <input type="date" aria-label="Hasta" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className={selectClass} />
              <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
                Aplicar
              </button>
            </form>
          )}
          <select aria-label="Tipo de gestión" value={filters.caseTypeId ?? ""} onChange={(e) => push({ type: e.target.value || undefined })} className={selectClass}>
            <option value="">Todos los tipos</option>
            {options.caseTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {canSeeOthers && options.teams.length > 0 && (
            <select aria-label="Equipo" value={filters.teamId ?? ""} onChange={(e) => push({ team: e.target.value || undefined })} className={selectClass}>
              <option value="">Todos los equipos</option>
              {options.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {canSeeOthers && (
            <select aria-label="Asesor" value={filters.assigneeId ?? ""} onChange={(e) => push({ agent: e.target.value || undefined })} className={selectClass}>
              <option value="">Todos los asesores</option>
              {options.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Canal" value={filters.channel ?? ""} onChange={(e) => push({ channel: e.target.value || undefined })} className={selectClass}>
            <option value="">Todos los canales</option>
            {options.channels.map((c) => (
              <option key={c} value={c}>
                {PLATFORM_LABELS[c] ?? c}
              </option>
            ))}
          </select>
          <select aria-label="Origen" value={filters.origin ?? ""} onChange={(e) => push({ origin: e.target.value || undefined })} className={selectClass}>
            <option value="">Todos los orígenes</option>
            {ORIGIN_LABELS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {options.contactTypes.length > 0 && (
            <select aria-label="Tipo de contacto" value={filters.contactTypeId ?? ""} onChange={(e) => push({ ctype: e.target.value || undefined })} className={selectClass}>
              <option value="">Todos los tipos de contacto</option>
              {options.contactTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {filterCount > 0 && (
            <button
              type="button"
              onClick={() => push({ type: undefined, team: undefined, agent: undefined, channel: undefined, origin: undefined, ctype: undefined })}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Quitar filtros
            </button>
          )}
        </div>

        <div className="mt-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Secciones de métricas">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t.label}
              {t.key === "overdue" && report.summary.overdue > 0 && (
                <span className="ml-1.5 rounded-full bg-red-100 px-1.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
                  {formatNumber(report.summary.overdue)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("relative flex-1 overflow-auto p-8 transition-opacity", filtering && "pointer-events-none opacity-60")}>
        {filtering && (
          <div role="status" className="absolute right-8 top-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
            <Spinner className="h-3 w-3" />
            Actualizando…
          </div>
        )}
        {(truncatedCases || truncatedInbound) && (
          <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {truncatedCases
                ? "Hay más de 5.000 gestiones en este periodo y solo se calcularon las más recientes. Acorta el periodo o usa los filtros para ver todo."
                : "Hay muchos mensajes entrantes en este periodo y solo se contaron los primeros 20.000. Acorta el periodo para ver todo."}
            </span>
          </div>
        )}
        <div key={tab} className="animate-fade-in">
        {tab === "summary" && <SummaryTab report={report} mode={mode} />}
        {tab === "agents" && canSeeOthers && <AgentsTab report={report} mode={mode} />}
        {tab === "funnel" && <FunnelTab report={report} mode={mode} />}
        {tab === "results" && <ResultsTab report={report} />}
        {tab === "overdue" && <OverdueTab report={report} memberNames={memberNames} staleDays={staleDays} />}
        {tab === "volume" && <VolumeTab report={report} showMessages={canSeeOthers} />}
        </div>
      </div>
    </div>
  );
}
