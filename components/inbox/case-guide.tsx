"use client";

// «Guía de la gestión» de la tarjeta del chat: en qué paso va la gestión, qué
// hacer ahora y los botones del siguiente paso, según la configuración del tipo
// (Configuración → Gestiones → Etapas). Con el orden estricto del tipo un asesor
// solo ve esos botones; si no, además puede elegir cualquier etapa en «Cambiar
// etapa». El supervisor y el administrador tienen «Saltar a…». El servidor
// vuelve a validar todo (lib/actions/cases.ts).

import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, CornerUpLeft, Flag, Loader2, X } from "lucide-react";
import {
  addCaseNote,
  changeCaseStage,
  postponeCase,
  registerSolutionInProgress,
  setCaseCategory,
  type CaseActionResult,
  type CaseTypeOption,
  type CaseView,
  type ContactCasesView,
} from "@/lib/actions/cases";
import type { GuideExit } from "@/lib/cases/guide";
import { cn } from "@/lib/utils";
import {
  canPickAnyStage,
  caseGuide,
  closeMenuItems,
  closeOptions,
  nextContactOptions,
  solutionBanner,
  type SolutionTone,
} from "./case-card-model";
import { CloseCasePanel } from "./close-case-panel";
import { SolutionForm, clearSolutionDraft } from "./solution-form";
import { Popover, inputClass, primaryButtonClass, secondaryButtonClass, selectClass } from "./ui";

const menuItem =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50";
const menuHeading = "px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase text-muted-foreground";

const BANNER_TONE: Record<SolutionTone, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
  red: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
  ok: "border-green-200 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300",
};

type Panel =
  | null
  | { kind: "close"; stageId: string | null }
  | { kind: "category"; exit: GuideExit }
  | { kind: "note"; exit: GuideExit }
  | { kind: "solution" };

type RunFn = (key: string, action: () => Promise<CaseActionResult<object>>, success?: string) => Promise<boolean>;

