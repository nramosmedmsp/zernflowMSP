"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, Briefcase, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import {
  CASES_PAGE_SIZE,
  CASE_STATUS_LABELS,
  CASE_TABS,
  CLOSED_PERIODS,
  NONE_FILTER,
  buildCasesHref,
  caseRowHref,
  formatWaiting,
  pageRangeLabel,
  type CaseListParams,
} from "@/components/cases/case-filters";
import { NewCaseDialog } from "@/components/cases/new-case-dialog";
import { startRouteProgress } from "@/components/ui/route-progress";
import type { CaseListRow } from "@/app/(dashboard)/dashboard/cases/load-cases";
import { claimBadge } from "@/lib/cases/protection";
import type { CaseStatus } from "@/lib/types/database";

interface CaseTypeOption {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
  /** Control de reclamos: horas para registrar la solución (null = sin plazo). */
  solutionDeadlineHours?: number | null;
}
interface StageOption {
  id: string;
  caseTypeId: string;
  name: string;
  color: string | null;
}
interface PersonOption {
  userId: string;
  name: string;
}

export interface CasesViewProps {
  rows: CaseListRow[];
  total: number;
  page: number;
  params: CaseListParams;
  nowIso: string;
  caseTypes: CaseTypeOption[];
  stages: StageOption[];
  teams: { id: string; name: string }[];
  members: PersonOption[];
  assignableMembers: PersonOption[];
  me: { userId: string; canSeeOthers: boolean };
}

const STATUS_STYLES: Record<CaseStatus, string> = {
  scheduled: "bg-blue-500/10 text-blue-600",
  open: "bg-green-500/10 text-green-600",
  won: "bg-emerald-500/10 text-emerald-700",
  lost: "bg-red-500/10 text-red-600",
  resolved: "bg-slate-500/10 text-slate-600",
  cancelled: "bg-muted text-muted-foreground",
};

const SELECT_CLASS =
  "rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function ColorBadge({ label, color }: { label: string; color: string | null }) {
  return (
    <span
      className="inline-flex max-w-[11rem] items-center truncate rounded-full border border-border px-2 py-0.5 text-xs font-medium"
      style={color ? { backgroundColor: `${color}20`, borderColor: `${color}40`, color } : undefined}
    >
      {label}
    </span>
  );
}

