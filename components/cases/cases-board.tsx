"use client";

// Gestiones, vista "Tablero": las gestiones abiertas de UN tipo, una columna por
// etapa (con su número y contador) y, al final, "Cerrar" con una zona por cada
// resultado final. Arrastrar una tarjeta a otra columna cambia el paso con las
// MISMAS reglas que la tarjeta del chat (permisos, orden estricto, lo que pide la
// etapa actual: board-model.ts) y el servidor las vuelve a validar; soltarla en
// una zona de "Cerrar" abre el cierre de siempre (CloseCasePanel) con ese
// resultado elegido. Sin arrastrar: el menú «Mover a…» de cada tarjeta ofrece los
// mismos destinos con sus candados. API nativa de arrastrar y soltar (sin
// dependencias); en pantallas táctiles se usa el menú.

import { isCaseConflict } from "@/lib/cases/conflict";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  Clock,
  Flag,
  GripVertical,
  Loader2,
  Lock,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { Modal } from "@/components/inbox/ui";
import { CloseCasePanel } from "@/components/inbox/close-case-panel";
import { useNow } from "@/components/inbox/use-now";
import { useViewAs } from "@/components/view-as/view-as-context";
import { VIEW_AS_UNAVAILABLE_NOTE } from "@/lib/view-as/ui-rules";
import { startRouteProgress } from "@/components/ui/route-progress";
import { closeOptions, relativeDayTime } from "@/components/inbox/case-card-model";
import { caseRowHref, formatWaiting, type CaseTab } from "@/components/cases/case-filters";
import {
  BOARD_COLUMN_LIMIT,
  BOARD_PAGE_SIZE,
  boardOpenStages,
  boardPermissions,
  boardHeadline,
  groupByStage,
  moveTargets,
  visibleTypeChips,
  type BoardActor,
  type BoardSortable,
  type BoardTarget,
  type DropVerdict,
} from "@/components/cases/board-model";
import type { BoardCardRow, BoardResult } from "@/app/(dashboard)/dashboard/cases/load-cases";
import {
  changeCaseStage,
  getContactCases,
  undoCaseStageChange,
  type CaseTypeOption,
  type CaseView,
  type ContactCasesView,
} from "@/lib/actions/cases";
import { deadlineChip, solutionScheduleFor, type SolutionSchedules } from "@/lib/cases/protection";
import { UNDO_WINDOW_MS, undoneMessage } from "@/lib/cases/undo";

const HEX = /^#[0-9a-f]{6}$/i;
/** Hasta cuándo se ofrece «Deshacer». */
const undoDeadline = () => Date.now() + UNDO_WINDOW_MS;
const GENERIC_ERROR = "No se pudo hacer el cambio. Inténtalo de nuevo.";

type Toast =
  | { kind: "moved"; caseId: string; fromStageId: string | null; toStageId: string; fromName: string; toName: string; irreversible: string | null; expiresAt: number }
  | { kind: "info"; text: string }
  | { kind: "error"; text: string }
  | { kind: "lock"; text: string }
  | { kind: "requirement"; text: string; href: string };

interface ClosingState {
  view: CaseView;
  type: CaseTypeOption | null;
  stageId: string | null;
  contactName: string;
  contactTypeName: (id: string | null) => string | null;
}

export interface CasesBoardProps {
  board: BoardResult;
  tab: CaseTab;
  nowIso: string;
  memberName: ReadonlyMap<string, string>;
  solutionSchedules?: SolutionSchedules | null;
  actor: BoardActor;
  pending: boolean;
  onSelectType: (typeId: string) => void;
}