function FormBox({ title, children, onCancel }: { title: string; children: ReactNode; onCancel: () => void }) {
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

function ExitButton({ exit, disabled, onClick }: { exit: GuideExit; disabled: boolean; onClick: () => void }) {
  if (exit.tone === "primary") {
    return (
      <button onClick={onClick} disabled={disabled} className={cn(primaryButtonClass, "py-1.5 text-xs")}>
        {exit.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    );
  }
  if (exit.tone === "danger") {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
      >
        <X className="h-3.5 w-3.5" />
        {exit.label}
      </button>
    );
  }
  return (
    <button onClick={onClick} disabled={disabled} className={cn(secondaryButtonClass, "py-1.5 text-xs")}>
      {exit.label}
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
  const [panel, setPanel] = useState<Panel>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [pickedCategory, setPickedCategory] = useState("");
  const [noteText, setNoteText] = useState("");

  const perms = active.permissions;
  const guide = caseGuide(caseType, active.stageId);
  const canSupervise = active.canSupervise;
  const pickAny = canPickAnyStage(caseType.strictOrder, canSupervise);
  const canEdit = perms.canEdit && busy === null;
  const categories = caseType.categories.filter((c) => !c.archived || c.id === active.categoryId);
  const contactTypeName = (id: string | null) => data.contactTypes.find((t) => t.id === id)?.name ?? null;
  const needsCategoryFirst = guide.requires === "category" && !active.categoryId && categories.length > 0 && !canSupervise;
  const request = active.closeRequest;

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

  function moveTo(stageId: string, opts: { jump?: boolean } = {}) {
    setPanel(null);
    setMoveOpen(false);
    return run(
      "stage",
      () => changeCaseStage(active.id, stageId, opts.jump ? { jump: true } : undefined),
      opts.jump ? "Saltaste de etapa; quedó en el historial." : "Etapa actualizada.",
    );
  }

  function remindTomorrow() {
    if (now === null) return;
    const tomorrow = nextContactOptions(new Date(now)).find((o) => o.key === "tomorrow");
    if (!tomorrow) return;
    void run("next", () => postponeCase(active.id, tomorrow.at), `Próximo contacto: ${tomorrow.when}.`);
  }

  function pickExit(exit: GuideExit) {
    if (exit.type === "remind") return remindTomorrow();
    if (exit.type === "close") {
      setPanel({ kind: "close", stageId: exit.stageId });
      return;
    }
    if (!exit.stageId) return;
    if (needsCategoryFirst) {
      setPickedCategory("");
      setPanel({ kind: "category", exit });
      return;
    }
    if (guide.requires === "note" && !canSupervise) {
      setNoteText("");
      setPanel({ kind: "note", exit });
      return;
    }
    void moveTo(exit.stageId);
  }

  const visibleExits = guide.exits.filter((e) => e.type !== "close" || perms.canClose);
  const registerSolutionFirst = guide.requires === "solution" && banner?.action === "register";
  const showSolutionButton = !!banner && perms.canEdit;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      {/* Progreso */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 pt-2.5">
        <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1" aria-label="Pasos de la gestión">
          {guide.steps.map((step, i) => (
            <li key={step.id} className="flex items-center" aria-current={step.state === "current" ? "step" : undefined}>
              <span
                className={cn(
                  "inline-flex cursor-default select-none items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]",
                  step.state === "current" && "border-primary bg-primary font-medium text-primary-foreground",
                  step.state === "past" && "border-transparent bg-muted text-muted-foreground",
                  step.state === "next" && "border-dashed border-border bg-transparent text-muted-foreground/70",
                )}
              >
                {step.state === "past" && <Check className="h-3 w-3" aria-hidden />}
                {step.name}
              </span>
            </li>
          ))}
          {guide.finalsLabel && (
            <li className="flex items-center">
              <span className="inline-flex cursor-default items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground/70">
                <Flag className="h-3 w-3" aria-hidden />
                {guide.finalsLabel}
              </span>
            </li>
          )}
        </ol>

        <div className="flex shrink-0 items-center gap-3 pt-0.5">
          {guide.backStage && perms.canEdit && (
            <button
              onClick={() => guide.backStage && void moveTo(guide.backStage.id)}
              disabled={busy !== null}
              title={`Volver a «${guide.backStage.name}»`}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
            >
              <CornerUpLeft className="h-3 w-3" />
              Volver un paso
            </button>
          )}

          {perms.canEdit && pickAny && (
            <Popover
              open={moveOpen}
              onClose={() => setMoveOpen(false)}
              align="right"
              className="w-64"
              trigger={
                <button
                  onClick={() => setMoveOpen((v) => !v)}
                  disabled={busy !== null}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-60",
                    canSupervise ? "font-medium" : "text-muted-foreground",
                  )}
                  aria-label={canSupervise ? "Saltar a otra etapa" : "Cambiar etapa"}
                >
                  {canSupervise ? "Saltar a…" : "Cambiar etapa"}
                  <ChevronDown className="h-3 w-3" />
                </button>
              }
            >
              <p className={menuHeading}>{canSupervise ? "Saltar a (supervisor)" : "Mover a"}</p>
              {caseType.stages
                .filter((s) => s.kind === "open" && (!s.archived || s.id === active.stageId))
                .map((s) => (
                  <button
                    key={s.id}
                    className={menuItem}
                    onClick={() => {
                      if (s.id !== active.stageId) void moveTo(s.id, { jump: canSupervise });
                      else setMoveOpen(false);
                    }}
                  >
                    <span className="truncate">{s.name}</span>
                    {s.id === active.stageId && <Check className="ml-auto h-3.5 w-3.5" />}
                  </button>
                ))}
              {perms.canClose && (
                <div className="mt-1 border-t border-border pt-1">
                  <p className={menuHeading}>Cerrar como</p>
                  {closeItems.map(({ option: o, label, needsApproval, disabledReason }) => (
                    <button
                      key={o.stageId ?? o.kind}
                      className={menuItem}
                      disabled={!!disabledReason}
                      title={disabledReason ?? (needsApproval ? "Un supervisor tiene que aprobar este cierre" : undefined)}
                      onClick={() => {
                        setMoveOpen(false);
                        setPanel({ kind: "close", stageId: o.stageId });
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
                </div>
              )}
              {canSupervise && (
                <p className="mt-1 border-t border-border px-2 pt-1.5 text-[11px] leading-snug text-muted-foreground">
                  Queda en el historial quién saltó.
                </p>
              )}
            </Popover>
          )}
        </div>
      </div>

      <div className="space-y-2.5 px-3 pb-3 pt-2">
        <p className="text-sm leading-snug">
          <span className="mr-1.5 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 align-[1px] text-[11px] font-bold uppercase tracking-wide text-primary">
            Ahora
          </span>
          {guide.now}
        </p>

        {/* Plazo de la solución (control de reclamos) */}
        {banner && (
          <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5 text-[11px]", BANNER_TONE[banner.tone])}>
            {banner.tone === "ok" ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 basis-48 break-words font-medium">{banner.text}</span>
            {showSolutionButton && !panel && (
              <button
                onClick={() => setPanel({ kind: "solution" })}
                disabled={busy !== null}
                className={cn(
                  registerSolutionFirst ? cn(primaryButtonClass, "px-2.5 py-1 text-xs") : "inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60",
                )}
              >
                {banner.actionLabel}
              </button>
            )}
          </div>
        )}

        {/* Botones del siguiente paso */}
        {!panel && perms.canEdit && visibleExits.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Siguiente paso">
            {visibleExits.map((exit, i) => (
              <ExitButton
                key={`${exit.stageId ?? exit.type}-${i}`}
                exit={registerSolutionFirst && exit.tone === "primary" ? { ...exit, tone: "ghost" } : exit}
                disabled={!canEdit || (exit.type === "close" && !!closingBlocked(exit.stageId))}
                onClick={() => pickExit(exit)}
              />
            ))}
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Guardando" />}
          </div>
        )}
        {!panel && !perms.canEdit && (
          <p className="text-[11px] text-muted-foreground">Solo quien tiene la gestión puede avanzarla.</p>
        )}

        {panel?.kind === "category" && (
          <FormBox title="¿Qué pasó?" onCancel={() => setPanel(null)}>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Categoría">
              {categories.map((c) => (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={pickedCategory === c.id}
                  onClick={() => setPickedCategory(c.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    pickedCategory === c.id ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-background hover:bg-accent",
                  )}
                >
                  {c.name}
                  {c.isHighPriority ? " (prioridad)" : ""}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={!pickedCategory || busy !== null}
                onClick={async () => {
                  const target = panel.exit.stageId;
                  if (!target) return;
                  const ok = await run("category", () => setCaseCategory(active.id, pickedCategory), undefined);
                  if (ok) await moveTo(target);
                }}
                className={cn(primaryButtonClass, "py-1.5 text-xs")}
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Guardar y pasar a {panel.exit.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <span className="text-[11px] text-muted-foreground">Es obligatorio para seguir.</span>
            </div>
          </FormBox>
        )}

        {panel?.kind === "note" && (
          <FormBox title="Deja una nota antes de seguir" onCancel={() => setPanel(null)}>
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
              disabled={!noteText.trim() || busy !== null}
              onClick={async () => {
                const target = panel.exit.stageId;
                if (!target) return;
                const ok = await run("note", () => addCaseNote(active.id, noteText.trim()), undefined);
                if (ok) await moveTo(target);
              }}
              className={cn(primaryButtonClass, "py-1.5 text-xs")}
            >
              Guardar nota y pasar a {panel.exit.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </FormBox>
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
                const ok = await run(
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

        {/* Categoría (cambiarla cuando no se pide en este paso) */}
        {categories.length > 0 && perms.canEdit && !panel && (
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            Categoría:
            <select
              value={active.categoryId ?? ""}
              disabled={!canEdit}
              onChange={(e) =>
                void run("category", () => setCaseCategory(active.id, e.target.value || null), "Categoría actualizada.")
              }
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
    </div>
  );
}
