"use client";

// Tarjeta de gestión en la cabecera del chat (docs/FASE-1-TECNICO.md 4.1), en
// dos filas: (1) qué es y quién lo tiene, con las acciones (tipo, responsable,
// próximo contacto, Cerrar, ⋯) y (2) en qué va (etapas y categoría). Todas las
// escrituras pasan por las acciones de lib/actions/cases.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Hand,
  History,
  Hourglass,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  Repeat,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import {
  approveCloseRequest,
  assignCase,
  changeCaseStage,
  classifyCase,
  postponeCase,
  registerSolutionInProgress,
  rejectCloseRequest,
  setCaseCategory,
  setNextAction,
  takeCase,
  transferCase,
  type CaseActionResult,
  type CaseTypeOption,
  type CaseView,
  type ContactCasesView,
} from "@/lib/actions/cases";
import { limaDateOf } from "@/lib/cases/dates";
import { OUTCOME_LABELS } from "@/lib/cases/rules";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { CaseHistoryDialog } from "./case-history";
import { CloseCaseDialog } from "./close-case-dialog";
import { NewCaseDialog } from "./new-case-dialog";
import {
  closeMenuItems,
  closeOptions,
  closeRequestLine,
  nextContactChip,
  nextContactOptions,
  solutionBanner,
  stageSteps,
  typeChangeLock,
  type CloseOption,
  type SolutionTone,
} from "./case-card-model";
import { SolutionForm } from "./solution-form";
import { memberName, type InboxMember } from "./inbox-model";
import { Popover, inputClass, primaryButtonClass, secondaryButtonClass, selectClass } from "./ui";
import { useNow } from "./use-now";

const chipButton =
  "inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";

const menuItem =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50";

const menuHeading = "px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase text-muted-foreground";

const HEX = /^#[0-9a-f]{6}$/i;

const BANNER_TONE: Record<SolutionTone, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
  red: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
  ok: "border-green-200 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300",
};

function TypeDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground"
      style={color && HEX.test(color) ? { backgroundColor: color } : undefined}
    />
  );
}

