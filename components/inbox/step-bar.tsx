"use client";

// Barra de pasos de la tarjeta de gestión: UNA línea que es el control para
// moverse. Hechos como ✓, el actual con número y nombre, el siguiente siempre
// con nombre y los demás con nombre o solo número según el ancho real (se mide
// con ResizeObserver; el reparto es la función pura layoutStepBar). Si no cabe,
// los hechos se pliegan en «✓ N hechos». Cada paso es un botón: tocarlo pide
// confirmación (la maneja quien usa este componente).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { layoutStepBar, STRICT_LOCK_MESSAGE, type BarStep, type StepMode, type StepWidths } from "./step-bar-model";
import { Popover } from "./ui";

const GAP = 6;

const MODE_WIDTH = "h-7 w-7 px-0";

function chipClass(step: BarStep, mode: StepMode, picked: boolean): string {
  return cn(
    "relative inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border text-xs transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card",
    mode === "name" ? "max-w-[15rem] px-2.5" : MODE_WIDTH,
    step.state === "current" && "border-primary bg-primary font-medium text-primary-foreground",
    step.state === "past" && "border-transparent bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
    step.state === "next" &&
      "border-dashed border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
    step.locked && "cursor-not-allowed opacity-75",
    picked && "border-solid border-primary bg-primary/10 text-foreground ring-2 ring-primary",
  );
}

function stepLabel(step: BarStep): string {
  const state = step.state === "current" ? "paso actual" : step.state === "past" ? "hecho" : "pendiente";
  return `Paso ${step.number}: ${step.name} (${state})${step.locked ? `. ${STRICT_LOCK_MESSAGE}` : ""}`;
}

function StepChip({
  step,
  mode,
  picked = false,
  disabled = false,
  onPick,
  measure = false,
}: {
  step: BarStep;
  mode: StepMode;
  picked?: boolean;
  disabled?: boolean;
  onPick?: (step: BarStep) => void;
  measure?: boolean;
}) {
  const showTip = !measure && !picked && (mode !== "name" || step.locked);
  const content =
    mode === "name" ? (
      <>
        {step.state === "past" ? (
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : step.locked ? (
          <Lock className="h-3 w-3 shrink-0" aria-hidden />
        ) : (
          <span
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
              step.state === "current" ? "bg-primary-foreground/25" : "bg-muted",
            )}
          >
            {step.number}
          </span>
        )}
        <span className="truncate">{step.name}</span>
      </>
    ) : mode === "check" ? (
      <>
        <Check className="h-3.5 w-3.5" aria-hidden />
        {step.locked && (
          <Lock className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-card p-px text-muted-foreground" aria-hidden />
        )}
      </>
    ) : step.locked ? (
      <Lock className="h-3 w-3" aria-hidden />
    ) : (
      <span className="text-[11px] font-medium">{step.number}</span>
    );

  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        onClick={measure ? undefined : () => onPick?.(step)}
        disabled={disabled && !measure}
        aria-label={stepLabel(step)}
        aria-current={step.state === "current" ? "step" : undefined}
        aria-disabled={step.locked || undefined}
        tabIndex={measure ? -1 : undefined}
        className={chipClass(step, mode, picked)}
        data-step-id={step.id}
      >
        {content}
      </button>
      {showTip && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 hidden w-max max-w-64 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium leading-snug text-background shadow-md group-focus-within:block group-hover:block"
        >
          {step.locked ? STRICT_LOCK_MESSAGE : step.state === "past" ? `${step.name} · hecho` : step.name}
        </span>
      )}
    </div>
  );
}

