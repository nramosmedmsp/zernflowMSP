"use client";

// Revisión al enviar (lib/send-review.ts): sugerencias de tildes, abreviaturas
// y signos ¿ ¡, más las llaves sin reemplazar. Solo aparece si hay algo; nunca
// envía ni cambia nada sin que el asesor lo elija.

import { useEffect } from "react";
import { ArrowRight, Check, SpellCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Suggestion } from "@/lib/send-review";
import { primaryButtonClass, secondaryButtonClass } from "./ui";

/** De dónde sale la sugerencia, a la derecha de cada fila. */
function noteFor(s: Suggestion): string {
  if (s.kind === "mark") return `falta ${s.to}`;
  if (s.source === "diccionario") return s.unsure ? "diccionario · revisa" : "diccionario";
  if (s.source === "pregunta") return "pregunta";
  return "lista fija";
}

export function SendReviewPopover({
  suggestions,
  unresolved,
  chosen,
  onToggle,
  onApply,
  onSendAsIs,
  onCancel,
  onDisable,
}: {
  suggestions: Suggestion[];
  unresolved: string[];
  chosen: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Corrige lo elegido y envía. */
  onApply: () => void;
  onSendAsIs: () => void;
  /** Vuelve a la caja para seguir editando. */
  onCancel: () => void;
  onDisable: () => void;
}) {
  const hasFixes = suggestions.length > 0;
  // En captura, como el buscador de respuestas: Enter corrige y envía, Esc vuelve a editar.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        // Solo llaves sin reemplazar: Enter vuelve a la caja para corregirlas.
        if (hasFixes) onApply();
        else onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onApply, onCancel, hasFixes]);

  return (
    <div
      role="dialog"
      aria-label="Revisión antes de enviar"
      className="animate-pop-in absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <SpellCheck className="h-3.5 w-3.5 text-primary" />
          {hasFixes ? "¿Corregimos antes de enviar?" : "Revisa antes de enviar"}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {hasFixes ? "Enter corrige y envía · Esc para seguir editando" : "Enter o Esc para seguir editando"}
        </span>
      </div>

      {hasFixes && (
        <ul className="max-h-56 overflow-y-auto py-1">
          {suggestions.map((s) => {
            const on = chosen.has(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onToggle(s.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-accent/60"
                  aria-pressed={on}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                    )}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 truncate text-sm text-muted-foreground line-through decoration-red-500/70">
                    {s.kind === "mark" ? s.preview?.before : s.from}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate text-sm font-medium text-green-700 dark:text-green-400">
                    {s.kind === "mark" ? s.preview?.after : s.to}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{noteFor(s)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {unresolved.length > 0 && (
        <div className="flex items-center gap-2 border-t border-border bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          <span>
            Quedó <span className="font-mono">{unresolved.join(", ")}</span> sin reemplazar. El cliente lo vería tal cual: corrígelo antes de enviar.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={onDisable}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          No volver a revisar en este equipo
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onSendAsIs} className={cn(secondaryButtonClass, "py-1 text-xs")}>
            Enviar así
          </button>
          {hasFixes && (
            <button type="button" onClick={onApply} className={cn(primaryButtonClass, "py-1 text-xs")}>
              Corregir y enviar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
