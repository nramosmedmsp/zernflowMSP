"use client";

// Formulario pequeño «Registrar solución» de la tarjeta de gestión (control de
// reclamos): qué solución se está dando y hasta cuándo (fecha compromiso).

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { limaDateOf } from "@/lib/cases/dates";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { commitmentOptions } from "./case-card-model";
import { inputClass, primaryButtonClass } from "./ui";

// Borradores de la nota por gestión: si se cierra el formulario por un error o
// con Esc, al volver a abrirlo lo escrito sigue ahí (solo en memoria).
const noteDrafts = new Map<string, string>();

/** Descarta el borrador de la gestión (ya se guardó la solución). */
export function clearSolutionDraft(caseId: string): void {
  noteDrafts.delete(caseId);
}

const chip =
  "rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60";

export function SolutionForm({
  caseId,
  initialNote,
  initialCommitment,
  now,
  saving,
  error,
  onSave,
}: {
  /** Para conservar lo escrito si el formulario se cierra sin guardar. */
  caseId?: string;
  initialNote: string | null;
  /** Fecha compromiso ya registrada (ISO), si se está actualizando. */
  initialCommitment: string | null;
  /** Reloj de la tarjeta (null antes de montar). */
  now: number | null;
  saving: boolean;
  error?: string | null;
  onSave: (note: string, commitmentAt: string) => void;
}) {
  const options = now === null ? [] : commitmentOptions(new Date(now));
  const [note, setNoteState] = useState(() => (caseId ? noteDrafts.get(caseId) : undefined) ?? initialNote ?? "");
  function setNote(value: string) {
    setNoteState(value);
    if (caseId) {
      if (value.trim()) noteDrafts.set(caseId, value);
      else noteDrafts.delete(caseId);
    }
  }
  // "custom" = fecha y hora elegidas a mano; si no, la clave de una opción rápida.
  const [choice, setChoice] = useState<string>(initialCommitment ? "custom" : "tomorrow");
  const [date, setDate] = useState(initialCommitment ? limaDateOf(new Date(initialCommitment)) : "");
  const [time, setTime] = useState(initialCommitment ? formatTime(initialCommitment) : "18:00");

  const picked = options.find((o) => o.key === choice);
  const commitment =
    choice === "custom" ? (date ? `${date}T${time || "18:00"}:00-05:00` : null) : (picked?.at ?? null);
  const ready = note.trim() !== "" && commitment !== null;

  return (
    <div className="space-y-2.5 p-1 text-foreground">
      <div className="space-y-1">
        <label htmlFor="solution-note" className="text-xs font-medium">
          ¿Qué solución se está dando?
        </label>
        <textarea
          id="solution-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Ej.: Cambio del producto, sale con el courier del jueves"
          className={cn(inputClass, "resize-none py-1.5 text-xs")}
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium">Fecha compromiso</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fecha compromiso">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setChoice(o.key)}
              aria-pressed={choice === o.key}
              title={o.detail}
              className={cn(
                chip,
                choice === o.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent",
              )}
            >
              {o.label}
              <span className={cn("ml-1 text-[10px]", choice === o.key ? "opacity-80" : "text-muted-foreground")}>
                {o.detail.replace(/^(hoy|mañana) /, "")}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setChoice("custom")}
            aria-pressed={choice === "custom"}
            className={cn(
              chip,
              choice === "custom" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent",
            )}
          >
            Otra fecha
          </button>
        </div>
        {choice === "custom" && (
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              min={now === null ? undefined : limaDateOf(new Date(now))}
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
        )}
        <p className="text-[11px] leading-snug text-muted-foreground">
          Ese día y hora quedan como próximo contacto, y si no se cumple se avisa al supervisor.
        </p>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => commitment && onSave(note.trim(), commitment)}
          disabled={saving || !ready}
          className={cn(primaryButtonClass, "py-1 text-xs")}
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Guardar solución
        </button>
      </div>
    </div>
  );
}
