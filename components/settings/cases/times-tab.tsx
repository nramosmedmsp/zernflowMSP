"use client";

import { useState } from "react";
import { updateCaseType } from "@/lib/actions/case-config";
import { MAX_SLA_HOURS, MAX_SLA_MINUTES, parseOptionalPositiveInt } from "./config-rules";
import { SaveBar, SectionTitle, inputClass, type TabProps } from "./shared";

export function TimesTab({ type, run, busy }: TabProps) {
  const [minutes, setMinutes] = useState(type.slaFirstResponseMinutes?.toString() ?? "");
  const [hours, setHours] = useState(type.slaResolutionHours?.toString() ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const dirty = minutes !== (type.slaFirstResponseMinutes?.toString() ?? "") || hours !== (type.slaResolutionHours?.toString() ?? "");

  async function save() {
    if (parseOptionalPositiveInt(minutes, MAX_SLA_MINUTES) === undefined) {
      setLocalError(`La primera respuesta debe ser un número entero de minutos, de 1 a ${MAX_SLA_MINUTES}, o quedar vacía.`);
      return;
    }
    if (parseOptionalPositiveInt(hours, MAX_SLA_HOURS) === undefined) {
      setLocalError(`La resolución debe ser un número entero de horas, de 1 a ${MAX_SLA_HOURS}, o quedar vacía.`);
      return;
    }
    setLocalError(null);
    await run(() => updateCaseType({ id: type.id, slaFirstResponseMinutes: minutes, slaResolutionHours: hours }), "Tiempos guardados.");
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Objetivos de tiempo"
        hint="Dejar un campo vacío significa que no hay objetivo."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sla-first" className="mb-1 block text-xs font-medium text-muted-foreground">
            Primera respuesta (minutos)
          </label>
          <input
            id="sla-first"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_SLA_MINUTES}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            disabled={busy}
            placeholder="Sin objetivo"
            className={`${inputClass} w-full`}
          />
          <p className="mt-1 text-xs text-muted-foreground">Cuánto puede esperar el cliente la primera respuesta humana.</p>
        </div>
        <div>
          <label htmlFor="sla-resolution" className="mb-1 block text-xs font-medium text-muted-foreground">
            Resolución (horas)
          </label>
          <input
            id="sla-resolution"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_SLA_HOURS}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            disabled={busy}
            placeholder="Sin objetivo"
            className={`${inputClass} w-full`}
          />
          <p className="mt-1 text-xs text-muted-foreground">Cuánto puede pasar desde que se abre hasta que se cierra.</p>
        </div>
      </div>

      {localError && <p className="text-xs text-destructive">{localError}</p>}
      <SaveBar dirty={dirty} busy={busy} onSave={save} />
    </div>
  );
}
