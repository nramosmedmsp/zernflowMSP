"use client";

import { useState } from "react";
import { updateCaseType } from "@/lib/actions/case-config";
import { MAX_REOPEN_DAYS, MAX_SOLUTION_HOURS, parseOptionalPositiveInt } from "./config-rules";
import { SaveBar, SectionTitle, Switch, inputClass, type TabProps } from "./shared";

/** Control de reclamos: protege el tipo, plazo para registrar la solución y ventana de reapertura. */
export function ClaimsTab({ type, run, busy }: TabProps) {
  const [isProtected, setProtected] = useState(type.protected);
  const [hours, setHours] = useState(type.solutionDeadlineHours?.toString() ?? "");
  const [days, setDays] = useState(type.reopenWindowDays?.toString() ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const dirty =
    isProtected !== type.protected ||
    hours !== (type.solutionDeadlineHours?.toString() ?? "") ||
    days !== (type.reopenWindowDays?.toString() ?? "");

  async function save() {
    if (parseOptionalPositiveInt(hours, MAX_SOLUTION_HOURS) === undefined) {
      setLocalError(`El plazo debe ser un número entero de horas, de 1 a ${MAX_SOLUTION_HOURS}, o quedar vacío.`);
      return;
    }
    if (parseOptionalPositiveInt(days, MAX_REOPEN_DAYS) === undefined) {
      setLocalError(`Los días deben ser un número entero, de 1 a ${MAX_REOPEN_DAYS}, o quedar vacíos.`);
      return;
    }
    setLocalError(null);
    await run(
      () => updateCaseType({ id: type.id, protected: isProtected, solutionDeadlineHours: hours, reopenWindowDays: days }),
      "Control de reclamos guardado.",
    );
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Control de reclamos"
        hint="Para tipos donde un reclamo no debe perderse, como Postventa. Todo es opcional: sin activar nada, el tipo funciona como siempre."
      />

      <Switch
        checked={isProtected}
        disabled={busy}
        onChange={setProtected}
        label="Proteger este tipo (solo el supervisor cambia el tipo o cierra sin solución)"
        hint="Un asesor no puede cambiar el tipo de la gestión. Si quiere cerrarla sin solución, deja un pedido que el supervisor del equipo aprueba o rechaza. Resolverla pide contar qué se hizo. Los supervisores reciben aviso de cada cambio, cierre y reapertura."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="claims-hours" className="mb-1 block text-xs font-medium text-muted-foreground">
            Plazo para registrar la solución (horas hábiles)
          </label>
          <input
            id="claims-hours"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_SOLUTION_HOURS}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            disabled={busy}
            placeholder="Sin plazo"
            className={`${inputClass} w-full`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Desde que se abre, la gestión debe cerrarse como resuelta o tener registrada una solución en proceso con fecha compromiso. Si no, se avisa al supervisor. Cuenta horas hábiles según el horario de atención del equipo (o de la empresa) y sus feriados; sin horario configurado, cuenta horas corridas. Al activarlo o cambiarlo, las gestiones abiertas que aún no tenían plazo empiezan a contar desde ese momento.
          </p>
        </div>
        <div>
          <label htmlFor="claims-days" className="mb-1 block text-xs font-medium text-muted-foreground">
            Reabrir si el cliente escribe dentro de (días)
          </label>
          <input
            id="claims-days"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_REOPEN_DAYS}
            step={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={busy}
            placeholder="24 horas"
            className={`${inputClass} w-full`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Si el cliente vuelve a escribir después del cierre dentro de este tiempo, se reabre la misma gestión. Vacío = 24 horas.
          </p>
        </div>
      </div>

      {localError && <p className="text-xs text-destructive">{localError}</p>}
      <SaveBar dirty={dirty} busy={busy} onSave={save} />
    </div>
  );
}