export function StepBar({
  steps,
  header,
  hint,
  hintTone = "muted",
  pickedId,
  disabled,
  onPick,
  trailing,
}: {
  steps: readonly BarStep[];
  /** «Paso 4 de 4» (null = la gestión aún no tiene paso). */
  header: string | null;
  hint: string;
  hintTone?: "muted" | "lock";
  /** Paso que se está confirmando (resaltado). */
  pickedId: string | null;
  disabled: boolean;
  onPick: (step: BarStep) => void;
  /** Al final de la barra (el botón «Cerrar»). */
  trailing?: ReactNode;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [widths, setWidths] = useState<{ steps: StepWidths[]; fold: number } | null>(null);
  const [foldOpen, setFoldOpen] = useState(false);

  const stepKey = steps.map((s) => `${s.id}:${s.state}:${s.locked}:${s.name}`).join("|");

  const measure = useCallback(() => {
    const root = measureRef.current;
    if (!root) return;
    const w = (selector: string) => root.querySelector<HTMLElement>(selector)?.offsetWidth ?? 0;
    setWidths({
      steps: steps.map((s) => ({
        state: s.state,
        check: w(`[data-m="${s.id}:check"] button`),
        number: w(`[data-m="${s.id}:number"] button`),
        name: w(`[data-m="${s.id}:name"] button`),
      })),
      fold: w("[data-m=fold]"),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts?.ready) return;
    let alive = true;
    void fonts.ready.then(() => alive && measure());
    return () => {
      alive = false;
    };
  }, [measure]);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    setAvailable(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAvailable(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!widths || available === null || widths.steps.length !== steps.length) {
      return {
        folded: false,
        modes: steps.map((s, i): StepMode =>
          s.state === "past" ? "check" : s.state === "current" ? "name" : i === steps.findIndex((x) => x.state === "next") ? "name" : "number",
        ),
      };
    }
    return layoutStepBar({ steps: widths.steps, available, gap: GAP, foldWidth: widths.fold });
  }, [widths, available, steps]);

  const past = steps.filter((s) => s.state === "past");

  return (
    <div className="px-3 pt-2.5">
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">{header ?? "Elige el paso"}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 truncate",
            hintTone === "lock" ? "rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground" : "text-muted-foreground",
          )}
        >
          {hintTone === "lock" && <Lock className="h-3 w-3" aria-hidden />}
          {hint}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <div ref={areaRef} className="relative min-w-0 flex-1">
          <ol className="flex flex-nowrap items-center" style={{ gap: GAP }} aria-label="Pasos de la gestión">
            {layout.folded && past.length > 0 && (
              <li className="shrink-0">
                <Popover
                  open={foldOpen}
                  onClose={() => setFoldOpen(false)}
                  className="w-60"
                  trigger={
                    <button
                      type="button"
                      onClick={() => setFoldOpen((v) => !v)}
                      aria-label={`${past.length} pasos hechos. Ver cuáles`}
                      className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border border-transparent bg-muted px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      {past.length} hechos
                    </button>
                  }
                >
                  {past.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setFoldOpen(false);
                        onPick(s);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      <span className="truncate">{s.name}</span>
                      {s.locked && <Lock className="ml-auto h-3 w-3 text-muted-foreground" aria-hidden />}
                    </button>
                  ))}
                </Popover>
              </li>
            )}
            {steps.map((s, i) =>
              layout.folded && s.state === "past" ? null : (
                <li key={s.id} className="shrink-0">
                  <StepChip step={s} mode={layout.modes[i]} picked={pickedId === s.id} disabled={disabled} onPick={onPick} />
                </li>
              ),
            )}
          </ol>

          {/* Copia invisible para medir cada forma de cada paso. */}
          <div
            ref={measureRef}
            aria-hidden
            className="pointer-events-none invisible fixed left-[-9999px] top-0 flex flex-col"
          >
            {steps.map((s) =>
              (["check", "number", "name"] as const).map((m) => (
                <div key={`${s.id}:${m}`} data-m={`${s.id}:${m}`} className="flex">
                  <StepChip step={s} mode={m} measure />
                </div>
              )),
            )}
            <span
              data-m="fold"
              className="inline-flex h-7 w-max items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              {Math.max(past.length, 1)} hechos
            </span>
          </div>
        </div>
        {trailing}
      </div>
    </div>
  );
}
