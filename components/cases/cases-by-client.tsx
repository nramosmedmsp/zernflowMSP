"use client";

// Gestiones, vista "Por cliente": una fila por cliente con todas sus gestiones
// activas dentro (la más urgente primero). Las que cumplen la pestaña y los
// filtros van resaltadas; las demás se ven atenuadas, como contexto. Al
// expandir la fila se ve el detalle de cada gestión con "Abrir chat".

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { PlatformIcon } from "@/components/platform-icon";
import { ContactTypeChip } from "@/components/contacts/contact-type-ui";
import { caseRowHref, type CaseTab } from "@/components/cases/case-filters";
import type { ClientCaseRow, ClientGroup } from "@/app/(dashboard)/dashboard/cases/load-cases";
import { deadlineChip, solutionScheduleFor, type SolutionSchedules } from "@/lib/cases/protection";

export interface ByClientOptions {
  caseTypes: { id: string; name: string; color: string | null; solutionDeadlineHours?: number | null }[];
  stages: { id: string; name: string; color: string | null }[];
  contactTypes: { id: string; name: string; color: string | null }[];
  memberName: ReadonlyMap<string, string>;
  solutionSchedules?: SolutionSchedules | null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const GRID = "grid grid-cols-[1.75rem_18rem_minmax(0,1fr)_6.5rem] items-center gap-x-3";
const SUB_GRID = "grid grid-cols-[9rem_9rem_7rem_minmax(0,1fr)_auto] items-center gap-x-3";
const FALLBACK_COLOR = "#6b7280";

function colorOf(color: string | null | undefined): string {
  return color && HEX.test(color) ? color : FALLBACK_COLOR;
}

const CHIP_TONE = {
  red: "bg-red-500/15 text-red-600 dark:text-red-300",
  amber: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
} as const;

function caseInfo(row: ClientCaseRow, opts: ByClientOptions, now: Date) {
  const type = row.caseTypeId ? opts.caseTypes.find((t) => t.id === row.caseTypeId) : undefined;
  const stage = row.stageId ? opts.stages.find((s) => s.id === row.stageId) : undefined;
  const chip = deadlineChip(
    {
      status: row.status,
      openedAt: row.openedAt,
      solutionSchedule: solutionScheduleFor(opts.solutionSchedules, row.teamId),
      solutionClockAt: row.solutionClockAt,
      solutionStatus: row.solutionStatus,
      solutionNote: row.solutionNote,
      nextActionAt: row.nextActionAt,
      hasCloseRequest: row.hasCloseRequest,
    },
    type?.solutionDeadlineHours,
    now,
  );
  const assignee = row.assigneeId ? (opts.memberName.get(row.assigneeId) ?? "Alguien") : "Sin asignar";
  return { type, stage, chip, assignee, color: colorOf(type?.color) };
}

/** "● Postventa · Nueva · Luis [reloj vence en 3 h]" */
function CaseChip({ row, opts, now }: { row: ClientCaseRow; opts: ByClientOptions; now: Date }) {
  const { type, stage, chip, assignee, color } = caseInfo(row, opts, now);
  const urgent = chip?.tone === "red";
  const stageText = row.status === "scheduled" ? "Programada" : (stage?.name ?? "sin etapa");
  return (
    <span
      title={row.matches ? undefined : "No coincide con los filtros actuales"}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs",
        urgent && "ring-1 ring-red-400/60",
        !row.matches && "opacity-55",
      )}
      style={{ borderColor: `${color}55`, backgroundColor: `${color}14` }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-semibold" style={{ color }}>
        {type?.name ?? "Sin clasificar"}
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="truncate">{stageText}</span>
      <span className="text-muted-foreground">·</span>
      <span className="truncate text-muted-foreground">{assignee}</span>
      {chip && (
        <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-semibold", CHIP_TONE[chip.tone])}>
          <Clock className="h-3 w-3" />
          {chip.label}
        </span>
      )}
    </span>
  );
}