export function CaseCard({
  data,
  activeCaseId,
  members,
  onSelectCase,
  onChanged,
}: {
  data: ContactCasesView;
  activeCaseId: string | null;
  members: InboxMember[];
  onSelectCase: (caseId: string) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const now = useNow();
  const [closing, setClosing] = useState<CloseOption | null>(null);
  const [creating, setCreating] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [nextOpen, setNextOpen] = useState(false);
  const [nextCustom, setNextCustom] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [solutionOpen, setSolutionOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const active =
    data.cases.find((c) => c.id === activeCaseId) ??
    data.recentClosed.find((c) => c.id === activeCaseId) ??
    null;
  const caseType = active?.caseTypeId ? data.caseTypes.find((t) => t.id === active.caseTypeId) ?? null : null;

  const run = useCallback(
    async (key: string, action: () => Promise<CaseActionResult<object>>, success?: string) => {
      setBusy(key);
      try {
        const result = await action();
        if ("error" in result) {
          toast.error(result.error);
          return false;
        }
        if (success) toast.success(success);
        await onChanged();
        return true;
      } catch {
        toast.error("No se pudo guardar el cambio. Inténtalo de nuevo.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onChanged, toast],
  );

  const closeAssign = useCallback(() => setAssignOpen(false), []);
  const closeType = useCallback(() => setTypeOpen(false), []);
  const closeNext = useCallback(() => {
    setNextOpen(false);
    setNextCustom(false);
  }, []);
  const closeCloseMenu = useCallback(() => setCloseOpen(false), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const closeSolution = useCallback(() => setSolutionOpen(false), []);
  const closeReject = useCallback(() => setRejectOpen(false), []);

  const newCaseButton = data.canOpenCase && (
    <button onClick={() => setCreating(true)} className={chipButton}>
      <Plus className="h-3.5 w-3.5" />
      Nueva gestión
    </button>
  );

  const dialogs = (
    <>
      {creating && (
        <NewCaseDialog
          data={data}
          members={members}
          onCancel={() => setCreating(false)}
          onCreated={async (caseId, message) => {
            setCreating(false);
            toast.success(message);
            await onChanged();
            onSelectCase(caseId);
          }}
        />
      )}
      {historyOpen && active && (
        <CaseHistoryDialog caseId={active.id} data={data} members={members} onClose={() => setHistoryOpen(false)} />
      )}
      {closing && active && (
        <CloseCaseDialog
          caseView={active}
          caseType={caseType}
          initialStageId={closing.stageId}
          onCancel={() => setClosing(null)}
          onClosed={async (message, problem) => {
            setClosing(null);
            if (problem) toast.error(message);
            else toast.success(message);
            await onChanged();
          }}
        />
      )}
    </>
  );

  if (!active) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs">
        <BriefcaseBusiness className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Sin gestión abierta</span>
        {newCaseButton}
        {dialogs}
      </div>
    );
  }

  const perms = active.permissions;
  const isClosed = active.status !== "open" && active.status !== "scheduled";
  const types = data.caseTypes.filter((t) => !t.archived || t.id === active.caseTypeId);
  const categories = (caseType?.categories ?? []).filter((c) => !c.archived || c.id === active.categoryId);
  const steps = caseType ? stageSteps(caseType.stages, active.stageId) : [];
  const canClassify = perms.canEdit && busy === null;
  // Control de reclamos: un tipo protegido solo lo cambia el supervisor.
  const typeLock = typeChangeLock(caseType, active.canSupervise);
  const request = active.closeRequest;
  const banner =
    !isClosed && caseType && now !== null
      ? solutionBanner(
          {
            typeName: caseType.name,
            deadlineHours: caseType.solutionDeadlineHours,
            case: active,
          },
          new Date(now),
        )
      : null;

  // Personas a las que puedo asignar: administrador a cualquiera; supervisor
  // a las del equipo de la gestión (o del contacto).
  const scopeTeam = active.teamId ?? data.contact.teamId;
  const assignable = perms.canAssign
    ? members.filter(
        (m) =>
          m.userId !== active.assigneeId &&
          (data.me.isAdmin || (!!scopeTeam && m.teams.some((t) => t.teamId === scopeTeam))),
      )
    : [];
  const hasAssignMenu = perms.canAssign || perms.canTake || perms.canReturnToQueue || perms.canTransfer;
  const teamName = data.teams.find((t) => t.id === active.teamId)?.name ?? null;
  const isMine = !!active.assigneeId && active.assigneeId === data.me.userId;
  const assigneeText = isMine ? "Yo" : memberName(members, active.assigneeId);
  const needsTake = !active.assigneeId && perms.canTake && !isClosed;

  const nextChip = nextContactChip(active.nextActionAt, now === null ? new Date(0) : new Date(now));
  const nextLabel = now === null ? (active.nextActionAt ? "Próximo contacto" : "Programar") : nextChip.label;
  const nextTone = now === null ? "none" : nextChip.tone;
  const quickOptions = now === null ? [] : nextContactOptions(new Date(now));

  function caseLabel(c: CaseView): string {
    const type = c.caseTypeId ? data.caseTypes.find((t) => t.id === c.caseTypeId) : null;
    const stage = type?.stages.find((s) => s.id === c.stageId);
    const parts = [type?.name ?? "Sin clasificar"];
    if (c.status === "scheduled") parts.push(`programada ${formatDate(c.scheduledFor)}`);
    else if (stage) parts.push(stage.name);
    if (c.status === "open") parts.push(memberName(members, c.assigneeId));
    return parts.join(" · ");
  }

  function classify(t: CaseTypeOption) {
    void run(
      "type",
      async () => {
        const r = await classifyCase(active!.id, t.id);
        if ("ok" in r && r.rerouted) toast.success("La gestión se envió a otro equipo según su tipo.");
        return r;
      },
      "Tipo de gestión actualizado.",
    );
  }

  function quickNext(at: string, when: string) {
    void run(
      "next",
      async () => {
        const r = await postponeCase(active!.id, at);
        if ("ok" in r && r.assignedToMe) toast.success("Te asignamos la gestión: volverá a tu lista «Para hoy».");
        return r;
      },
      `Próximo contacto: ${when}.`,
    );
    closeNext();
  }

  const hasMore = !isClosed;

  return (
    <div className="shrink-0 space-y-1.5 border-b border-border bg-muted/30 px-4 py-2">
      {/* Fila 1: qué es y quién lo tiene + acciones */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <BriefcaseBusiness className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />

        {data.cases.length > 1 || isClosed ? (
          <select
            value={active.id}
            onChange={(e) => onSelectCase(e.target.value)}
            className={cn(selectClass, "max-w-56 font-medium")}
            aria-label="Gestión"
          >
            {data.cases.map((c, i) => (
              <option key={c.id} value={c.id}>
                {i + 1}. {caseLabel(c)}
              </option>
            ))}
            {isClosed && (
              <option value={active.id}>
                Cerrada: {caseLabel(active)}
              </option>
            )}
          </select>
        ) : null}

        {isClosed ? (
          <>
            <span className="text-xs text-muted-foreground">
              {active.status === "cancelled"
                ? "Cancelada"
                : `Cerrada como ${OUTCOME_LABELS[active.status as keyof typeof OUTCOME_LABELS]?.toLowerCase() ?? active.status}`}
              {active.closedAt ? ` el ${formatDate(active.closedAt)}` : ""}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={() => setHistoryOpen(true)} className={chipButton} title="Qué se hizo en esta gestión">
                <History className="h-3.5 w-3.5" />
                Historial
              </button>
              {newCaseButton}
            </div>
          </>
        ) : (
          <>
            {active.status === "scheduled" && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                Programada para {formatDate(active.scheduledFor)}
              </span>
            )}

            {/* Tipo */}
            {!caseType ? (
              perms.canEdit ? (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tipo de gestión">
                  <span className="text-xs font-medium">¿De qué trata?</span>
                  {types
                    .filter((t) => !t.archived)
                    .map((t) => (
                      <button
                        key={t.id}
                        onClick={() => classify(t)}
                        disabled={busy !== null}
                        title={`Clasificar como ${t.name}`}
                        className={chipButton}
                      >
                        <TypeDot color={t.color} />
                        {t.name}
                      </button>
                    ))}
                </div>
              ) : (
                <span className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
                  Sin clasificar
                </span>
              )
            ) : (
              <Popover
                open={typeOpen}
                onClose={closeType}
                trigger={
                  <button
                    onClick={() => setTypeOpen((v) => !v)}
                    disabled={!canClassify || !!typeLock}
                    title={typeLock ?? "Cambiar el tipo de gestión"}
                    aria-label={typeLock ? `Tipo de gestión: ${caseType.name}. ${typeLock}` : `Tipo de gestión: ${caseType.name}. Cambiar`}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
                    style={
                      caseType.color && HEX.test(caseType.color)
                        ? { borderColor: `${caseType.color}66`, backgroundColor: `${caseType.color}1a` }
                        : undefined
                    }
                  >
                    <TypeDot color={caseType.color} />
                    {caseType.name}
                    {typeLock ? (
                      <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
                    ) : (
                      canClassify && <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>
                }
                className="w-52"
              >
                <p className={menuHeading}>Cambiar tipo a…</p>
                {types.map((t) => (
                  <button
                    key={t.id}
                    className={menuItem}
                    onClick={() => {
                      setTypeOpen(false);
                      if (t.id !== active.caseTypeId) classify(t);
                    }}
                  >
                    <TypeDot color={t.color} />
                    <span className="truncate">
                      {t.name}
                      {t.archived ? " (archivado)" : ""}
                    </span>
                    {t.id === active.caseTypeId && <Check className="ml-auto h-3.5 w-3.5" />}
                  </button>
                ))}
              </Popover>
            )}

            {/* Responsable */}
            {needsTake ? (
              <button
                onClick={() => void run("assign", () => takeCase(active.id), "Tomaste la gestión.")}
                disabled={busy !== null}
                title="Quedarte con esta gestión"
                aria-label="Tomar la gestión"
                className={cn(primaryButtonClass, "px-2.5 py-1 text-xs")}
              >
                <Hand className="h-3.5 w-3.5" />
                Tomar
              </button>
            ) : (
              <Popover
                open={assignOpen}
                onClose={closeAssign}
                trigger={
                  <button
                    onClick={() => setAssignOpen((v) => !v)}
                    disabled={!hasAssignMenu || busy !== null}
                    className={chipButton}
                    title={teamName ? `Responsable. Equipo: ${teamName}` : "Responsable"}
                    aria-label={`Responsable: ${assigneeText}`}
                  >
                    <UserRound className="h-3.5 w-3.5" />
                    {assigneeText}
                  </button>
                }
              >
                <div className="space-y-1">
                  {perms.canTake && (
                    <button
                      className={menuItem}
                      onClick={() => {
                        setAssignOpen(false);
                        void run("assign", () => takeCase(active.id), "Tomaste la gestión.");
                      }}
                    >
                      <Hand className="h-3.5 w-3.5" />
                      Tomar
                    </button>
                  )}
                  {perms.canReturnToQueue && (
                    <button
                      className={menuItem}
                      onClick={() => {
                        setAssignOpen(false);
                        void run("assign", () => assignCase(active.id, null), "La gestión volvió a la cola.");
                      }}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Devolver a la cola
                    </button>
                  )}
                  {assignable.length > 0 && (
                    <div className="border-t border-border pt-1">
                      <p className="px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">Asignar a</p>
                      <div className="max-h-48 overflow-y-auto">
                        {assignable.map((m) => (
                          <button
                            key={m.userId}
                            className={menuItem}
                            onClick={() => {
                              setAssignOpen(false);
                              void run("assign", () => assignCase(active.id, m.userId), `Asignada a ${m.name}.`);
                            }}
                          >
                            <span className="truncate">{m.name}</span>
                            {m.availability === "away" && (
                              <span className="ml-auto text-[10px] text-muted-foreground">Ausente</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {perms.canTransfer && data.teams.length > 0 && (
                    <div className="border-t border-border pt-1">
                      <p className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                        <ArrowRightLeft className="h-3 w-3" />
                        Transferir a equipo
                      </p>
                      <select
                        value={active.teamId ?? ""}
                        onChange={(e) => {
                          setAssignOpen(false);
                          const teamId = e.target.value || null;
                          const name = data.teams.find((t) => t.id === teamId)?.name;
                          void run(
                            "assign",
                            () => transferCase(active.id, teamId),
                            name ? `Transferida al equipo ${name}.` : "La gestión quedó sin equipo.",
                          );
                        }}
                        className={cn(selectClass, "w-full")}
                        aria-label="Equipo"
                      >
                        <option value="">Sin equipo</option>
                        {data.teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </Popover>
            )}

            {/* Próximo contacto */}
            <Popover
              open={nextOpen}
              onClose={closeNext}
              trigger={
                <button
                  onClick={() => {
                    setNextCustom(false);
                    setNextOpen((v) => !v);
                  }}
                  disabled={!perms.canEdit || busy !== null}
                  className={cn(
                    chipButton,
                    nextTone === "overdue" &&
                      "border-red-300 bg-red-50 font-medium text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
                    nextTone === "none" && "text-muted-foreground",
                  )}
                  title={active.nextActionNote ?? "Cuándo volver a escribirle al cliente"}
                  aria-label={`Próximo contacto: ${nextLabel}`}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  {nextLabel}
                </button>
              }
              className="w-72"
            >
              {active.solutionStatus === "in_progress" ? (
                <div className="space-y-1 p-1">
                  <p className={menuHeading}>Compromiso con el cliente</p>
                  <p className="px-2 text-xs leading-snug text-muted-foreground">
                    Hay una solución en proceso y esta fecha es el compromiso. No se quita ni se mueve desde aquí: usa{" "}
                    <span className="font-medium text-foreground">Actualizar solución</span> para cambiarla (queda en el
                    historial y se avisa al supervisor).
                  </p>
                </div>
              ) : nextCustom ? (
                <NextActionForm
                  caseView={active}
                  saving={busy === "next"}
                  onSave={async (at, note) => {
                    const ok = await run("next", () => setNextAction(active.id, at, note), at ? "Próximo contacto guardado." : "Próximo contacto quitado.");
                    if (ok) closeNext();
                  }}
                />
              ) : (
                <div className="space-y-0.5">
                  <p className={menuHeading}>Próximo contacto</p>
                  {quickOptions.map((o) => (
                    <button key={o.key} className={menuItem} onClick={() => quickNext(o.at, o.when)}>
                      <span>{o.label}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{o.detail}</span>
                    </button>
                  ))}
                  <button className={menuItem} onClick={() => setNextCustom(true)}>
                    Elegir fecha y nota…
                  </button>
                  {active.nextActionAt && (
                    <div className="border-t border-border pt-0.5">
                      <button
                        className={cn(menuItem, "text-muted-foreground")}
                        onClick={() => {
                          closeNext();
                          void run("next", () => setNextAction(active.id, null, null), "Próximo contacto quitado.");
                        }}
                      >
                        Quitar
                      </button>
                    </div>
                  )}
                  <p className="border-t border-border px-2 pt-1.5 text-[11px] leading-snug text-muted-foreground">
                    El chat vuelve a <span className="font-medium text-foreground">Para hoy</span> a esa hora.
                  </p>
                </div>
              )}
            </Popover>

            <div className="ml-auto flex items-center gap-1.5">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Guardando" />}

              {perms.canClose && (
                <Popover
                  open={closeOpen}
                  onClose={closeCloseMenu}
                  align="right"
                  className={caseType?.protected && !active.canSupervise ? "w-64" : "w-52"}
                  trigger={
                    <button
                      onClick={() => setCloseOpen((v) => !v)}
                      disabled={busy !== null}
                      className={chipButton}
                      title="Cerrar la gestión"
                      aria-label="Cerrar gestión"
                    >
                      Cerrar
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  }
                >
                  <p className={menuHeading}>Cerrar como…</p>
                  {closeMenuItems(closeOptions(caseType?.stages), {
                    isProtected: !!caseType?.protected,
                    canSupervise: active.canSupervise,
                    hasPendingRequest: !!request,
                  }).map(({ option: o, label, needsApproval, disabledReason }) => (
                    <button
                      key={o.stageId ?? o.kind}
                      className={menuItem}
                      disabled={!!disabledReason}
                      title={disabledReason ?? (needsApproval ? "Un supervisor tiene que aprobar este cierre" : undefined)}
                      onClick={() => {
                        setCloseOpen(false);
                        setClosing(o);
                      }}
                    >
                      {o.tone === "positive" ? (
                        <Check className="h-3.5 w-3.5 text-green-600" aria-hidden />
                      ) : (
                        <X className="h-3.5 w-3.5 text-red-600" aria-hidden />
                      )}
                      <span className={o.tone === "positive" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                        {label}
                      </span>
                    </button>
                  ))}
                </Popover>
              )}

              {hasMore && (
                <Popover
                  open={moreOpen}
                  onClose={closeMore}
                  align="right"
                  className="w-48"
                  trigger={
                    <button
                      onClick={() => setMoreOpen((v) => !v)}
                      className={cn(chipButton, "px-1.5")}
                      title="Más acciones"
                      aria-label="Más acciones"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  }
                >
                  {data.canOpenCase && (
                    <button
                      className={menuItem}
                      onClick={() => {
                        setMoreOpen(false);
                        setCreating(true);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Nueva gestión
                    </button>
                  )}
                  {perms.canEdit && caseType && (
                    <button
                      className={menuItem}
                      disabled={!!typeLock}
                      title={typeLock ?? undefined}
                      onClick={() => {
                        setMoreOpen(false);
                        setTypeOpen(true);
                      }}
                    >
                      {typeLock ? <Lock className="h-3.5 w-3.5" /> : <Repeat className="h-3.5 w-3.5" />}
                      Cambiar tipo
                    </button>
                  )}
                  <button
                    className={menuItem}
                    onClick={() => {
                      setMoreOpen(false);
                      setHistoryOpen(true);
                    }}
                  >
                    <History className="h-3.5 w-3.5" />
                    Historial
                  </button>
                </Popover>
              )}
            </div>
          </>
        )}
      </div>

      {/* Fila 2: en qué va */}
      {!isClosed && caseType && (steps.length > 0 || categories.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {steps.length > 0 && (
            <StageStepper
              steps={steps}
              disabled={!perms.canEdit || busy !== null}
              onPick={(id) => void run("stage", () => changeCaseStage(active.id, id), "Etapa actualizada.")}
            />
          )}
          {categories.length > 0 && (
            <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              Categoría:
              <select
                value={active.categoryId ?? ""}
                disabled={!perms.canEdit || busy !== null}
                onChange={(e) => void run("category", () => setCaseCategory(active.id, e.target.value || null), "Categoría actualizada.")}
                className={cn(selectClass, "max-w-60 font-normal text-foreground")}
                aria-label="Categoría"
              >
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isHighPriority ? " (prioridad)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {/* Control de reclamos: plazo de la solución */}
      {banner && (
        <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5 text-[11px]", BANNER_TONE[banner.tone])}>
          {banner.tone === "ok" ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 basis-48 break-words font-medium">{banner.text}</span>
          {perms.canEdit && (
            <Popover
              open={solutionOpen}
              onClose={closeSolution}
              align="right"
              className="w-80"
              trigger={
                <button
                  onClick={() => setSolutionOpen((v) => !v)}
                  disabled={busy !== null}
                  className={cn(chipButton, "font-medium text-foreground")}
                >
                  {banner.actionLabel}
                </button>
              }
            >
              <SolutionForm
                initialNote={active.solutionNote}
                initialCommitment={active.solutionStatus === "in_progress" ? active.nextActionAt : null}
                now={now}
                saving={busy === "solution"}
                onSave={async (note, commitmentAt) => {
                  const ok = await run(
                    "solution",
                    () => registerSolutionInProgress(active.id, note, commitmentAt),
                    "Solución registrada.",
                  );
                  if (ok) setSolutionOpen(false);
                }}
              />
            </Popover>
          )}
        </div>
      )}

      {/* Control de reclamos: pedido de cierre sin solución */}
      {request && !isClosed && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <Hourglass className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 basis-48 break-words font-medium">
            {closeRequestLine({
              stageName: caseType?.stages.find((st) => st.id === request.stageId)?.name ?? null,
              requesterName: request.requestedBy === data.me.userId ? "ti" : memberName(members, request.requestedBy),
              reasonName: caseType?.outcomeReasons.find((r) => r.id === request.reasonId)?.name ?? null,
              note: request.note,
            })}
          </span>
          {active.canSupervise && (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => void run("approve", () => approveCloseRequest(active.id), "Cierre aprobado: la gestión quedó cerrada.")}
                disabled={busy !== null}
                className={cn(primaryButtonClass, "px-2.5 py-1 text-xs")}
              >
                {busy === "approve" && <Loader2 className="h-3 w-3 animate-spin" />}
                Aprobar
              </button>
              <Popover
                open={rejectOpen}
                onClose={closeReject}
                align="right"
                className="w-72"
                trigger={
                  <button onClick={() => setRejectOpen((v) => !v)} disabled={busy !== null} className={cn(chipButton, "text-foreground")}>
                    Rechazar
                  </button>
                }
              >
                <div className="space-y-2 p-1 text-foreground">
                  <label htmlFor="reject-comment" className="text-xs font-medium">
                    ¿Qué debe hacer antes de cerrarla? (opcional)
                  </label>
                  <textarea
                    id="reject-comment"
                    value={rejectComment}
                    onChange={(e) => setRejectComment(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className={cn(inputClass, "resize-none py-1 text-xs")}
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={async () => {
                        const ok = await run("reject", () => rejectCloseRequest(active.id, rejectComment.trim() || null), "Pedido rechazado: la gestión sigue abierta.");
                        if (ok) {
                          setRejectOpen(false);
                          setRejectComment("");
                        }
                      }}
                      disabled={busy !== null}
                      className={cn(primaryButtonClass, "py-1 text-xs")}
                    >
                      {busy === "reject" && <Loader2 className="h-3 w-3 animate-spin" />}
                      Rechazar pedido
                    </button>
                  </div>
                </div>
              </Popover>
            </div>
          )}
        </div>
      )}

      {active.nextActionNote && active.nextActionAt && !isClosed && active.solutionStatus !== "in_progress" && (
        <p className="truncate text-[11px] text-muted-foreground">Nota: {active.nextActionNote}</p>
      )}
      {dialogs}
    </div>
  );
}

/** Etapas abiertas del tipo como chips conectados; la actual se muestra en el centro. */
function StageStepper({
  steps,
  disabled,
  onPick,
}: {
  steps: ReturnType<typeof stageSteps>;
  disabled: boolean;
  onPick: (stageId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const currentId = steps.find((s) => s.state === "current")?.id ?? null;

  useEffect(() => {
    const box = scroller.current;
    const el = currentId ? box?.querySelector<HTMLElement>(`[data-step="${currentId}"]`) : null;
    if (!box || !el) return;
    box.scrollLeft = Math.max(0, el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2);
  }, [currentId, steps.length]);

  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5">
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Etapa:</span>
      <div
        ref={scroller}
        role="group"
        aria-label="Etapa"
        className="relative flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {steps.map((step, i) => (
          <div key={step.id} className="flex shrink-0 items-center">
            {i > 0 && (
              <span
                aria-hidden
                className={cn("h-px w-2.5", step.state === "next" ? "bg-border" : "bg-primary/50")}
              />
            )}
            <button
              data-step={step.id}
              onClick={() => step.state !== "current" && onPick(step.id)}
              disabled={disabled}
              aria-current={step.state === "current" ? "step" : undefined}
              title={step.state === "current" ? `Etapa actual: ${step.name}` : `Mover a «${step.name}»`}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] disabled:cursor-not-allowed",
                step.state === "current" &&
                  "border-primary bg-primary font-medium text-primary-foreground disabled:opacity-100",
                step.state === "past" &&
                  "border-transparent bg-muted text-muted-foreground hover:bg-accent disabled:opacity-60",
                step.state === "next" && "border-border bg-background hover:bg-accent disabled:opacity-60",
              )}
            >
              {step.state === "past" && <Check className="h-3 w-3" aria-hidden />}
              {step.name}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NextActionForm({
  caseView,
  saving,
  onSave,
}: {
  caseView: CaseView;
  saving: boolean;
  onSave: (at: string | null, note: string | null) => void;
}) {
  const current = caseView.nextActionAt;
  const [date, setDate] = useState(current ? limaDateOf(new Date(current)) : "");
  const [time, setTime] = useState(current ? formatTime(current) : "");
  const [note, setNote] = useState(caseView.nextActionNote ?? "");

  // No se puede programar en el pasado: el mínimo es hoy (hora de Lima). El servidor también lo revisa.
  const todayLima = limaDateOf(new Date());

  function submit() {
    if (!date) return;
    // Hora de Lima (UTC-5, sin horario de verano); sin hora, el servidor usa las 09:00.
    const at = time ? `${date}T${time}:00-05:00` : date;
    onSave(at, note.trim() || null);
  }

  return (
    <div className="space-y-2 p-1">
      <p className="text-xs font-medium">Elegir fecha y nota</p>
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          min={todayLima}
          onChange={(e) => setDate(e.target.value)}
          className={cn(inputClass, "py-1 text-xs")}
          aria-label="Fecha"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className={cn(inputClass, "w-28 py-1 text-xs")}
          aria-label="Hora"
        />
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Nota (opcional)"
        className={cn(inputClass, "resize-none py-1 text-xs")}
      />
      <div className="flex justify-end gap-2">
        {current && (
          <button onClick={() => onSave(null, null)} disabled={saving} className={cn(secondaryButtonClass, "py-1 text-xs")}>
            Quitar
          </button>
        )}
        <button onClick={submit} disabled={saving || !date} className={cn(primaryButtonClass, "py-1 text-xs")}>
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Guardar
        </button>
      </div>
    </div>
  );
}
