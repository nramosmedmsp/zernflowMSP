"use client";

import { useMemo, useState } from "react";
import { Search, MessageSquare, RefreshCw, SlidersHorizontal, UserRound, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { formatRelative } from "@/lib/format";
import { platformLabel } from "@/lib/platforms";
import type { Platform } from "@/lib/types/database";
import {
  EMPTY_FILTERS,
  VIEW_LABELS,
  activeFilterCount,
  availableViews,
  buildRows,
  memberName,
  waitingText,
  type InboxCase,
  type InboxConversation,
  type InboxFilters,
  type InboxMeta,
  type InboxRow,
  type InboxViewKey,
} from "./inbox-model";
import { DemoBadge } from "./demo-badge";
import { selectClass } from "./ui";
import { useNow } from "./use-now";

export function ConversationList({
  conversations,
  casesByContact,
  meta,
  selectedId,
  onSelect,
  onSync,
  syncing = false,
  syncError = null,
}: {
  conversations: InboxConversation[];
  casesByContact: ReadonlyMap<string, InboxCase[]>;
  meta: InboxMeta;
  selectedId: string | null;
  onSelect: (row: InboxRow) => void;
  /** Solo administradores (la ruta de sincronización responde 403 a los demás). */
  onSync?: () => void;
  syncing?: boolean;
  syncError?: string | null;
}) {
  const views = availableViews(meta);
  const [view, setView] = useState<InboxViewKey>("mine");
  const [filters, setFilters] = useState<InboxFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  // Los tiempos relativos dependen del reloj del cliente: se muestran después
  // de montar para no provocar errores de hidratación (React #418).
  const now = useNow();
  const nowDate = useMemo(() => (now === null ? new Date() : new Date(now)), [now]);

  const rowsByView = useMemo(() => {
    const result = new Map<InboxViewKey, InboxRow[]>();
    for (const v of views) result.set(v, buildRows(conversations, casesByContact, v, filters, meta, nowDate));
    return result;
    // `views` se deriva de `meta`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, casesByContact, filters, meta, nowDate]);

  const rows = rowsByView.get(view) ?? [];
  const demoChannelIds = useMemo(() => new Set(meta.demoChannelIds ?? []), [meta.demoChannelIds]);
  const typeById = useMemo(() => new Map(meta.caseTypes.map((t) => [t.id, t])), [meta.caseTypes]);
  const platforms = useMemo(
    () => [...new Set(conversations.map((c) => c.platform))].sort() as Platform[],
    [conversations],
  );
  const filterTypes = filters.caseTypeId && filters.caseTypeId !== "none"
    ? meta.caseTypes.filter((t) => t.id === filters.caseTypeId)
    : meta.caseTypes.filter((t) => !t.archived);
  const filterCount = activeFilterCount(filters);

  function setFilter<K extends keyof InboxFilters>(key: K, value: InboxFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value, ...(key === "caseTypeId" ? { stageId: "" } : {}) }));
  }

  return (
    <div className="flex h-full flex-col border-r border-border bg-background">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">Bandeja</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "conversación" : "conversaciones"}
          </span>
          {onSync && (
            <button
              onClick={onSync}
              disabled={syncing}
              title="Sincronizar conversaciones de Zernio"
              aria-label="Sincronizar conversaciones"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            </button>
          )}
        </div>
      </div>
      {syncError && <p className="border-b border-border px-4 py-1.5 text-xs text-destructive">{syncError}</p>}

      {/* Views */}
      <div className="flex flex-wrap gap-1 px-3 pt-3">
        {views.map((v) => {
          const count = rowsByView.get(v)?.length ?? 0;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              {VIEW_LABELS[v]}
              <span className={cn("text-[10px]", view === v ? "opacity-80" : "opacity-60")}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Search + filters */}
      <div className="flex gap-2 p-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar conversaciones..."
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors",
            showFilters || filterCount > 0
              ? "border-primary/40 bg-primary/5 text-foreground"
              : "border-input text-muted-foreground hover:bg-accent"
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros
          {filterCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
              {filterCount}
            </span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className="grid grid-cols-2 gap-2 border-b border-border px-3 pb-3">
          <select
            value={filters.caseTypeId}
            onChange={(e) => setFilter("caseTypeId", e.target.value)}
            className={selectClass}
            aria-label="Tipo de gestión"
          >
            <option value="">Todos los tipos</option>
            <option value="none">Sin clasificar</option>
            {meta.caseTypes
              .filter((t) => !t.archived)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <select
            value={filters.stageId}
            onChange={(e) => setFilter("stageId", e.target.value)}
            disabled={filters.caseTypeId === "none"}
            className={selectClass}
            aria-label="Etapa"
          >
            <option value="">Todas las etapas</option>
            {filterTypes.map((t) => (
              <optgroup key={t.id} label={t.name}>
                {t.stages
                  .filter((s) => s.kind === "open" && !s.archived)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilter("status", e.target.value as InboxFilters["status"])}
            className={selectClass}
            aria-label="Estado"
          >
            <option value="">Todos los estados</option>
            <option value="open">Abiertas</option>
            <option value="scheduled">Programadas</option>
            {view === "all" && <option value="none">Sin gestión</option>}
          </select>
          <select
            value={filters.assigneeId}
            onChange={(e) => setFilter("assigneeId", e.target.value)}
            className={selectClass}
            aria-label="Responsable"
          >
            <option value="">Todos los responsables</option>
            <option value="none">Sin asignar</option>
            {meta.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.userId === meta.userId ? `${m.name} (yo)` : m.name}
              </option>
            ))}
          </select>
          <select
            value={filters.platform}
            onChange={(e) => setFilter("platform", e.target.value as InboxFilters["platform"])}
            className={selectClass}
            aria-label="Canal"
          >
            <option value="">Todos los canales</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {platformLabel(p)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={filters.waitingOnly}
              onChange={(e) => setFilter("waitingOnly", e.target.checked)}
            />
            Esperando respuesta
          </label>
          {filterCount > 0 && (
            <button
              onClick={() => setFilters({ ...EMPTY_FILTERS, search: filters.search })}
              className="col-span-2 justify-self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              {view === "mine" && filterCount === 0 && !filters.search
                ? "No tienes gestiones asignadas"
                : "No se encontraron conversaciones"}
            </p>
          </div>
        ) : (
          rows.map((row) => {
            const { conversation, case: c } = row;
            const type = c?.case_type_id ? typeById.get(c.case_type_id) : null;
            const stage = type?.stages.find((s) => s.id === c?.stage_id);
            const waiting = c?.waiting_since ?? null;
            return (
              <button
                key={conversation.id}
                onClick={() => onSelect(row)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-border p-3 text-left transition-colors hover:bg-accent/50",
                  selectedId === conversation.id && "bg-accent"
                )}
              >
                {/* Avatar with platform badge */}
                <div className="relative flex-shrink-0">
                  {conversation.contacts?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={conversation.contacts.avatar_url}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                      {conversation.contacts?.display_name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 border-background bg-background">
                    <PlatformIcon
                      platform={conversation.platform}
                      className="h-3 w-3"
                      size={12}
                    />
                  </div>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{conversation.contacts?.display_name ?? "Desconocido"}</span>
                      {demoChannelIds.has(conversation.channel_id) && <DemoBadge />}
                    </p>
                    <span
                      suppressHydrationWarning
                      className="flex-shrink-0 text-[11px] text-muted-foreground"
                    >
                      {now !== null ? formatRelative(conversation.last_message_at, nowDate) : ""}
                    </span>
                  </div>

                  {c ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span
                        className="max-w-[9rem] truncate rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium"
                        style={
                          type?.color
                            ? { backgroundColor: `${type.color}20`, borderColor: `${type.color}40`, color: type.color }
                            : undefined
                        }
                      >
                        {type?.name ?? "Sin clasificar"}
                      </span>
                      {c.status === "scheduled" ? (
                        <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                          Programada
                        </span>
                      ) : (
                        stage && (
                          <span className="max-w-[8rem] truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {stage.name}
                          </span>
                        )
                      )}
                      <span className="inline-flex min-w-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                        <UserRound className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {c.assignee_id === meta.userId ? "Yo" : memberName(meta.members, c.assignee_id)}
                        </span>
                      </span>
                      {row.caseCount > 1 && (
                        <span className="text-[10px] text-muted-foreground">+{row.caseCount - 1}</span>
                      )}
                    </div>
                  ) : null}

                  {waiting && now !== null && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      <Clock className="h-3 w-3" />
                      {waitingText(formatRelative(waiting, nowDate))}
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {conversation.last_message_preview ?? "Aún no hay mensajes"}
                    </p>
                    {conversation.unread_count > 0 && (
                      <span className="ml-2 flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                        {conversation.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