export function CasesBoard({ board, tab, nowIso, memberName, solutionSchedules, actor, pending, onSelectType }: CasesBoardProps) {
  const router = useRouter();
  const viewAs = useViewAs();
  const readOnly = viewAs.active;
  const nowMs = useNow();
  const now = useMemo(() => new Date(nowMs ?? Date.parse(nowIso)), [nowMs, nowIso]);

  // Copia local de las tarjetas: los movimientos se ven al instante y se revierten si el servidor los rechaza.
  const [cards, setCards] = useState<BoardCardRow[]>(board.cards);
  const [prevCards, setPrevCards] = useState(board.cards);
  if (prevCards !== board.cards) {
    setPrevCards(board.cards);
    setCards(board.cards);
  }
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [closing, setClosing] = useState<ClosingState | null>(null);
  const [menu, setMenu] = useState<{ cardId: string; top: number; left: number } | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});

  const type = board.type;
  const columns = useMemo(() => boardOpenStages(board.stages), [board.stages]);
  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const rules = useMemo(
    () =>
      type
        ? { strictOrder: type.strictOrder, isProtected: type.isProtected, hasCategories: type.hasCategories, stages: board.stages }
        : null,
    [type, board.stages],
  );
  const sortable = useMemo(
    () =>
      cards.map(
        (c): BoardCardRow & BoardSortable => ({
          ...c,
          deadlineHours: type?.solutionDeadlineHours ?? null,
          schedule: solutionScheduleFor(solutionSchedules, c.teamId),
        }),
      ),
    [cards, type, solutionSchedules],
  );
  const grouped = useMemo(() => groupByStage(sortable, columnIds, tab, now), [sortable, columnIds, tab, now]);
  // Gestiones de la columna que no se cargaron (más allá del tope por columna).
  const unloaded = useMemo(() => {
    const original = groupByStage(board.cards.map((c) => ({ ...c, deadlineHours: null, schedule: null })), columnIds, tab, now);
    const out: Record<string, number> = {};
    for (const id of columnIds) out[id] = Math.max(0, (board.columnTotals[id] ?? 0) - (original.get(id)?.length ?? 0));
    return out;
  }, [board.cards, board.columnTotals, columnIds, tab, now]);
  const totalOpen = columnIds.reduce((sum, id) => sum + (grouped.get(id)?.length ?? 0) + unloaded[id], 0);

  const targetsOf = (card: BoardCardRow): BoardTarget[] =>
    rules ? moveTargets(card, boardPermissions(actor, card), rules, { readOnly }) : [];
  const dragCard = dragId ? (cards.find((c) => c.id === dragId) ?? null) : null;
  const dragTargets = useMemo(
    () => (dragCard && rules ? moveTargets(dragCard, boardPermissions(actor, dragCard), rules, { readOnly }) : []),
    [dragCard, rules, actor, readOnly],
  );
  const verdictFor = (group: "stage" | "close", stageId: string | null): DropVerdict | null =>
    dragTargets.find((t) => t.group === group && t.stageId === stageId)?.verdict ?? null;

  const stageName = (id: string | null) => (id ? (board.stages.find((s) => s.id === id)?.name ?? null) : null);

  // El aviso de «Pasó a …» se apaga solo al acabar la ventana de deshacer; los demás, al rato.
  useEffect(() => {
    if (!toast || toast.kind === "error" || toast.kind === "requirement") return;
    const wait = toast.kind === "moved" ? Math.max(0, toast.expiresAt - Date.now()) : toast.kind === "info" ? 7000 : 5000;
    const timer = setTimeout(() => setToast(null), wait);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  function setStage(caseId: string, stageId: string | null) {
    setCards((list) => list.map((c) => (c.id === caseId ? { ...c, stageId } : c)));
  }

  async function moveCard(card: BoardCardRow, verdict: Extract<DropVerdict, { kind: "stage" }>) {
    const fromStageId = card.stageId;
    setToast(null);
    setStage(card.id, verdict.stageId);
    setBusyId(card.id);
    let result: Awaited<ReturnType<typeof changeCaseStage>>;
    try {
      result = await changeCaseStage(card.id, verdict.stageId, { fromStageId, ...(verdict.jump ? { jump: true } : {}) });
    } catch {
      result = { error: GENERIC_ERROR };
    }
    setBusyId(null);
    if ("error" in result) {
      setStage(card.id, fromStageId);
      setToast({ kind: "error", text: result.error });
      // Otra persona la movió antes: se recarga el tablero para ver cómo quedó.
      if (isCaseConflict(result.error)) router.refresh();
      return;
    }
    if (result.move) {
      setToast({
        kind: "moved",
        caseId: card.id,
        fromStageId,
        toStageId: result.move.toStageId,
        fromName: stageName(fromStageId) ?? "el paso anterior",
        toName: verdict.name,
        irreversible: result.move.irreversible,
        expiresAt: undoDeadline(),
      });
    } else {
      setToast({ kind: "info", text: `Pasó a ${verdict.name}` });
    }
    router.refresh();
  }

  async function undoMove(t: Extract<Toast, { kind: "moved" }>) {
    setToast(null);
    setStage(t.caseId, t.fromStageId);
    setBusyId(t.caseId);
    let result: Awaited<ReturnType<typeof undoCaseStageChange>>;
    try {
      result = await undoCaseStageChange(t.caseId, t.toStageId);
    } catch {
      result = { error: GENERIC_ERROR };
    }
    setBusyId(null);
    if ("error" in result) {
      setStage(t.caseId, t.toStageId);
      setToast({ kind: "error", text: result.error });
      return;
    }
    setToast({ kind: "info", text: undoneMessage(t.fromName, t.irreversible) });
    router.refresh();
  }

  async function startClose(card: BoardCardRow, verdict: Extract<DropVerdict, { kind: "close" }>) {
    setToast(null);
    setBusyId(card.id);
    let result: Awaited<ReturnType<typeof getContactCases>>;
    try {
      result = await getContactCases(card.contactId, card.id);
    } catch {
      result = { error: GENERIC_ERROR };
    }
    setBusyId(null);
    if ("error" in result) {
      setToast({ kind: "error", text: result.error });
      return;
    }
    const data: ContactCasesView = result.data;
    const view = data.cases.find((c) => c.id === card.id);
    if (!view || view.status !== "open") {
      setToast({ kind: "error", text: "Esta gestión ya no está abierta." });
      router.refresh();
      return;
    }
    setClosing({
      view,
      type: data.caseTypes.find((t) => t.id === view.caseTypeId) ?? null,
      stageId: verdict.stageId,
      contactName: card.contactName ?? "Desconocido",
      contactTypeName: (id) => data.contactTypes.find((t) => t.id === id)?.name ?? null,
    });
  }

  /** Aplica el veredicto de un destino (soltar o menú): mueve, abre el cierre o explica por qué no. */
  function applyVerdict(card: BoardCardRow, verdict: DropVerdict, name?: string) {
    if (!verdict.ok) {
      if (verdict.reason === "current") return;
      if (verdict.reason === "requirement") {
        setToast({ kind: "requirement", text: verdict.message, href: caseRowHref(card.contactId, card.id, card.hasConversation) });
      } else if (verdict.reason === "locked") {
        setToast({ kind: "lock", text: name ? `${name}: ${verdict.message}` : verdict.message });
      } else {
        setToast({ kind: "error", text: verdict.message });
      }
      return;
    }
    if (verdict.kind === "stage") void moveCard(card, verdict);
    else void startClose(card, verdict);
  }

  // ── Arrastrar y soltar ──
  function onDragStart(e: DragEvent, card: BoardCardRow) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.id);
    setMenu(null);
    setToast(null);
    // Se marca después del primer pintado para que la imagen de arrastre sea la tarjeta tal cual.
    setTimeout(() => setDragId(card.id), 0);
  }
  function endDrag() {
    setDragId(null);
    setOverKey(null);
  }
  function onDragOver(e: DragEvent, key: string, verdict: DropVerdict | null) {
    if (!dragId) return;
    const accepts = !!verdict && (verdict.ok || verdict.reason === "requirement");
    if (!accepts) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overKey !== key) setOverKey(key);
  }
  function onDrop(e: DragEvent, verdict: DropVerdict | null) {
    e.preventDefault();
    const card = dragCard;
    endDrag();
    if (card && verdict) applyVerdict(card, verdict);
  }

  function openMenu(card: BoardCardRow, button: HTMLElement) {
    if (readOnly) {
      setToast({ kind: "error", text: viewAs.blockedNotice ?? "Estás viendo la cuenta de otra persona: no se puede cambiar nada." });
      return;
    }
    const rect = button.getBoundingClientRect();
    const width = 260;
    setMenu({
      cardId: card.id,
      top: Math.min(rect.bottom + 4, window.innerHeight - 320),
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    });
  }

  const chips = visibleTypeChips(board.chips, type?.id ?? null);
  const menuCard = menu ? (cards.find((c) => c.id === menu.cardId) ?? null) : null;
  // Zonas de cierre: siempre visibles; al arrastrar se ve cuáles acepta esa tarjeta.
  const zones = closeOptions(board.stages).map((o) => ({
    stageId: o.stageId,
    name: o.name,
    tone: o.tone,
    verdict: dragTargets.find((t) => t.group === "close" && t.stageId === o.stageId)?.verdict ?? null,
  }));

  if (board.chips.length === 0 || !type) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Flag className="h-10 w-10 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium text-muted-foreground">No hay tipos de gestión activos</p>
        <p className="mt-1 text-xs text-muted-foreground/70">Crea uno en Configuración → Gestiones para usar el tablero.</p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", pending && "opacity-70")} data-testid="board">
      {/* Tipo */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-8">
        <span className="text-sm text-muted-foreground" id="board-type-label">
          Tipo:
        </span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="board-type-label">
          {chips.map((c) => {
            const selected = c.id === type.id;
            const color = c.color && HEX.test(c.color) ? c.color : null;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => !selected && onSelectType(c.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                  selected ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-accent",
                )}
              >
                {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
                {c.name}
                <span className="text-xs text-muted-foreground">{c.count}</span>
              </button>
            );
          })}
        </div>
        <p className="ml-auto text-xs text-muted-foreground">
          {readOnly
            ? VIEW_AS_UNAVAILABLE_NOTE
            : "Arrastra una tarjeta a otra columna o a «Cerrar», o usa «Mover a…»."}
        </p>
      </div>
      <h2 className="sr-only">{boardHeadline(totalOpen, type.name, tab)}</h2>

      {/* Columnas */}
      <div className="min-h-0 flex-1 overflow-x-auto px-4 py-4 sm:px-8">
        <div className="flex h-full min-w-max items-stretch gap-3">
          {columns.map((col, index) => {
            const list = grouped.get(col.id) ?? [];
            const limit = shown[col.id] ?? BOARD_PAGE_SIZE;
            const total = list.length + unloaded[col.id];
            const verdict = verdictFor("stage", col.id);
            const dragging = !!dragCard;
            const isCurrent = dragCard && verdict && !verdict.ok && verdict.reason === "current";
            const accepts = !!verdict && (verdict.ok || verdict.reason === "requirement");
            const locked = !!verdict && !verdict.ok && verdict.reason === "locked";
            const needs = !!verdict && !verdict.ok && verdict.reason === "requirement";
            const hover = overKey === `stage:${col.id}`;
            return (
              <section
                key={col.id}
                aria-label={`Paso ${index + 1}: ${col.name}`}
                data-stage-id={col.id}
                onDragOver={(e) => onDragOver(e, `stage:${col.id}`, verdict)}
                onDragLeave={() => overKey === `stage:${col.id}` && setOverKey(null)}
                onDrop={(e) => onDrop(e, verdict)}
                className={cn(
                  "flex h-full w-72 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors",
                  !dragging && "border-transparent",
                  dragging && accepts && !needs && "border-dashed border-primary/50 bg-primary/5",
                  dragging && needs && "border-dashed border-amber-400 bg-amber-50/60 dark:bg-amber-950/20",
                  dragging && locked && "border-dashed border-border bg-muted/70 opacity-70",
                  dragging && isCurrent && "border-transparent",
                  hover && "border-solid border-primary bg-primary/10 ring-2 ring-primary/30",
                )}
              >
                <header className="flex items-start gap-2 px-3 pb-2 pt-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold text-muted-foreground shadow-sm">
                    {index + 1}
                  </span>
                  <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug">{col.name}</h3>
                  <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground" aria-label={`${total} gestiones`}>
                    {total}
                  </span>
                </header>
                {dragging && locked && (
                  <p className="mx-2 mb-2 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-1.5 text-xs font-medium">
                    <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {verdict && !verdict.ok ? verdict.message : ""}
                  </p>
                )}
                {dragging && needs && verdict && !verdict.ok && (
                  <p className="mx-2 mb-2 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {verdict.message}
                  </p>
                )}
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
                  {list.slice(0, limit).map((card) => (
                    <BoardCardView
                      key={card.id}
                      card={card}
                      now={now}
                      assignee={card.assigneeId ? (memberName.get(card.assigneeId) ?? "Alguien") : null}
                      deadlineHours={type.solutionDeadlineHours}
                      schedules={solutionSchedules}
                      canDrag={boardPermissions(actor, card).canEdit && !readOnly && busyId === null}
                      dragging={dragId === card.id}
                      busy={busyId === card.id}
                      readOnly={readOnly}
                      menuOpen={menu?.cardId === card.id}
                      onDragStart={(e) => onDragStart(e, card)}
                      onDragEnd={endDrag}
                      onOpenMenu={(button) => openMenu(card, button)}
                    />
                  ))}
                  {list.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      Sin gestiones
                    </div>
                  )}
                  {list.length > limit && (
                    <button
                      type="button"
                      onClick={() => setShown((s) => ({ ...s, [col.id]: limit + BOARD_PAGE_SIZE }))}
                      className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                      Ver más ({list.length - limit})
                    </button>
                  )}
                  {unloaded[col.id] > 0 && list.length <= limit && (
                    <p className="px-1 text-center text-[11px] text-muted-foreground">
                      Se muestran las {BOARD_COLUMN_LIMIT} más urgentes de {total}. Usa los filtros para acotar.
                    </p>
                  )}
                </div>
              </section>
            );
          })}

          {/* Cerrar */}
          <section
            aria-label="Cerrar"
            className="flex h-full w-72 shrink-0 flex-col rounded-xl border border-dashed border-border bg-muted/20"
          >
            <header className="flex items-center gap-2 px-3 pb-2 pt-3">
              <Flag className="h-4 w-4 text-muted-foreground" aria-hidden />
              <h3 className="text-sm font-semibold">Cerrar</h3>
            </header>
            <div className="flex flex-col gap-2.5 px-2 pb-3">
              {zones.map((z) => {
                const positive = z.tone === "positive";
                const verdict = z.verdict;
                const key = `close:${z.stageId ?? "none"}`;
                const accepts = !!verdict && verdict.ok;
                const blocked = !!verdict && !verdict.ok;
                const approval = verdict?.ok && verdict.kind === "close" ? verdict.needsApproval : false;
                return (
                  <div
                    key={key}
                    data-close-zone={z.name}
                    onDragOver={(e) => onDragOver(e, key, verdict)}
                    onDragLeave={() => overKey === key && setOverKey(null)}
                    onDrop={(e) => onDrop(e, verdict)}
                    className={cn(
                      "flex min-h-24 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-dashed px-3 py-3 text-center transition-colors",
                      positive
                        ? "border-green-400/70 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/20 dark:text-green-300"
                        : "border-red-300/80 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300",
                      blocked && "opacity-45",
                      accepts && overKey === key && (positive ? "border-solid bg-green-100 ring-2 ring-green-400/50" : "border-solid bg-red-100 ring-2 ring-red-300/60"),
                    )}
                  >
                    {positive ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                    <span className="text-sm font-semibold">{z.name}</span>
                    <span className="text-[11px] opacity-90">
                      {blocked && verdict && !verdict.ok
                        ? verdict.message
                        : approval
                          ? "pide aprobación de un supervisor"
                          : "pide confirmar el cierre"}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {/* Menú «Mover a…» */}
      {menu && menuCard && (
        <MoveMenu
          card={menuCard}
          top={menu.top}
          left={menu.left}
          targets={targetsOf(menuCard)}
          onClose={() => setMenu(null)}
          onPick={(t) => {
            setMenu(null);
            applyVerdict(menuCard, t.verdict, t.name);
          }}
        />
      )}

      {toast && <BoardToast toast={toast} busy={busyId !== null} onUndo={undoMove} onClose={() => setToast(null)} />}

      <Modal
        open={!!closing}
        title={closing ? `Cerrar gestión · ${closing.contactName}` : "Cerrar gestión"}
        onClose={() => setClosing(null)}
        className="max-w-xl"
      >
        {closing && (
          <CloseCasePanel
            caseView={closing.view}
            caseType={closing.type}
            stageId={closing.stageId}
            contactTypeName={closing.contactTypeName}
            hideResultPicker
            onCancel={() => setClosing(null)}
            onClosed={(message, problem) => {
              setClosing(null);
              setToast(problem ? { kind: "error", text: message } : { kind: "info", text: message });
              router.refresh();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- Tarjeta

function BoardCardView({
  card,
  now,
  assignee,
  deadlineHours,
  schedules,
  canDrag,
  dragging,
  busy,
  readOnly,
  menuOpen,
  onDragStart,
  onDragEnd,
  onOpenMenu,
}: {
  card: BoardCardRow;
  now: Date;
  assignee: string | null;
  deadlineHours: number | null;
  schedules: SolutionSchedules | null | undefined;
  canDrag: boolean;
  dragging: boolean;
  busy: boolean;
  /** «Ver como»: «Mover a…» queda apagado. */
  readOnly: boolean;
  menuOpen: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onOpenMenu: (button: HTMLElement) => void;
}) {
  const router = useRouter();
  const href = caseRowHref(card.contactId, card.id, card.hasConversation);
  const text = card.nextActionNote?.trim() || card.preview?.trim() || null;
  const overdue = card.nextActionAt !== null && new Date(card.nextActionAt).getTime() < now.getTime();
  const waiting = formatWaiting(card.waitingSince, now);
  const chip = deadlineChip(
    {
      status: card.status,
      openedAt: card.openedAt,
      solutionSchedule: solutionScheduleFor(schedules, card.teamId),
      solutionClockAt: card.solutionClockAt,
      solutionStatus: card.solutionStatus,
      solutionNote: card.solutionNote,
      nextActionAt: card.nextActionAt,
      hasCloseRequest: card.hasCloseRequest,
    },
    deadlineHours,
    now,
  );
  return (
    <article
      draggable={canDrag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        startRouteProgress();
        router.push(href);
      }}
      data-case-id={card.id}
      aria-label={`Gestión de ${card.contactName ?? "Desconocido"}`}
      aria-busy={busy}
      className={cn(
        "group relative cursor-pointer rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        canDrag && "active:cursor-grabbing",
        dragging && "opacity-40",
        menuOpen && "ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {card.contactName?.[0]?.toUpperCase() ?? "?"}
          </div>
          {card.platform && (
            <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card bg-card">
              <PlatformIcon platform={card.platform} className="h-2.5 w-2.5" size={10} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link href={href} draggable={false} className="block truncate text-sm font-semibold hover:underline">
            {card.contactName ?? "Desconocido"}
          </Link>
          {text && <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{text}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Guardando" />
          ) : (
            <>
              {canDrag && <GripVertical className="h-4 w-4 text-muted-foreground/60" aria-hidden />}
              <button
                type="button"
                aria-label={`Mover a… (${card.contactName ?? "gestión"})`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={(e) => onOpenMenu(e.currentTarget)}
                disabled={readOnly}
                title={readOnly ? VIEW_AS_UNAVAILABLE_NOTE : undefined}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" suppressHydrationWarning>
        <span
          className={cn(
            "rounded bg-muted px-1.5 py-0.5 font-medium",
            !assignee && "text-muted-foreground",
          )}
        >
          {assignee ?? "Sin asignar"}
        </span>
        {card.nextActionAt && (
          <span className={cn("inline-flex items-center gap-1", overdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            <Clock className="h-3 w-3" aria-hidden />
            {relativeDayTime(new Date(card.nextActionAt), now)}
          </span>
        )}
        {chip && (
          <span
            className={cn(
              "rounded-full px-1.5 py-px text-[10px] font-semibold",
              chip.tone === "red" ? "bg-red-500/15 text-red-600 dark:text-red-300" : "bg-amber-500/20 text-amber-700 dark:text-amber-300",
            )}
          >
            {chip.label}
          </span>
        )}
        {waiting && <span className="text-muted-foreground">espera {waiting}</span>}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------- Menú «Mover a…»

function MoveMenu({
  card,
  top,
  left,
  targets,
  onClose,
  onPick,
}: {
  card: BoardCardRow;
  top: number;
  left: number;
  targets: BoardTarget[];
  onClose: () => void;
  onPick: (target: BoardTarget) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button[role=menuitem]:not([aria-disabled=true])")?.focus();
  }, []);
  const stages = targets.filter((t) => t.group === "stage");
  const closes = targets.filter((t) => t.group === "close");

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  const renderItem = (t: BoardTarget) => {
    const v = t.verdict;
    const current = !v.ok && v.reason === "current";
    const lockedItem = !v.ok && (v.reason === "locked" || v.reason === "no_edit" || v.reason === "pending_request" || v.reason === "read_only");
    const needs = !v.ok && v.reason === "requirement";
    return (
      <button
        type="button"
        role="menuitem"
        aria-disabled={current || lockedItem ? true : undefined}
        aria-current={current ? "step" : undefined}
        title={!v.ok && v.message ? v.message : undefined}
        onClick={() => !current && onPick(t)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
          current || lockedItem ? "cursor-not-allowed text-muted-foreground" : "hover:bg-accent focus:bg-accent focus:outline-none",
        )}
      >
        {t.number !== null ? (
          <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{t.number}</span>
        ) : t.tone === "positive" ? (
          <Check className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
        ) : (
          <X className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">
          {t.group === "close" ? `Cerrar como ${t.name}` : t.name}
          {current && <span className="ml-1 text-[11px]">(aquí)</span>}
        </span>
        {lockedItem && <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        {needs && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />}
      </button>
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="menu"
        aria-label={`Mover a… (${card.contactName ?? "gestión"})`}
        onKeyDown={onKeyDown}
        style={{ top, left, width: 260 }}
        className="animate-pop-in fixed z-50 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mover a…</p>
        {stages.map((t) => (
          <div key={`s-${t.stageId}`}>{renderItem(t)}</div>
        ))}
        {closes.length > 0 && <div className="my-1 border-t border-border" role="separator" />}
        {closes.map((t) => (
          <div key={`c-${t.stageId ?? "none"}`}>{renderItem(t)}</div>
        ))}
        {stages.some((t) => !t.verdict.ok && t.verdict.reason === "locked") && (
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] text-muted-foreground">Con candado: orden estricto, pídele a un supervisor.</p>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Avisos

function BoardToast({
  toast,
  busy,
  onUndo,
  onClose,
}: {
  toast: Toast;
  busy: boolean;
  onUndo: (t: Extract<Toast, { kind: "moved" }>) => void;
  onClose: () => void;
}) {
  const tone =
    toast.kind === "error"
      ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200"
      : toast.kind === "requirement"
        ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200"
        : toast.kind === "lock"
          ? "border-border bg-card text-foreground"
          : "border-green-300 bg-green-50 text-green-900 dark:border-green-900/60 dark:bg-green-950/60 dark:text-green-200";
  return (
    <div
      role={toast.kind === "error" || toast.kind === "requirement" ? "alert" : "status"}
      className={cn(
        "animate-pop-in fixed bottom-6 left-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border px-4 py-3 shadow-lg",
        tone,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {toast.kind === "moved" && <Check className="h-4 w-4 shrink-0" aria-hidden />}
        {toast.kind === "info" && <Check className="h-4 w-4 shrink-0" aria-hidden />}
        {toast.kind === "lock" && <Lock className="h-4 w-4 shrink-0" aria-hidden />}
        {(toast.kind === "error" || toast.kind === "requirement") && <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1 basis-48 text-sm font-medium">
          {toast.kind === "moved" ? `Pasó a ${toast.toName}` : toast.text}
        </span>
        {toast.kind === "moved" && (
          <button
            type="button"
            onClick={() => onUndo(toast)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-green-300 bg-background px-3 py-1 text-xs font-semibold text-green-900 hover:bg-green-100 disabled:opacity-60 dark:border-green-800 dark:text-green-200 dark:hover:bg-green-950"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            Deshacer
          </button>
        )}
        {toast.kind === "requirement" && (
          <Link
            href={toast.href}
            onClick={() => startRouteProgress()}
            className="rounded-lg border border-amber-400 bg-background px-3 py-1 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-950"
          >
            Abrir en el chat
          </Link>
        )}
        {toast.kind !== "moved" && (
          <button type="button" onClick={onClose} aria-label="Cerrar aviso" className="opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        )}
        {toast.kind === "moved" && toast.irreversible && (
          <p className="basis-full text-[11px] leading-snug text-amber-900 dark:text-amber-200">{toast.irreversible}</p>
        )}
      </div>
      {toast.kind === "moved" && (
        <span
          aria-hidden
          key={toast.expiresAt}
          className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-green-500"
          style={{ animation: `undo-shrink ${UNDO_WINDOW_MS}ms linear forwards` }}
        />
      )}
    </div>
  );
}
