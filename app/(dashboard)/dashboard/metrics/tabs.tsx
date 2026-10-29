"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber } from "@/lib/format";
import type { MetricsReport } from "@/lib/metrics/compute";
import {
  agentsCsv,
  funnelCsv,
  overdueCsv,
  proactiveCsv,
  reasonsCsv,
  volumeCsv,
  type TimeMode,
} from "@/lib/metrics/export";
import { WEEKDAY_SHORT, type HeatMatrix } from "@/lib/metrics/volume";
import { MiniBarChart } from "../analytics/analytics-view";
import { formatDayKey } from "../analytics/day-buckets";
import { Card, Td, Th, EmptyState, ExportButton, StatCard, dur, pctText, pickStats } from "./ui";

const n = (count: number, one: string, many: string) => `${formatNumber(count)} ${count === 1 ? one : many}`;

interface TabProps {
  report: MetricsReport;
  mode: TimeMode;
}

function pctTone(value: number | null): "good" | "bad" | "default" {
  if (value === null) return "default";
  return value >= 80 ? "good" : value < 50 ? "bad" : "default";
}

// ── Resumen ─────────────────────────────────────────────────────────────────

export function SummaryTab({ report, mode }: TabProps) {
  const s = report.summary;
  const first = pickStats(s.firstResponse, mode);
  const reply = pickStats(s.reply, mode);
  const resolution = pickStats(s.resolution, mode);
  const fr = s.compliance.firstResponse;
  const rs = s.compliance.resolution;
  const empty = s.newCases === 0 && s.won + s.lost + s.resolved === 0 && first.count === 0 && s.overdue === 0;

  return (
    <div className="space-y-6">
      {empty && <EmptyState>Aún no hay gestiones en este periodo. Prueba con un periodo más largo o quita algún filtro.</EmptyState>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Primera respuesta (mediana)"
          value={dur(first.median)}
          hint={first.count ? `${n(first.count, "gestión", "gestiones")} · p90 ${dur(first.p90)}` : "Sin respuestas en el periodo"}
        />
        <StatCard
          label="Tiempo de respuesta (mediana)"
          value={dur(reply.median)}
          hint={reply.count ? `${formatNumber(reply.count)} respuestas` : "Sin respuestas registradas"}
        />
        <StatCard
          label="Resolución (mediana)"
          value={dur(resolution.median)}
          hint={resolution.count ? `${formatNumber(resolution.count)} gestiones cerradas` : "Aún no hay gestiones cerradas en este periodo"}
        />
        <StatCard
          label="Cumplimiento de objetivos"
          value={pctText(fr.pct)}
          tone={pctTone(fr.pct)}
          hint={
            fr.total
              ? `Primera respuesta a tiempo: ${fr.within} de ${fr.total}${rs.total ? ` · Resolución: ${pctText(rs.pct)}` : ""}`
              : "Ningún tipo de gestión con objetivo tiene respuestas aún"
          }
        />
        <StatCard label="Ganadas" value={formatNumber(s.won)} tone={s.won ? "good" : "default"} />
        <StatCard label="Perdidas" value={formatNumber(s.lost)} />
        <StatCard label="Resueltas" value={formatNumber(s.resolved)} />
        <StatCard label="Gestiones nuevas" value={formatNumber(s.newCases)} />
        <StatCard
          label="Atrasadas"
          value={formatNumber(s.overdue)}
          tone={s.overdue ? "bad" : "default"}
          hint="Abiertas con próxima acción vencida o estancadas"
        />
      </div>
    </div>
  );
}

// ── Asesores ────────────────────────────────────────────────────────────────

export function AgentsTab({ report, mode }: TabProps) {
  const rows = report.agents;
  return (
    <Card
      title="Rendimiento por asesor"
      subtitle="Tiempos medianos. La tasa de cierre es ganadas entre ganadas más perdidas."
      action={<ExportButton filename="metricas-asesores.csv" build={() => agentsCsv(rows, mode)} disabled={rows.length === 0} />}
    >
      {rows.length === 0 ? (
        <EmptyState>Aún no hay gestiones atendidas en este periodo.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-border">
                <Th>Asesor</Th>
                <Th right>Atendidas</Th>
                <Th right>Primera respuesta</Th>
                <Th right>Respuesta</Th>
                <Th right>Resolución</Th>
                <Th right>Ganadas</Th>
                <Th right>Tasa de cierre</Th>
                <Th right>Cumplimiento</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId ?? "sin-asignar"} className="border-b border-border last:border-0">
                  <Td className="font-medium">{r.name}</Td>
                  <Td right>{formatNumber(r.attended)}</Td>
                  <Td right>{dur(pickStats(r.firstResponse, mode).median)}</Td>
                  <Td right>{dur(pickStats(r.reply, mode).median)}</Td>
                  <Td right>{dur(pickStats(r.resolution, mode).median)}</Td>
                  <Td right>{formatNumber(r.won)}</Td>
                  <Td right>{pctText(r.closeRatePct)}</Td>
                  <Td right>{pctText(r.compliancePct)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Embudo ──────────────────────────────────────────────────────────────────

export function FunnelTab({ report, mode }: TabProps) {
  const funnel = report.funnel;
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <ExportButton filename="metricas-embudo.csv" build={() => funnelCsv(funnel, mode)} disabled={funnel.length === 0} />
      </div>
      {funnel.length === 0 ? (
        <EmptyState>Aún no hay gestiones nuevas en este periodo para armar el embudo.</EmptyState>
      ) : (
        funnel.map((t) => (
          <Card
            key={t.typeId}
            title={t.typeName}
            subtitle={`${n(t.total, "gestión", "gestiones")} · ${n(t.won, "ganada", "ganadas")} · ${n(t.lost, "perdida", "perdidas")} · ${n(t.resolved, "resuelta", "resueltas")} · ${formatNumber(t.other)} sin resultado`}
          >
            {t.stages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este tipo no tiene etapas abiertas configuradas.</p>
            ) : (
              <ul className="space-y-3">
                {t.stages.map((s) => {
                  const time = mode === "business" ? s.business : s.clock;
                  const width = t.total > 0 ? Math.max((s.reached / t.total) * 100, s.reached > 0 ? 2 : 0) : 0;
                  return (
                    <li key={s.stageId}>
                      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatNumber(s.reached)} {s.reached === 1 ? "gestión" : "gestiones"}
                          {s.passPct !== null && ` · pasó el ${s.passPct}% de la etapa anterior`}
                          {time.count > 0 && ` · tiempo en la etapa: mediana ${dur(time.median)}, promedio ${dur(time.mean)}`}
                        </span>
                      </div>
                      <div className="h-3 w-full rounded-full bg-muted" role="img" aria-label={`${s.name}: ${s.reached} de ${t.total}`}>
                        <div className="h-3 rounded-full bg-primary" style={{ width: `${width}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ))
      )}
    </div>
  );
}

// ── Resultados ──────────────────────────────────────────────────────────────

export function ResultsTab({ report }: { report: MetricsReport }) {
  const r = report.results;
  const total = r.won + r.lost + r.resolved;
  const days = r.byDay.map((d) => d.won + d.lost + d.resolved);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ganadas" value={formatNumber(r.won)} tone={r.won ? "good" : "default"} />
        <StatCard label="Perdidas" value={formatNumber(r.lost)} />
        <StatCard label="Resueltas" value={formatNumber(r.resolved)} />
        <StatCard label="Tasa de cierre" value={pctText(r.closeRatePct)} hint="Ganadas entre ganadas más perdidas" />
      </div>

      <Card title="Cierres por día" subtitle="Ganadas, perdidas y resueltas">
        {total === 0 ? (
          <EmptyState>Aún no hay gestiones cerradas en este periodo.</EmptyState>
        ) : (
          <>
            <MiniBarChart
              data={days}
              labels={r.byDay.map((d) => `${formatDayKey(d.day)}: ${n(d.won, "ganada", "ganadas")}, ${n(d.lost, "perdida", "perdidas")}, ${n(d.resolved, "resuelta", "resueltas")}`)}
              maxVal={Math.max(...days, 0)}
              color="bg-green-500"
            />
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
              <span>{formatDayKey(r.byDay[0].day)}</span>
              <span>{formatDayKey(r.byDay[r.byDay.length - 1].day)}</span>
            </div>
          </>
        )}
      </Card>

      <Card
        title="Motivos"
        action={<ExportButton filename="metricas-motivos.csv" build={() => reasonsCsv(r.reasons)} disabled={r.reasons.length === 0} />}
      >
        {r.reasons.length === 0 ? (
          <EmptyState>Aún no hay gestiones cerradas en este periodo.</EmptyState>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <Th>Resultado</Th>
                <Th>Motivo</Th>
                <Th right>Gestiones</Th>
              </tr>
            </thead>
            <tbody>
              {r.reasons.map((x) => (
                <tr key={`${x.kind}:${x.reasonId ?? ""}`} className="border-b border-border last:border-0">
                  <Td>{x.kind === "won" ? "Ganada" : x.kind === "lost" ? "Perdida" : "Resuelta"}</Td>
                  <Td>{x.name}</Td>
                  <Td right>{formatNumber(x.count)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Recompra y renovación"
        subtitle="Gestiones proactivas activadas en el periodo y cuántas se ganaron"
        action={<ExportButton filename="metricas-recompra-renovacion.csv" build={() => proactiveCsv(r.proactive)} disabled={r.proactive.length === 0} />}
      >
        {r.proactive.length === 0 ? (
          <EmptyState>Aún no se activaron gestiones de recompra o renovación en este periodo.</EmptyState>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <Th>Tipo de gestión</Th>
                <Th right>Activadas</Th>
                <Th right>Ganadas</Th>
                <Th right>Perdidas</Th>
                <Th right>Tasa</Th>
              </tr>
            </thead>
            <tbody>
              {r.proactive.map((x) => (
                <tr key={x.typeId} className="border-b border-border last:border-0">
                  <Td className="font-medium">{x.typeName}</Td>
                  <Td right>{formatNumber(x.activated)}</Td>
                  <Td right>{formatNumber(x.won)}</Td>
                  <Td right>{formatNumber(x.lost)}</Td>
                  <Td right>{pctText(x.ratePct)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ── Atrasados ───────────────────────────────────────────────────────────────

export function OverdueTab({
  report,
  memberNames,
  staleDays,
}: {
  report: MetricsReport;
  memberNames: Record<string, string>;
  staleDays: number;
}) {
  const items = report.overdue;
  const nameOf = (id: string | null) => (id ? (memberNames[id] ?? "Persona eliminada") : "Sin asignar");
  return (
    <Card
      title="Gestiones atrasadas"
      subtitle={`Abiertas con la próxima acción vencida o con ${staleDays} ${staleDays === 1 ? "día" : "días"} o más en la misma etapa`}
      action={<ExportButton filename="metricas-atrasados.csv" build={() => overdueCsv(items, nameOf)} disabled={items.length === 0} />}
    >
      {items.length === 0 ? (
        <EmptyState>No hay gestiones atrasadas. Buen trabajo.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-border">
                <Th>Contacto</Th>
                <Th>Tipo</Th>
                <Th>Etapa</Th>
                <Th>Responsable</Th>
                <Th>Próxima acción</Th>
                <Th right>Días en la etapa</Th>
                <Th>Motivo</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.caseId} className="border-b border-border last:border-0">
                  <Td className="font-medium">
                    <Link
                      href={`/dashboard/inbox?contact=${encodeURIComponent(i.contactId)}&case=${encodeURIComponent(i.caseId)}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {i.contactName ?? "Sin nombre"}
                    </Link>
                  </Td>
                  <Td>{i.typeName ?? "—"}</Td>
                  <Td>{i.stageName ?? "—"}</Td>
                  <Td>{nameOf(i.assigneeId)}</Td>
                  <Td>
                    {i.nextActionAt ? formatDate(i.nextActionAt) : "—"}
                    {i.daysOverdue > 0 && (
                      <span className="ml-1 text-xs text-red-600">
                        ({i.daysOverdue} {i.daysOverdue === 1 ? "día" : "días"} de atraso)
                      </span>
                    )}
                  </Td>
                  <Td right>{i.daysInStage}</Td>
                  <Td>
                    {i.reasons.map((x) => (
                      <span key={x} className="mr-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
                        {x === "next_action" ? "Acción vencida" : "Estancada"}
                      </span>
                    ))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Volumen ─────────────────────────────────────────────────────────────────

function Heatmap({ matrix, max, unit }: { matrix: HeatMatrix; max: number; unit: string }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="ml-10 grid gap-[2px] text-[10px] text-muted-foreground" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center">
                {h % 3 === 0 ? h : ""}
              </span>
            ))}
          </div>
          {matrix.map((row, d) => (
            <div key={d} className="mt-[2px] flex items-center gap-1">
              <span className="w-9 text-right text-xs text-muted-foreground">{WEEKDAY_SHORT[d]}</span>
              <div className="grid flex-1 gap-[2px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                {row.map((v, h) => {
                  const label = `${WEEKDAY_SHORT[d]} ${String(h).padStart(2, "0")}:00 · ${formatNumber(v)} ${unit}`;
                  return (
                    <div
                      key={h}
                      title={label}
                      aria-label={label}
                      onMouseEnter={() => setHover(label)}
                      onMouseLeave={() => setHover(null)}
                      className={cn("h-6 rounded-sm", v === 0 && "bg-muted")}
                      style={v > 0 ? { backgroundColor: `color-mix(in srgb, var(--primary) ${Math.round(15 + (v / (max || 1)) * 85)}%, transparent)` } : undefined}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 h-4 text-xs text-muted-foreground">{hover ?? "Pasa el cursor sobre una celda para ver el detalle. Hora de Lima."}</p>
    </div>
  );
}

export function VolumeTab({ report, showMessages }: { report: MetricsReport; showMessages: boolean }) {
  const v = report.volume;
  const [metric, setMetric] = useState<"messages" | "cases">(showMessages ? "messages" : "cases");
  const matrix = metric === "messages" ? v.messagesMatrix : v.casesMatrix;
  const max = metric === "messages" ? v.maxMessages : v.maxCases;
  const total = metric === "messages" ? v.totalMessages : v.totalCases;
  const unit = metric === "messages" ? "mensajes" : "gestiones";
  const series = v.daily.map((d) => (metric === "messages" ? d.messages : d.cases));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="tablist" aria-label="Qué medir">
          {showMessages && (
            <button
              type="button"
              onClick={() => setMetric("messages")}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", metric === "messages" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
            >
              Mensajes entrantes
            </button>
          )}
          <button
            type="button"
            onClick={() => setMetric("cases")}
            className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", metric === "cases" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            Gestiones nuevas
          </button>
        </div>
        <ExportButton filename="metricas-volumen.csv" build={() => volumeCsv(v.daily, showMessages)} disabled={v.daily.length === 0} />
      </div>
      {!showMessages && (
        <p className="text-xs text-muted-foreground">
          Los mensajes entrantes de todo el espacio solo los ven los supervisores y los administradores.
        </p>
      )}

      {total === 0 ? (
        <EmptyState>
          {metric === "messages"
            ? "Aún no hay mensajes entrantes registrados en este periodo."
            : "Aún no hay gestiones nuevas en este periodo."}
        </EmptyState>
      ) : (
        <>
          <Card title="Por día de la semana y hora" subtitle={`${metric === "messages" ? n(total, "mensaje", "mensajes") : n(total, "gestión", "gestiones")} en el periodo`}>
            <Heatmap matrix={matrix} max={max} unit={unit} />
          </Card>
          <Card title="Por día" subtitle={metric === "messages" ? "Mensajes entrantes" : "Gestiones nuevas"}>
            <MiniBarChart
              data={series}
              labels={v.daily.map((d) => formatDayKey(d.day))}
              maxVal={Math.max(...series, 0)}
              color="bg-blue-500"
            />
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
              <span>{formatDayKey(v.daily[0].day)}</span>
              <span>{formatDayKey(v.daily[v.daily.length - 1].day)}</span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
