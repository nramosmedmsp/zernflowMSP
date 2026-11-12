"use client";

// «Guía de la gestión» de la tarjeta del chat: la barra de pasos (una línea,
// es el control para moverse), «Ahora», lo que falta «Para avanzar», UN botón
// principal con a dónde lleva, y el aviso «Deshacer» tras mover de paso. La
// configuración sale del tipo (Configuración → Gestiones → Etapas). Con el
// orden estricto del tipo un asesor ve con candado los pasos a los que no puede
// ir; el supervisor y el administrador no tienen candados y su salto queda en
// el historial. El servidor vuelve a validar todo (lib/actions/cases.ts).

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  CheckSquare,
  Clock,
  Flag,
  Loader2,
  Lock,
  Square,
  Undo2,
  X,
} from "lucide-react";
import {
  addCaseNote,
  changeCaseStage,
  postponeCase,
  registerSolutionInProgress,
  setCaseCategory,
  undoCaseStageChange,
  type CaseActionResult,
  type CaseTypeOption,
  type CaseView,
  type ContactCasesView,
} from "@/lib/actions/cases";
import { UNDO_WINDOW_MS, undoneMessage } from "@/lib/cases/undo";
import { cn } from "@/lib/utils";
import { useViewAs } from "@/components/view-as/view-as-context";
import { caseGuide, closeMenuItems, closeOptions, nextContactOptions, solutionBanner, type SolutionTone } from "./case-card-model";
import { CloseCasePanel } from "./close-case-panel";
import { SolutionForm, clearSolutionDraft } from "./solution-form";
import { StepBar } from "./step-bar";
import {
  STRICT_LOCK_MESSAGE,
  blockedMoveText,
  exitViews,
  moveConfirmation,
  requirementState,
  stepBarSteps,
  stepHeader,
  stepHint,
  type BarStep,
  type ExitView,
} from "./step-bar-model";
import { inputClass, primaryButtonClass, selectClass } from "./ui";

const BANNER_TONE: Record<SolutionTone, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
  red: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
  ok: "border-green-200 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300",
};

type Panel = null | { kind: "close"; stageId: string | null } | { kind: "solution" };

type Confirm =
  | null
  | { kind: "move"; stepId: string }
  | { kind: "blocked"; text: string }
  | { kind: "locked"; stepName: string };

interface UndoNotice {
  caseId: string;
  fromStageId: string | null;
  toStageId: string;
  fromName: string;
  toName: string;
  irreversible: string | null;
  expiresAt: number;
}

type RunFn = (key: string, action: () => Promise<CaseActionResult<object>>, success?: string) => Promise<boolean>;

function FormBox({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="animate-pop-in space-y-2.5 rounded-lg border border-primary/30 bg-background p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">{title}</p>
        <button onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">
          Cancelar
        </button>
      </div>
      {children}
    </div>
  );
}

/** Botón de salida: la acción y, en letra pequeña, a dónde lleva. */
function ExitButton({
  view,
  disabled,
  locked,
  hint,
  onClick,
}: {
  view: ExitView;
  disabled: boolean;
  /** Se ve con candado (falta algo para poder usarlo). */
  locked?: boolean;
  /** Reemplaza la letra pequeña (p. ej. «primero elige la categoría»). */
  hint?: string | null;
  onClick: () => void;
}) {
  const sub = hint ?? view.sub;
  if (view.kind === "danger") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-950/30"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
        {view.title}
      </button>
    );
  }
  if (view.kind === "help") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex flex-col items-start rounded-lg border border-dashed border-border bg-transparent px-2.5 py-1.5 text-left hover:bg-accent disabled:opacity-60"
      >
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {view.title}
        </span>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </button>
    );
  }
  const primary = view.kind === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex flex-col items-start rounded-lg px-3 py-1.5 text-left transition-opacity disabled:cursor-not-allowed",
        primary
          ? "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          : "border border-border bg-background hover:bg-accent disabled:opacity-60",
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
        {locked && <Lock className="h-3 w-3" aria-hidden />}
        {view.title}
        {!locked && <ArrowRight className="h-3.5 w-3.5" aria-hidden />}
      </span>
      {sub && <span className={cn("text-[11px]", primary ? "text-primary-foreground/80" : "text-muted-foreground")}>{sub}</span>}
    </button>
  );
}

