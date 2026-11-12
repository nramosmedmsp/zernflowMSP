"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, MessageSquare, RefreshCw, SlidersHorizontal, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { formatRelative } from "@/lib/format";
import { platformLabel } from "@/lib/platforms";
import type { Platform } from "@/lib/types/database";
import {
  EMPTY_FILTERS,
  DEFAULT_SCOPE,
  initialScope,
  DEFAULT_STATE,
  INBOX_STATES,
  STATE_LABELS,
  activeFilterCount,
  availableScopes,
  buildRows,
  emptyText,
  filtersForScope,
  parseStoredView,
  scopeLabel,
  viewHint,
  waitingText,
  type CaseLine,
  type InboxCase,
  type InboxConversation,
  type InboxFilters,
  type InboxMeta,
  type InboxRow,
  type InboxScope,
  type InboxState,
} from "./inbox-model";
import { ContactTypeChip } from "@/components/contacts/contact-type-ui";
import { DemoBadge } from "./demo-badge";
import { selectClass } from "./ui";
import { useNow } from "./use-now";
import { useDraftPreviews } from "./use-drafts";
import { useViewAs } from "@/components/view-as/view-as-context";
import { useInboxSearch } from "./use-inbox-search";
import { SEARCH_RESULT_LIMIT } from "./inbox-paging";

const NO_RESULTS = () => {};

const HEX = /^#[0-9a-f]{6}$/i;

/** Una gestión activa del chat: "● Postventa · Nueva · Luis   ⏱ vence en 3 h". */
function CaseLineView({ line }: { line: CaseLine }) {
  const color = line.typeColor && HEX.test(line.typeColor) ? line.typeColor : "#6b7280";
  const red = line.deadline?.tone === "red";
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]",
        red ? "bg-red-50 ring-1 ring-red-200 dark:bg-red-950/30 dark:ring-red-900/60" : "bg-muted/60",
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="shrink-0 font-semibold" style={{ color }}>
        {line.typeName}
      </span>
      <span className="truncate text-muted-foreground">
        · {line.stageText} · {line.assigneeText}
      </span>
      {line.deadline && (
        <span
          className={cn(
            "ml-auto inline-flex shrink-0 items-center gap-0.5 font-semibold",
            red ? "text-red-600 dark:text-red-300" : "text-amber-700 dark:text-amber-300",
          )}
        >
          <Clock className="h-2.5 w-2.5" />
          {line.deadline.label}
        </span>
      )}
    </div>
  );
}

/** Alcance y estado que cada persona dejó la última vez (solo en su navegador). */
const viewStorageKey = (workspaceId: string, userId: string) => `inbox:view:${workspaceId}:${userId}`;

