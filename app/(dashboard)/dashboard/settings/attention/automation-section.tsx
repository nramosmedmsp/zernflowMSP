"use client";

import { useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";
import { Check, Loader2, Save } from "lucide-react";
import { saveAttentionAutomation } from "@/lib/actions/settings";
import { MAX_MIN_HOURS_BETWEEN, MAX_REASSIGN_MINUTES, OFF_HOURS_REPLY_MAX } from "@/lib/business-hours";
import type { BusinessHours } from "@/lib/types/database";
import {
  OFF_HOURS_VARIABLES,
  previewOpening,
  renderOffHoursPreview,
  type AutomationForm,
} from "./automation-rules";

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

export function AutomationSection({
  workspaceId,
  workspaceName,
  initial,
  businessHours,
  holidayDates,
  activeTeams,
}: {
  workspaceId: string;
  workspaceName: string;
  initial: AutomationForm;
  /** Horario de la empresa (la vista previa usa este; cada equipo usa el suyo). */
  businessHours: BusinessHours | null;
  holidayDates: string[];
  activeTeams: number;
}) {
  const [form, setForm] = useState<AutomationForm>(initial);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const dirty =
    form.offHoursEnabled !== initial.offHoursEnabled ||
    form.offHoursText.trim() !== initial.offHoursText.trim() ||
    form.minHoursBetween.trim() !== initial.minHoursBetween.trim() ||
    form.reassignMinutes.trim() !== initial.reassignMinutes.trim();

  const opening = useMemo(
    () => previewOpening(new Date(), businessHours, holidayDates),
    [businessHours, holidayDates],
  );
  const preview = renderOffHoursPreview(form.offHoursText, {
    nombre: "María",
    empresa: workspaceName || "tu empresa",
    apertura: opening ?? "lunes 9:00",
  });

  function set<K extends keyof AutomationForm>(key: K, value: AutomationForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function insertVariable(token: string) {
    const el = textRef.current;
    const text = form.offHoursText;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    set("offHoursText", next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const result = await saveAttentionAutomation(workspaceId, form);
      if ("error" in result) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Respuesta automática y reasignación guardadas");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("No se pudo guardar la configuración. Inténtalo de nuevo.");
      toast.error("No se pudo guardar la configuración. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <hr className="border-border" />

      <section>
        <h2 className="text-sm font-semibold">Respuesta fuera de horario</h2>
        <label className="mt-3 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={form.offHoursEnabled}
            onChange={(e) => set("offHoursEnabled", e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-medium">Responder automáticamente cuando escriben fuera de horario</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Se envía una vez por gestión, o de nuevo pasadas las horas que indiques. Usa los{" "}
              <Link href="/dashboard/settings/hours" className="underline underline-offset-2">
                horarios
              </Link>{" "}
              de cada equipo (o el de la empresa).
              {!businessHours && " Hoy no hay horario de empresa: se atiende las 24 horas y nunca se enviará."}
            </span>
          </span>
        </label>

        <div className="mt-4">
          <label htmlFor="off-hours-text" className="mb-1 block text-xs font-medium text-muted-foreground">
            Texto del mensaje
          </label>
          <textarea
            id="off-hours-text"
            ref={textRef}
            value={form.offHoursText}
            onChange={(e) => set("offHoursText", e.target.value)}
            rows={4}
            maxLength={OFF_HOURS_REPLY_MAX}
            className={`${inputClass} w-full resize-y`}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Insertar:</span>
            {OFF_HOURS_VARIABLES.map((v) => (
              <button
                key={v.token}
                type="button"
                title={v.hint}
                onClick={() => insertVariable(v.token)}
                className="rounded-md border border-border px-2 py-0.5 font-mono text-xs hover:bg-muted"
              >
                {v.token}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">
              {form.offHoursText.length}/{OFF_HOURS_REPLY_MAX}
            </span>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-medium text-muted-foreground">Vista previa</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{preview || "—"}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {opening
              ? `Con el horario de la empresa, quien escriba fuera de horario vería «${opening}» como próxima apertura.`
              : "Sin horario de empresa no hay próxima apertura: se muestra un ejemplo."}
            {activeTeams > 0 && " Cada equipo usa su propio horario si lo tiene."}
          </p>
        </div>

        <div className="mt-3">
          <label htmlFor="off-hours-between" className="mb-1 block text-xs font-medium text-muted-foreground">
            Horas mínimas entre envíos en la misma gestión
          </label>
          <input
            id="off-hours-between"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_MIN_HOURS_BETWEEN}
            step={1}
            value={form.minHoursBetween}
            onChange={(e) => set("minHoursBetween", e.target.value)}
            placeholder="Una sola vez"
            className={`${inputClass} w-40`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Vacío: se envía una sola vez por gestión. Con un número, se repite si el cliente vuelve a escribir fuera de
            horario pasado ese tiempo.
          </p>
        </div>
      </section>

      <hr className="border-border" />

      <section>
        <h2 className="text-sm font-semibold">Reasignación por espera</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Si una gestión asignada lleva este tiempo esperando respuesta, vuelve a la cola y se reparte a otra persona.
          Los minutos cuentan solo dentro del horario de atención.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_REASSIGN_MINUTES}
            step={1}
            value={form.reassignMinutes}
            onChange={(e) => set("reassignMinutes", e.target.value)}
            placeholder="Desactivada"
            aria-label="Minutos hábiles de espera antes de reasignar"
            className={`${inputClass} w-40`}
          />
          <span className="text-sm text-muted-foreground">minutos hábiles</span>
        </div>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          <li>Vacío: la reasignación está desactivada.</li>
          <li>Solo se reasigna a otra persona disponible del mismo equipo; si no hay nadie más, la gestión se queda donde está.</li>
          <li>Se avisa al supervisor y a la persona que la tenía, y queda en el historial de la gestión.</li>
        </ul>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Guardando…" : "Guardar respuesta y reasignación"}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <Check className="h-4 w-4" />
            Configuración guardada
          </span>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </>
  );
}