export function CaseGuidePanel({
  data,
  active,
  caseType,
  now,
  busy,
  run,
  onChanged,
  notify,
}: {
  data: ContactCasesView;
  active: CaseView;
  caseType: CaseTypeOption;
  now: number | null;
  /** Clave de lo que se está guardando (null = nada). */
  busy: string | null;
  run: RunFn;
  onChanged: () => Promise<void> | void;
  notify: (message: string, problem?: boolean) => void;
}) {
  const viewAs = useViewAs();
  const [panel, setPanel] = useState<Panel>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [undo, setUndo] = useState<UndoNotice | null>(null);
  const [noteText, setNoteText] = useState("");
  const [notesDone, setNotesDone] = useState<string[]>([]);
  const [attention, setAttention] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const perms = active.permissions;
  const guide = caseGuide(caseType, active.stageId);
  const canSupervise = active.canSupervise;
  const canEdit = perms.canEdit && busy === null;
  const categories = caseType.categories.filter((c) => !c.archived || c.id === active.categoryId);
  const contactTypeName = (id: string | null) => data.contactTypes.find((t) => t.id === id)?.name ?? null;
  const request = active.closeRequest;
  const stageNames = new Map(caseType.stages.map((s) => [s.id, s.name] as const));

  const steps = stepBarSteps(caseType.stages, active.stageId, { strictOrder: caseType.strictOrder, canSupervise });
  const noteKey = `${active.id}:${active.stageId ?? ""}`;
  const req = requirementState({
    requires: guide.requires,
    hasCategory: !!active.categoryId,
    hasCategories: caseType.categories.some((c) => !c.archived),
    noteDone: notesDone.includes(noteKey),
    solutionDone: active.solutionStatus === "in_progress",
    canSupervise,
  });

  const banner =
    now !== null
      ? solutionBanner(
          { typeName: caseType.name, deadlineHours: caseType.solutionDeadlineHours, case: active },
          new Date(now),
        )
      : null;

  const closeItems = closeMenuItems(closeOptions(caseType.stages), {
    isProtected: caseType.protected,
    canSupervise,
    hasPendingRequest: !!request,
  });
  const closingBlocked = (stageId: string | null) =>
    closeItems.find((i) => i.option.stageId === stageId)?.disabledReason ?? null;
  const defaultCloseStage = (closeItems.find((i) => !i.disabledReason) ?? closeItems[0])?.option.stageId ?? null;

  // «Ver como»: la vista es de solo lectura, los controles no actúan.
  function blockedInView(): boolean {
    if (!viewAs.active) return false;
    notify(viewAs.blockedNotice ?? "Estás viendo la cuenta de otra persona: no se puede cambiar nada.", true);
    return true;
  }

  // Cualquier otra acción cierra el aviso «Deshacer»: ya no es «el último cambio».
  const runOther: RunFn = (key, action, success) => {
    setUndo(null);
    return run(key, action, success);
  };

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), Math.max(0, undo.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [undo]);

  async function moveTo(stageId: string, opts: { jump?: boolean } = {}) {
    if (blockedInView()) return false;
    setPanel(null);
    setConfirm(null);
    setUndo(null);
    const fromStageId = active.stageId;
    const made: { notice: UndoNotice | null } = { notice: null };
    const ok = await run(
      "stage",
      async () => {
        const result = await changeCaseStage(active.id, stageId, opts.jump ? { jump: true } : undefined);
        if ("ok" in result && result.move) {
          made.notice = {
            caseId: active.id,
            fromStageId,
            toStageId: result.move.toStageId,
            fromName: (fromStageId && stageNames.get(fromStageId)) || "el paso anterior",
            toName: stageNames.get(result.move.toStageId) ?? "el nuevo paso",
            irreversible: result.move.irreversible,
            expiresAt: Date.now() + UNDO_WINDOW_MS,
          };
        }
        return result;
      },
      undefined,
    );
    if (ok && made.notice) setUndo(made.notice);
    return ok;
  }

  async function undoMove(n: UndoNotice) {
    if (blockedInView()) return;
    setUndo(null);
    await run("undo", () => undoCaseStageChange(n.caseId, n.toStageId), undoneMessage(n.fromName, n.irreversible));
  }

  function remindTomorrow() {
    if (now === null || blockedInView()) return;
    const tomorrow = nextContactOptions(new Date(now)).find((o) => o.key === "tomorrow");
    if (!tomorrow) return;
    void runOther("next", () => postponeCase(active.id, tomorrow.at), `Próximo contacto: ${tomorrow.when}.`);
  }

  function openClose(stageId: string | null) {
    if (blockedInView()) return;
    setConfirm(null);
    setPanel({ kind: "close", stageId });
  }

  function pickExit(exit: ExitView["exit"]) {
    if (exit.type === "remind") return remindTomorrow();
    if (exit.type === "close") return openClose(exit.stageId);
    if (exit.stageId) void moveTo(exit.stageId);
  }

  function pickStep(step: BarStep) {
    if (blockedInView() || !perms.canEdit) return;
    if (step.state === "current") {
      setConfirm(null);
      return;
    }
    if (step.locked) {
      setConfirm({ kind: "locked", stepName: step.name });
      return;
    }
    // Si para salir de este paso falta algo, se dice antes de pedir la confirmación.
    if (step.delta > 0 && req?.blocking) {
      setConfirm({ kind: "blocked", text: blockedMoveText(step.name, req) });
      setAttention(true);
      setTimeout(() => setAttention(false), 1800);
      listRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      listRef.current?.focus({ preventScroll: true });
      return;
    }
    setConfirm({ kind: "move", stepId: step.id });
  }

  const confirmStep = confirm?.kind === "move" ? steps.find((s) => s.id === confirm.stepId) ?? null : null;
  const strictLocked = steps.some((s) => s.locked);
  const views = exitViews(
    guide.exits.filter((e) => e.type !== "close" || perms.canClose),
    steps,
    stageNames,
  );
  const solutionFirst = req?.kind === "solution" && !req.done;
  const gate = !!req?.blocking;
  const showBanner = !!banner && !solutionFirst;
  const showSolutionButton = !!banner && perms.canEdit;

  const mainExits = views.filter((v) => v.kind === "primary" || v.kind === "secondary");
  const helpExits = views.filter((v) => v.kind === "help");
  const dangerExits = views.filter((v) => v.kind === "danger");

  const exitDisabled = (v: ExitView) =>
    !canEdit || (v.exit.type === "close" && !!closingBlocked(v.exit.stageId)) || (gate && v.exit.type === "stage");

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <StepBar
        steps={steps}
        header={stepHeader(steps)}
        hint={stepHint({ canEdit: perms.canEdit, strictLocked, canSupervise, strictOrder: caseType.strictOrder })}
        hintTone={strictLocked && perms.canEdit ? "lock" : "muted"}
        pickedId={confirmStep?.id ?? null}
        disabled={busy !== null}
        onPick={pickStep}
        trailing={
          perms.canClose ? (
            <button
              type="button"
              onClick={() => (panel?.kind === "close" ? setPanel(null) : openClose(defaultCloseStage))}
              disabled={busy !== null}
              aria-expanded={panel?.kind === "close"}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-60",
                panel?.kind === "close" && "border-primary text-primary",
              )}
            >
              <Flag className="h-3.5 w-3.5" aria-hidden />
              Cerrar
            </button>
          ) : null
        }
      />

      <div className="space-y-2.5 px-3 pb-3 pt-2">
        {/* Confirmación en el sitio (o por qué no se puede ir ahí) */}
        {confirmStep && (
          <div
            role="alertdialog"
            aria-label="Confirmar el cambio de paso"
            className="animate-pop-in flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2"
          >
            <p className="min-w-0 flex-1 basis-56 text-sm">
              <span className="font-semibold">{moveConfirmation(confirmStep).question}</span>{" "}
              <span className="text-muted-foreground">{moveConfirmation(confirmStep).detail}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                autoFocus
                onClick={() => void moveTo(confirmStep.id, { jump: confirmStep.isJump })}
                disabled={busy !== null}
                className={cn(primaryButtonClass, "py-1 text-xs")}
              >
                {busy === "stage" && <Loader2 className="h-3 w-3 animate-spin" />}
                Mover
              </button>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        {confirm?.kind === "locked" && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs">
            <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{confirm.stepName}:</span> {STRICT_LOCK_MESSAGE}
            </span>
            <button type="button" onClick={() => setConfirm(null)} aria-label="Cerrar aviso" className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </p>
        )}
        {confirm?.kind === "blocked" && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{confirm.text}</span>
            <button type="button" onClick={() => setConfirm(null)} aria-label="Cerrar aviso" className="opacity-70 hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </p>
        )}

        <p className="text-sm leading-snug">
          <span className="mr-1.5 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 align-[1px] text-[11px] font-bold uppercase tracking-wide text-primary">
            Ahora
          </span>
          {guide.now}
        </p>

        {/* Plazo de la solución (control de reclamos) */}
        {showBanner && banner && (
          <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5 text-[11px]", BANNER_TONE[banner.tone])}>
            {banner.tone === "ok" ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 basis-48 break-words font-medium">{banner.text}</span>
            {showSolutionButton && !panel && (
              <button
                onClick={() => !blockedInView() && setPanel({ kind: "solution" })}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60"
              >
                {banner.actionLabel}
              </button>
            )}
          </div>
        )}

        {/* Para avanzar */}
        {req && panel?.kind !== "close" && (
          <div
            ref={listRef}
            tabIndex={-1}
            className={cn(
              "rounded-lg border border-border bg-background/60 p-3 outline-none transition-shadow",
              attention && "ring-2 ring-amber-400",
            )}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Para avanzar:</p>
            <div className="mt-2 space-y-2">
              {req.kind === "category" && (
                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-sm">
                    {req.done ? (
                      <CheckSquare className="h-4 w-4 text-green-600" aria-hidden />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" aria-hidden />
                    )}
                    <span className={cn(req.done && "font-medium")}>
                      {req.done
                        ? `Categoría: ${categories.find((c) => c.id === active.categoryId)?.name ?? ""}`
                        : req.label}
                    </span>
                  </p>
                  {perms.canEdit && (
                    <div className="flex flex-wrap gap-1.5 pl-6" role="radiogroup" aria-label="Categoría">
                      {categories.map((c) => {
                        const selected = active.categoryId === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={!canEdit}
                            onClick={() => {
                              if (selected || blockedInView()) return;
                              void runOther("category", () => setCaseCategory(active.id, c.id), undefined);
                            }}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs disabled:opacity-60",
                              selected
                                ? "border-primary bg-primary/10 font-medium text-primary"
                                : "border-border bg-background hover:bg-accent",
                            )}
                          >
                            {c.name}
                            {c.isHighPriority ? " (prioridad)" : ""}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {req.kind === "note" && (
                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-sm">
                    {req.done ? (
                      <CheckSquare className="h-4 w-4 text-green-600" aria-hidden />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" aria-hidden />
                    )}
                    <span className={cn(req.done && "font-medium")}>{req.done ? "Nota guardada" : req.label}</span>
                  </p>
                  {!req.done && perms.canEdit && (
                    <div className="space-y-1.5 pl-6">
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        rows={2}
                        maxLength={2000}
                        placeholder="Qué hiciste o acordaste en esta etapa"
                        className={cn(inputClass, "resize-none py-1 text-xs")}
                        aria-label="Nota"
                      />
                      <button
                        type="button"
                        disabled={!noteText.trim() || !canEdit}
                        onClick={async () => {
                          if (blockedInView()) return;
                          const ok = await runOther("note", () => addCaseNote(active.id, noteText.trim()), undefined);
                          if (ok) {
                            setNotesDone((list) => [...list, noteKey]);
                            setNoteText("");
                          }
                        }}
                        className={cn(primaryButtonClass, "py-1 text-xs")}
                      >
                        {busy === "note" && <Loader2 className="h-3 w-3 animate-spin" />}
                        Guardar nota
                      </button>
                    </div>
                  )}
                </div>
              )}

              {req.kind === "solution" && (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  {req.done ? (
                    <CheckSquare className="h-4 w-4 text-green-600" aria-hidden />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" aria-hidden />
                  )}
                  <span className={cn(req.done && "font-medium")}>{req.done ? "Solución registrada" : req.label}</span>
                  {banner && !req.done && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        BANNER_TONE[banner.tone],
                      )}
                    >
                      <Clock className="h-3 w-3" aria-hidden />
                      {banner.short}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Botones del siguiente paso */}
        {!panel && perms.canEdit && (views.length > 0 || solutionFirst) && (
          <div className="space-y-2">
            {solutionFirst && (
              <button
                type="button"
                onClick={() => !blockedInView() && setPanel({ kind: "solution" })}
                disabled={busy !== null}
                className="inline-flex flex-col items-start rounded-lg bg-primary px-3 py-1.5 text-left text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                  Registrar solución
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="text-[11px] text-primary-foreground/80">luego podrás pasar de paso</span>
              </button>
            )}

            <div className="flex flex-wrap items-stretch gap-2" role="group" aria-label="Siguiente paso">
              {solutionFirst ? (
                mainExits.length > 0 && (
                  <>
                    <span className="self-center text-xs text-muted-foreground">Después podrás pasar a:</span>
                    {mainExits.map((v, i) => (
                      <button
                        key={`${v.exit.stageId ?? v.exit.type}-${i}`}
                        type="button"
                        onClick={() => pickExit(v.exit)}
                        disabled={canSupervise ? exitDisabled(v) : true}
                        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-80"
                      >
                        {!canSupervise && <Lock className="h-3 w-3" aria-hidden />}
                        {v.exit.customLabel ? v.exit.label : (v.exit.stageId && stageNames.get(v.exit.stageId)) || v.exit.label}
                      </button>
                    ))}
                  </>
                )
              ) : (
                mainExits.map((v, i) => (
                  <ExitButton
                    key={`${v.exit.stageId ?? v.exit.type}-${i}`}
                    view={v}
                    disabled={exitDisabled(v)}
                    hint={gate && v.exit.type === "stage" && v.kind === "primary" && req ? req.hint : null}
                    onClick={() => pickExit(v.exit)}
                  />
                ))
              )}
              {helpExits.map((v, i) => (
                <ExitButton key={`help-${i}`} view={v} disabled={!canEdit} onClick={() => pickExit(v.exit)} />
              ))}
              {dangerExits.length > 0 && (
                <div className="ml-auto flex items-center">
                  {dangerExits.map((v, i) => (
                    <ExitButton key={`danger-${i}`} view={v} disabled={exitDisabled(v)} onClick={() => pickExit(v.exit)} />
                  ))}
                </div>
              )}
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin self-center text-muted-foreground" aria-label="Guardando" />}
            </div>
          </div>
        )}
        {!panel && !perms.canEdit && (
          <p className="text-[11px] text-muted-foreground">Solo quien tiene la gestión puede avanzarla.</p>
        )}

        {panel?.kind === "solution" && (
          <FormBox title={active.solutionStatus === "in_progress" ? "Actualizar la solución" : "Registrar solución"} onCancel={() => setPanel(null)}>
            <SolutionForm
              caseId={active.id}
              initialNote={active.solutionNote}
              initialCommitment={active.solutionStatus === "in_progress" ? active.nextActionAt : null}
              now={now}
              saving={busy === "solution"}
              onSave={async (note, commitmentAt) => {
                const ok = await runOther(
                  "solution",
                  () => registerSolutionInProgress(active.id, note, commitmentAt),
                  "Solución registrada.",
                );
                if (ok) {
                  clearSolutionDraft(active.id);
                  setPanel(null);
                }
              }}
            />
          </FormBox>
        )}

        {panel?.kind === "close" && (
          <CloseCasePanel
            caseView={active}
            caseType={caseType}
            stageId={panel.stageId}
            contactTypeName={contactTypeName}
            onCancel={() => setPanel(null)}
            onClosed={async (message, problem) => {
              setPanel(null);
              notify(message, problem);
              await onChanged();
            }}
          />
        )}

        {/* Categoría (cambiarla cuando este paso no la pide) */}
        {categories.length > 0 && perms.canEdit && !panel && req?.kind !== "category" && (
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            Categoría:
            <select
              value={active.categoryId ?? ""}
              disabled={!canEdit}
              onChange={(e) => {
                if (blockedInView()) return;
                void runOther("category", () => setCaseCategory(active.id, e.target.value || null), "Categoría actualizada.");
              }}
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

      {/* Aviso «Deshacer» tras mover de paso */}
      {undo && undo.caseId === active.id && undo.toStageId === active.stageId && (
        <div role="status" className="animate-pop-in relative overflow-hidden rounded-b-xl border-t border-green-200 bg-green-50 dark:border-green-900/60 dark:bg-green-950/30">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <Check className="h-4 w-4 shrink-0 text-green-700 dark:text-green-300" aria-hidden />
            <span className="min-w-0 flex-1 basis-40 text-sm font-medium text-green-900 dark:text-green-200">Pasó a {undo.toName}</span>
            <button
              type="button"
              onClick={() => void undoMove(undo)}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-lg border border-green-300 bg-background px-3 py-1 text-xs font-semibold text-green-900 hover:bg-green-100 disabled:opacity-60 dark:border-green-800 dark:text-green-200 dark:hover:bg-green-950"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
              Deshacer
            </button>
            {undo.irreversible && (
              <p className="basis-full text-[11px] leading-snug text-amber-900 dark:text-amber-200">{undo.irreversible}</p>
            )}
          </div>
          <span
            aria-hidden
            key={undo.expiresAt}
            className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-green-500"
            style={{ animation: `undo-shrink ${UNDO_WINDOW_MS}ms linear forwards` }}
          />
        </div>
      )}
    </div>
  );
}