export function ConversationList({
  workspaceId,
  conversations,
  casesByContact,
  meta,
  selectedId,
  onSelect,
  onSync,
  syncing = false,
  syncError = null,
  failedConversationIds,
  headerActions,
  casesTruncated = false,
  paging,
  onSearchResults,
}: {
  workspaceId: string;
  conversations: InboxConversation[];
  casesByContact: ReadonlyMap<string, InboxCase[]>;
  meta: InboxMeta;
  selectedId: string | null;
  onSelect: (row: InboxRow) => void;
  /** Solo administradores (la ruta de sincronización responde 403 a los demás). */
  onSync?: () => void;
  syncing?: boolean;
  syncError?: string | null;
  /** Chats con un envío que no salió (bandeja de salida). */
  failedConversationIds?: ReadonlySet<string>;
  /** Botones extra en la cabecera (por ejemplo, los avisos). */
  headerActions?: ReactNode;
  /** Hay más gestiones activas que el tope de lectura: los contadores pueden quedar cortos. */
  casesTruncated?: boolean;
  /** Chats sin gestión activa se cargan por páginas ("Todos / Todo"). */
  paging?: { hasMore: boolean; loading: boolean; failed: boolean; total: number | null; onLoadMore: () => void };
  /** Chats que encontró la búsqueda del servidor (se agregan a los cargados). */
  onSearchResults?: (list: InboxConversation[]) => void;
}) {
  const scopes = availableScopes(meta);
  const [scope, setScope] = useState<InboxScope>(DEFAULT_SCOPE);
  const [state, setState] = useState<InboxState>(DEFAULT_STATE);
  const [filters, setFilters] = useState<InboxFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  // Los tiempos relativos dependen del reloj del cliente: se muestran después
  // de montar para no provocar errores de hidratación (React #418).
  const now = useNow();
  const nowDate = useMemo(() => (now === null ? new Date() : new Date(now)), [now]);
  const drafts = useDraftPreviews({ userId: meta.userId, workspaceId });
  // "Ver como": no se lee ni se guarda la última vista de esa persona en este navegador.
  const viewing = useViewAs().active;

  // El último alcance y estado se leen después de montar (no hay localStorage en el servidor).
  const storageKey = viewStorageKey(workspaceId, meta.userId);
  // Sin vista guardada, un supervisor sin chats propios no debería empezar en un Míos vacío.
  const [viewRead, setViewRead] = useState(false);
  const hadSavedView = useRef(false);
  const autoScopeDone = useRef(false);
  useEffect(() => {
    const id = setTimeout(() => {
      let raw: string | null = null;
      try {
        raw = viewing ? null : window.localStorage.getItem(storageKey);
      } catch {
        // Sin almacenamiento: se queda en Míos / Todo.
      }
      hadSavedView.current = !!raw;
      setViewRead(true);
      if (!raw) return;
      const saved = parseStoredView(raw, availableScopes(meta));
      setScope(saved.scope);
      setState(saved.state);
      setFilters((prev) => filtersForScope(prev, saved.scope));
    }, 0);
    return () => clearTimeout(id);
    // Solo al montar o al cambiar de persona; `meta` no cambia el resultado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function choose(nextScope: InboxScope, nextState: InboxState) {
    setScope(nextScope);
    setState(nextState);
    setFilters((prev) => filtersForScope(prev, nextScope));
    if (viewing) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ scope: nextScope, state: nextState }));
    } catch {
      // Sin almacenamiento: la elección vale solo para esta sesión.
    }
  }

  // Búsqueda en el servidor sobre todos los chats que la persona puede ver.
  const search = useInboxSearch({ workspaceId, text: filters.search, onResults: onSearchResults ?? NO_RESULTS });

  // Por responder de cada alcance (insignias) y conteo de cada estado en el alcance actual (chips).
  const { waitingByScope, countByState, rows } = useMemo(() => {
    const build = (sc: InboxScope, st: InboxState) =>
      buildRows(conversations, casesByContact, sc, st, filtersForScope(filters, sc), meta, nowDate, search.hitIds);
    const waiting = new Map<InboxScope, number>();
    for (const sc of availableScopes(meta)) waiting.set(sc, build(sc, "waiting").length);
    const byState = new Map<InboxState, InboxRow[]>();
    for (const st of INBOX_STATES) byState.set(st, build(scope, st));
    return { waitingByScope: waiting, countByState: byState, rows: byState.get(state) ?? [] };
  }, [conversations, casesByContact, filters, meta, nowDate, scope, state, search.hitIds]);

  // Resultados del servidor que esta vista (Míos, Equipo, estado, filtros) deja fuera: se avisa.
  const searchHidden = useMemo(() => {
    if (!search.hitIds) return 0;
    const shown = new Set(rows.map((r) => r.conversation.id));
    let hidden = 0;
    for (const id of search.hitIds) if (!shown.has(id)) hidden++;
    return hidden;
  }, [search.hitIds, rows]);

  useEffect(() => {
    if (!viewRead || autoScopeDone.current) return;
    autoScopeDone.current = true;
    if (hadSavedView.current || scope !== DEFAULT_SCOPE) return;
    const next = initialScope(meta, countByState.get("all")?.length ?? 0);
    if (next !== scope) {
      setScope(next);
      setFilters((prev) => filtersForScope(prev, next));
    }
  }, [viewRead, scope, meta, countByState]);

  const demoChannelIds = useMemo(() => new Set(meta.demoChannelIds ?? []), [meta.demoChannelIds]);
  const contactTypeById = useMemo(() => new Map((meta.contactTypes ?? []).map((t) => [t.id, t])), [meta.contactTypes]);
  const platforms = useMemo(
    () => [...new Set(conversations.map((c) => c.platform))].sort() as Platform[],
    [conversations],
  );
  const filterTypes = filters.caseTypeId && filters.caseTypeId !== "none"
    ? meta.caseTypes.filter((t) => t.id === filters.caseTypeId)
    : meta.caseTypes.filter((t) => !t.archived);
  const filterCount = activeFilterCount(filters);
  // Un asesor solo ve los tipos de gestión que tiene en su lista.
  const canSeeOthers = meta.isAdmin || meta.supervisedTeamIds.length > 0;
  const usedTypeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const list of casesByContact.values()) for (const c of list) if (c.case_type_id) ids.add(c.case_type_id);
    return ids;
  }, [casesByContact]);

  function setFilter<K extends keyof InboxFilters>(key: K, value: InboxFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value, ...(key === "caseTypeId" ? { stageId: "" } : {}) }));
  }

  return (
    <div className="flex h-full flex-col border-r border-border bg-background">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">Bandeja</h2>
        <div className="flex items-center gap-2">
          {headerActions}
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
      {casesTruncated && (
        <p role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          Hay muchísimas gestiones activas: se cargaron las más urgentes y los números de arriba pueden quedar cortos. Para ver el resto usa Gestiones.
        </p>
      )}

      {/* Ver: de quién son los chats */}
      {scopes.length > 1 && (
        <div role="group" aria-label="Ver chats" className="mx-3 mt-3 flex gap-px rounded-lg bg-muted p-0.5">
          {scopes.map((sc) => {
            const count = waitingByScope.get(sc) ?? 0;
            const active = scope === sc;
            return (
              <button
                key={sc}
                onClick={() => choose(sc, state)}
                aria-pressed={active}
                className={cn(
                  "inline-flex min-w-0 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-md px-1 py-1 text-xs font-medium transition-colors",
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{scopeLabel(meta, sc)}</span>
                {count > 0 && (
                  <span
                    aria-label={`${count} por responder`}
                    className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white"
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Estado: qué hay que hacer */}
      <div className="flex gap-1 px-3 pt-2">
        {INBOX_STATES.map((st) => {
          const count = st === "all" ? 0 : countByState.get(st)?.length ?? 0;
          const active = state === st;
          return (
            <button
              key={st}
              onClick={() => choose(scope, st)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              {STATE_LABELS[st]}
              {count > 0 && <span className={cn("text-[10px]", active ? "opacity-80" : "opacity-70")}>{count}</span>}
            </button>
          );
        })}
      </div>
      <p className="px-3 pt-1.5 text-xs text-muted-foreground">{viewHint(scope, state)}</p>

      {/* Search + filters */}
      <div className="flex gap-2 px-3 pb-3 pt-2">
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

      {filters.search.trim() && (search.searching || search.failed || search.limited || searchHidden > 0) && (
        <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">
          {search.searching
            ? "Buscando en todos tus chats…"
            : search.failed
              ? "No se pudo buscar en todos los chats; se muestran solo los ya cargados."
              : [
                  search.limited ? `Hay más de ${SEARCH_RESULT_LIMIT} resultados: escribe más para afinar.` : "",
                  searchHidden > 0
                    ? `${searchHidden} ${searchHidden === 1 ? "resultado queda" : "resultados quedan"} en otras vistas${scopes.length > 1 ? " (cambia Míos, Todos o el estado)" : ""}.`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
        </p>
      )}

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
              .filter((t) => !t.archived && (canSeeOthers || usedTypeIds.has(t.id)))
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
            {scope === "all" && <option value="none">Sin gestión</option>}
          </select>
          {/* En «Míos» todo es del mismo responsable; un asesor no ve las gestiones de otros. */}
          {scope !== "mine" && (
            <select
              value={filters.assigneeId}
              onChange={(e) => setFilter("assigneeId", e.target.value)}
              className={selectClass}
              aria-label="Responsable"
            >
              <option value="">Todos los responsables</option>
              <option value="none">Sin asignar</option>
              {(canSeeOthers ? meta.members.filter((m) => !m.sample) : meta.members.filter((m) => m.userId === meta.userId)).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === meta.userId ? `${m.name} (yo)` : m.name}
                </option>
              ))}
            </select>
          )}
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
      <div className="stagger-list flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              {emptyText(scope, state, filterCount > 0 || !!filters.search.trim())}
            </p>
          </div>
        ) : (
          rows.map((row) => {
            const { conversation, case: c } = row;
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

                  {/* Una línea por gestión activa del chat, la más urgente primero. */}
                  {row.lines.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {row.lines.map((line) => (
                        <CaseLineView key={line.id} line={line} />
                      ))}
                    </div>
                  )}

                  {waiting && now !== null && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      <Clock className="h-3 w-3" />
                      {waitingText(formatRelative(waiting, nowDate))}
                    </p>
                  )}

                  {selectedId !== conversation.id && drafts.has(conversation.id) && (
                    <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs">
                      <span className="shrink-0 font-medium text-primary">Borrador:</span>
                      <span className="truncate text-muted-foreground">{drafts.get(conversation.id)}</span>
                    </p>
                  )}

                  {failedConversationIds?.has(conversation.id) && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      No se envió tu último mensaje
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {conversation.last_message_preview === null
                        ? "Aún no hay mensajes"
                        : conversation.last_message_preview || "Mensaje sin texto"}
                    </p>
                    {conversation.unread_count > 0 && (
                      <span className="ml-2 flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                        {conversation.unread_count}
                      </span>
                    )}
                  </div>

                  {conversation.contacts?.contact_type_id && contactTypeById.has(conversation.contacts.contact_type_id) && (
                    <div className="mt-1">
                      <ContactTypeChip type={contactTypeById.get(conversation.contacts.contact_type_id) ?? null} small />
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
        {paging && scope === "all" && state === "all" && !filters.search.trim() && (paging.hasMore || paging.failed) && (
          <div className="border-t border-border p-3 text-center">
            <p className="text-xs text-muted-foreground">
              {paging.total !== null
                ? `Mostrando ${rows.length} de ${paging.total} chats. Los más antiguos todavía no se cargan.`
                : "Los chats más antiguos todavía no se cargan."}
            </p>
            {paging.failed && <p className="mt-1 text-xs text-destructive">No se pudieron cargar más chats. Reintenta.</p>}
            <button
              type="button"
              onClick={paging.onLoadMore}
              disabled={paging.loading}
              className="mt-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {paging.loading ? "Cargando…" : "Cargar más chats"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