function SubRow({
  row,
  group,
  tab,
  opts,
  now,
}: {
  row: ClientCaseRow;
  group: ClientGroup;
  tab: CaseTab;
  opts: ByClientOptions;
  now: Date;
}) {
  const { type, stage, chip, assignee, color } = caseInfo(row, opts, now);
  const href = caseRowHref(group.contactId, row.id, group.hasConversation);
  const overdue = row.status === "open" && row.nextActionAt !== null && new Date(row.nextActionAt).getTime() < now.getTime();
  let when: string;
  if (row.status === "scheduled") when = row.scheduledFor ? `Se activa el ${formatDate(row.scheduledFor)}` : "Programada";
  else if (tab === "closed") when = row.closedAt ? `Cerrada ${formatRelative(row.closedAt, now)}` : "Cerrada";
  else when = row.nextActionAt ? `Próximo contacto: ${formatRelative(row.nextActionAt, now)}` : "Sin próximo contacto";
  return (
    <div className={cn(SUB_GRID, "border-t border-border/70 py-2 pr-8", !row.matches && "opacity-60")}>
      <div>
        {type ? (
          <span
            className="inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: `${color}20`, borderColor: `${color}40`, color }}
          >
            {type.name}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Sin clasificar</span>
        )}
      </div>
      <div>
        {stage ? (
          <span
            className="inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-xs font-medium"
            style={
              stage.color && HEX.test(stage.color)
                ? { backgroundColor: `${stage.color}20`, borderColor: `${stage.color}40`, color: stage.color }
                : undefined
            }
          >
            {stage.name}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/60">{row.status === "scheduled" ? "Programada" : "sin etapa"}</span>
        )}
      </div>
      <div className="truncate text-sm">
        {row.assigneeId ? assignee : <span className="text-xs text-muted-foreground">Sin asignar</span>}
      </div>
      <div className="min-w-0 text-sm" suppressHydrationWarning>
        <span
          className={cn(overdue ? "font-medium text-red-600" : "text-muted-foreground")}
          title={row.nextActionAt ? formatDateTime(row.nextActionAt) : undefined}
        >
          {when}
        </span>
        {chip && (
          <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium", CHIP_TONE[chip.tone])}>
            {chip.label.startsWith("vence") ? `Plazo ${chip.label}` : chip.label}
          </span>
        )}
        {row.nextActionNote && row.status === "open" && (
          <span className="block truncate text-xs text-muted-foreground">{row.nextActionNote}</span>
        )}
        {!row.caseTypeId && row.status === "open" && (
          <span className="block truncate text-xs text-amber-700 dark:text-amber-300">
            Abierta sin tipo: clasifícala o ciérrala.
          </span>
        )}
      </div>
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {group.hasConversation ? "Abrir chat" : "Ver contacto"}
      </Link>
    </div>
  );
}

export function CasesByClient({
  groups,
  tab,
  now,
  options,
}: {
  groups: ClientGroup[];
  tab: CaseTab;
  now: Date;
  options: ByClientOptions;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div
        className={cn(
          GRID,
          "border-b border-border bg-muted/50 py-3 pl-8 pr-8 text-xs font-medium uppercase text-muted-foreground",
        )}
      >
        <span />
        <span>Cliente</span>
        <span>{tab === "closed" ? "Gestiones cerradas (la más reciente primero)" : "Gestiones activas (la más urgente primero)"}</span>
        <span>Último mensaje</span>
      </div>
      {groups.map((g) => {
        const isOpen = open.has(g.contactId);
        const contactType = g.contactTypeId ? (options.contactTypes.find((t) => t.id === g.contactTypeId) ?? null) : null;
        const lead = g.cases.find((c) => c.matches) ?? g.cases[0];
        const nameHref = lead ? caseRowHref(g.contactId, lead.id, g.hasConversation) : `/dashboard/contacts/${g.contactId}`;
        return (
          <div key={g.contactId} className={cn("border-b border-border", isOpen && "bg-accent/30")}>
            <div
              className={cn(GRID, "cursor-pointer py-3 pl-8 pr-8 hover:bg-accent/50")}
              onClick={() => toggle(g.contactId)}
            >
              <button
                type="button"
                aria-label={isOpen ? "Contraer" : "Expandir"}
                aria-expanded={isOpen}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
              >
                <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
              </button>
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {g.contactName?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  {g.platform && (
                    <div className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 border-background bg-background">
                      <PlatformIcon platform={g.platform} className="h-3 w-3" size={12} />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <Link
                    href={nameHref}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {g.contactName ?? "Desconocido"}
                  </Link>
                  {contactType && (
                    <div className="mt-0.5">
                      <ContactTypeChip type={contactType} small />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {g.cases.map((c) => (
                  <CaseChip key={c.id} row={c} opts={options} now={now} />
                ))}
                {g.cases.length > 1 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {g.cases.length} gestiones
                  </span>
                )}
              </div>
              <span className="text-sm text-muted-foreground" suppressHydrationWarning>
                {g.lastMessageAt ? formatRelative(g.lastMessageAt, now) : "—"}
              </span>
            </div>
            {isOpen && (
              <div className="animate-fade-in ml-[3.25rem] pb-2 pl-[calc(2rem+0.75rem)]">
                <div className={cn(SUB_GRID, "pb-1 pr-8 text-[10px] font-medium uppercase text-muted-foreground")}>
                  <span>Tipo</span>
                  <span>Etapa</span>
                  <span>Responsable</span>
                  <span>{tab === "closed" ? "Cierre" : tab === "scheduled" ? "Activación" : "Próximo contacto"}</span>
                  <span className="w-24" />
                </div>
                {g.cases.map((c) => (
                  <SubRow key={c.id} row={c} group={g} tab={tab} opts={options} now={now} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