export function CasesView(props: CasesViewProps) {
  const { rows, total, page, params, caseTypes, stages, teams, members, assignableMembers, me } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.q);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; href: string } | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = useMemo(() => new Date(props.nowIso), [props.nowIso]);

  // Si la URL cambia desde fuera (p. ej. "Limpiar filtros"), se sincroniza el texto.
  const [prevQ, setPrevQ] = useState(params.q);
  if (prevQ !== params.q) {
    setPrevQ(params.q);
    setSearch(params.q);
  }
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  const typeById = useMemo(() => new Map(caseTypes.map((t) => [t.id, t])), [caseTypes]);
  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const memberName = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);
  const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  function go(next: Partial<CaseListParams>) {
    startRouteProgress();
    startTransition(() => router.push(buildCasesHref({ ...params, page: 1, ...next })));
  }

  function onSearchChange(value: string) {
    setSearch(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (value.trim() !== params.q) go({ q: value.trim() });
    }, 400);
  }

  const visibleStages = params.type && params.type !== NONE_FILTER
    ? stages.filter((s) => s.caseTypeId === params.type)
    : stages;
  const showAssigneeFilter = params.tab !== "today" || me.canSeeOthers;
  const assigneeValue = params.assignee || (params.tab === "today" ? "me" : "");
  const hasFilters = !!(params.type || params.stage || params.team || params.q || params.assignee);
  const pages = Math.max(1, Math.ceil(total / CASES_PAGE_SIZE));

  const dateColumnLabel =
    params.tab === "scheduled" ? "Se activa" : params.tab === "closed" ? "Cerrada" : "Próximo contacto";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Gestiones</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatNumber(total)} {total === 1 ? "gestión" : "gestiones"}
              {params.tab === "today" && " para hoy"}
            </p>
          </div>
          <button
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Nueva gestión
          </button>
        </div>

        {notice && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700">
            <span>
              {notice.text}{" "}
              <Link href={notice.href} className="font-medium underline">
                Ver contacto
              </Link>
            </span>
            <button onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="text-green-700/70 hover:text-green-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Pestañas */}
        <div className="mt-4 flex gap-1 border-b border-border" role="tablist">
          {CASE_TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={params.tab === tab.key}
              onClick={() => go({ tab: tab.key, assignee: "", stage: params.stage })}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                params.tab === tab.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nombre del contacto..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full rounded-lg border border-input bg-background py-1.5 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <select
            aria-label="Tipo de gestión"
            value={params.type}
            onChange={(e) => go({ type: e.target.value, stage: "" })}
            className={SELECT_CLASS}
          >
            <option value="">Todos los tipos</option>
            <option value={NONE_FILTER}>Sin clasificar</option>
            {caseTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.archived ? " (archivado)" : ""}
              </option>
            ))}
          </select>
          <select
            aria-label="Etapa"
            value={params.stage}
            onChange={(e) => go({ stage: e.target.value })}
            className={SELECT_CLASS}
          >
            <option value="">Todas las etapas</option>
            {visibleStages.map((s) => (
              <option key={s.id} value={s.id}>
                {params.type && params.type !== NONE_FILTER
                  ? s.name
                  : `${typeById.get(s.caseTypeId)?.name ?? "Tipo"} · ${s.name}`}
              </option>
            ))}
          </select>
          {showAssigneeFilter && (
            <select
              aria-label="Responsable"
              value={assigneeValue}
              onChange={(e) => go({ assignee: e.target.value })}
              className={SELECT_CLASS}
            >
              {params.tab === "today" ? (
                <>
                  <option value="me">Mis gestiones</option>
                  <option value="all">Todos los responsables</option>
                </>
              ) : (
                <>
                  <option value="">Todos los responsables</option>
                  <option value="me">Mis gestiones</option>
                </>
              )}
              <option value={NONE_FILTER}>Sin responsable</option>
              {members
                .filter((m) => m.userId !== me.userId)
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
            </select>
          )}
          {teams.length > 0 && (
            <select
              aria-label="Equipo"
              value={params.team}
              onChange={(e) => go({ team: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">Todos los equipos</option>
              <option value={NONE_FILTER}>Sin equipo</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {params.tab === "closed" && (
            <select
              aria-label="Periodo"
              value={params.period}
              onChange={(e) => go({ period: e.target.value as CaseListParams["period"] })}
              className={SELECT_CLASS}
            >
              {CLOSED_PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          {hasFilters && (
            <button
              onClick={() => go({ type: "", stage: "", team: "", q: "", assignee: "" })}
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              Limpiar filtros
            </button>
          )}
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Tabla */}
      <div className={cn("flex-1 overflow-auto", pending && "opacity-70")}>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Briefcase className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">No hay gestiones aquí</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {hasFilters
                ? "Prueba quitando algún filtro."
                : params.tab === "today"
                  ? "No tienes contactos pendientes para hoy."
                  : "Las gestiones aparecen cuando alguien escribe a tus canales o las creas a mano."}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                {["Contacto", "Tipo", "Etapa", "Estado", "Responsable", "Equipo", "Abierta", dateColumnLabel, "Espera"].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={cn(
                        "px-4 py-3 text-xs font-medium uppercase text-muted-foreground",
                        i === 0 && "px-8",
                      )}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const href = caseRowHref(row.contactId, row.id, row.hasConversation);
                const type = row.caseTypeId ? typeById.get(row.caseTypeId) : null;
                const stage = row.stageId ? stageById.get(row.stageId) : null;
                const dateValue =
                  params.tab === "scheduled"
                    ? row.scheduledFor
                    : params.tab === "closed"
                      ? row.closedAt
                      : row.nextActionAt;
                const overdue =
                  params.tab !== "scheduled" &&
                  params.tab !== "closed" &&
                  row.nextActionAt !== null &&
                  new Date(row.nextActionAt).getTime() < now.getTime();
                const waiting = row.status === "open" ? formatWaiting(row.waitingSince, now) : "";
                const claim = claimBadge(
                  {
                    status: row.status,
                    openedAt: row.openedAt,
                    solutionClockAt: row.solutionClockAt,
                    solutionStatus: row.solutionStatus,
                    solutionNote: row.solutionNote,
                    nextActionAt: row.nextActionAt,
                    hasCloseRequest: row.hasCloseRequest,
                  },
                  type?.solutionDeadlineHours,
                  now,
                );
                return (
                  <tr
                    key={row.id}
                    onClick={() => {
                      startRouteProgress();
                      router.push(href);
                    }}
                    className="cursor-pointer border-b border-border transition-colors hover:bg-accent/50"
                  >
                    <td className="px-8 py-3">
                      <Link
                        href={href}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-medium hover:underline"
                      >
                        {row.contactName ?? "Desconocido"}
                      </Link>
                      {claim && (
                        <span
                          className={cn(
                            "ml-2 inline-block rounded-full px-2 py-0.5 align-middle text-[10px] font-medium",
                            claim.kind === "approval"
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "bg-red-500/10 text-red-600 dark:text-red-300",
                          )}
                        >
                          {claim.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {type ? (
                        <ColorBadge label={type.name} color={type.color} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin clasificar</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {stage ? (
                        <ColorBadge label={stage.name} color={stage.color} />
                      ) : (
                        <span className="text-xs text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                          STATUS_STYLES[row.status],
                        )}
                      >
                        {CASE_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {row.assigneeId ? (
                        (memberName.get(row.assigneeId) ?? "Alguien")
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin asignar</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {row.teamId ? (teamName.get(row.teamId) ?? "—") : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground" suppressHydrationWarning>
                      {row.openedAt ? formatRelative(row.openedAt, now) : "—"}
                    </td>
                    <td
                      className={cn("px-4 py-3 text-sm", overdue ? "font-medium text-red-600" : "text-muted-foreground")}
                      suppressHydrationWarning
                      title={dateValue ? formatDateTime(dateValue) : undefined}
                    >
                      {dateValue ? (
                        params.tab === "scheduled" ? (
                          formatDate(dateValue)
                        ) : (
                          formatRelative(dateValue, now)
                        )
                      ) : (
                        "—"
                      )}
                      {params.tab !== "scheduled" && params.tab !== "closed" && row.nextActionNote && (
                        <span className="block max-w-[14rem] truncate text-xs font-normal text-muted-foreground">
                          {row.nextActionNote}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground" suppressHydrationWarning>
                      {waiting || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginación */}
      {total > 0 && (
        <div className="flex items-center justify-between border-t border-border px-8 py-3 text-sm text-muted-foreground">
          <span>{pageRangeLabel(page, CASES_PAGE_SIZE, total)}</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1 || pending}
              onClick={() => {
                startRouteProgress();
                startTransition(() => router.push(buildCasesHref({ ...params, page: page - 1 })));
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </button>
            <span>
              Página {page} de {pages}
            </span>
            <button
              disabled={page >= pages || pending}
              onClick={() => {
                startRouteProgress();
                startTransition(() => router.push(buildCasesHref({ ...params, page: page + 1 })));
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
            >
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <NewCaseDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        caseTypes={caseTypes.filter((t) => !t.archived)}
        members={assignableMembers}
        canAssignOthers={me.canSeeOthers && assignableMembers.length > 0}
        onCreated={({ contactId, status, scheduledFor }) => {
          setDialogOpen(false);
          setNotice({
            text:
              status === "scheduled"
                ? `Gestión programada${scheduledFor ? ` para el ${formatDate(scheduledFor)}` : ""}.`
                : "Gestión abierta.",
            href: `/dashboard/contacts/${contactId}`,
          });
          router.refresh();
        }}
      />
    </div>
  );
}
