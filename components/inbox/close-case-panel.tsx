"use client";

// Cierre dentro de la guía de la gestión (docs/FASE-1-TECNICO.md 3.4 y 4.1):
// al elegir un cierre se muestra aquí, en la misma tarjeta, lo que va a pasar
// (resultado, cambio de tipo de contacto, gestiones que se programarán) y lo
// que falta pedir (motivo, categoría, nota, fecha clave). Usa la vista previa
// y el cierre del servidor, con las mismas reglas que antes tenía el diálogo.

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { describeSkippedEffects } from "@/lib/cases/close-messages";
import { closeCase, previewCloseCase, type CaseTypeOption, type CaseView } from "@/lib/actions/cases";
import type { ClosePreview } from "@/lib/cases/close";
import { isDateString, limaDateOf } from "@/lib/cases/dates";
import { closeConsequences } from "@/lib/cases/guide";
import { OUTCOME_LABELS } from "@/lib/cases/rules";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { closeSelection } from "./case-card-model";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "./ui";

// Se monta solo mientras está abierto: cada apertura empieza con el formulario limpio.
export function CloseCasePanel({
  caseView,
  caseType,
  stageId: initialStageId,
  contactTypeName,
  onCancel,
  onClosed,
}: {
  caseView: CaseView;
  caseType: CaseTypeOption | null;
  /** Etapa final elegida en la guía (null = tipo sin etapas finales: se resuelve). */
  stageId: string | null;
  /** Nombre de un tipo de contacto por id (para «El contacto pasará a …»). */
  contactTypeName: (id: string | null) => string | null;
  onCancel: () => void;
  /** `problem`: la gestión se cerró pero algún efecto de las reglas no se aplicó (el aviso es de error). */
  onClosed: (message: string, problem?: boolean) => void;
}) {
  const initial = useMemo(() => closeSelection(caseType?.stages, initialStageId), [caseType, initialStageId]);
  const kind = initial?.kind ?? "resolved";
  const stageId = initial?.stageId ?? "";
  const stage = caseType?.stages.find((s) => s.id === initialStageId) ?? null;
  const outcomeName = stage?.name ?? OUTCOME_LABELS[kind];

  const [reasonId, setReasonId] = useState("");
  const [categoryId, setCategoryId] = useState(caseView.categoryId ?? "");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [keyDate, setKeyDate] = useState("");
  const [keyDateTouched, setKeyDateTouched] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [skipSchedule, setSkipSchedule] = useState(false);
  const [preview, setPreview] = useState<ClosePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [lastSchedules, setLastSchedules] = useState<ClosePreview["schedules"]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Control de reclamos: en un tipo protegido, resolver pide contar qué se hizo y
  // cerrar sin solución lo aprueba un supervisor (el asesor solo lo pide).
  const isProtected = !!caseType?.protected;
  const noteRequired = isProtected && kind !== "lost";
  const isRequest = isProtected && kind === "lost" && !caseView.canSupervise;

  const reasonsOfKind = (caseType?.outcomeReasons ?? []).filter((r) => r.kind === kind && !r.archived);
  const categories = (caseType?.categories ?? []).filter((c) => !c.archived || c.id === caseView.categoryId);
  const showCategory = !!caseType?.requireCategory && categories.length > 0;
  const categoryOverride = showCategory && categoryId !== (caseView.categoryId ?? "") ? categoryId || null : undefined;

  // Vista previa: qué reglas se aplicarán con lo elegido.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await previewCloseCase({
        caseId: caseView.id,
        kind,
        stageId: stageId || null,
        outcomeReasonId: reasonId || null,
        categoryId: categoryOverride,
        keyDate: isDateString(keyDate) ? keyDate : null,
        scheduleAt: scheduleDate || null,
        skipSchedule,
      }).catch(() => ({ error: "No se pudo calcular el cierre. Inténtalo de nuevo." }));
      if (cancelled) return;
      if ("error" in result) {
        setPreviewError(result.error);
        setPreview(null);
        return;
      }
      setPreviewError(null);
      setPreview(result.preview);
      if (result.preview.schedules.length > 0) setLastSchedules(result.preview.schedules);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [caseView.id, kind, stageId, reasonId, categoryOverride, keyDate, scheduleDate, skipSchedule]);

  // Precarga la fecha clave actual del contacto la primera vez que se pide.
  useEffect(() => {
    if (preview?.askKeyDate && !keyDateTouched && !keyDate && preview.askKeyDate.current) {
      setKeyDate(preview.askKeyDate.current);
    }
  }, [preview, keyDate, keyDateTouched]);

  const reasonRequired = !!preview?.requires.outcomeReason || (!!caseType?.requireOutcomeReason && reasonsOfKind.length > 0);
  const schedules = preview?.schedules ?? [];
  const hadSchedules = lastSchedules.length > 0;
  const firstScheduled = schedules.find((s) => s.scheduledFor)?.scheduledFor ?? null;

  const missing: string[] = [];
  if (reasonRequired && !reasonId) missing.push("elegir el motivo");
  if (showCategory && !categoryId) missing.push("elegir la categoría");
  if (noteRequired && !note.trim()) missing.push("contar qué se hizo");
  if (preview?.askKeyDate && !isDateString(keyDate)) missing.push(`indicar la fecha: ${preview.askKeyDate.label}`);

  const consequences = closeConsequences({
    outcomeName,
    needsApproval: isRequest,
    preview,
    skipSchedule,
    contactTypeName,
    formatDate,
    missing,
  });

  async function handleSubmit() {
    if (missing.length > 0) return setError(`Falta ${missing[0]}.`);
    setSubmitting(true);
    setError(null);
    try {
      const result = await closeCase({
        caseId: caseView.id,
        kind,
        stageId: stageId || null,
        outcomeReasonId: reasonId || null,
        categoryId: categoryOverride,
        note: note.trim() || null,
        keyDate: preview?.askKeyDate ? keyDate : null,
        scheduleAt: scheduleDate || null,
        skipSchedule,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.requested) {
        onClosed("Pedido enviado: un supervisor lo revisará. La gestión sigue abierta mientras tanto.");
        return;
      }
      const parts = [`Gestión cerrada como ${OUTCOME_LABELS[result.status].toLowerCase()}.`];
      for (const s of result.effects.scheduled) {
        const name = lastSchedules.find((x) => x.caseTypeId === s.caseTypeId)?.caseTypeName ?? "Gestión";
        parts.push(`${s.rescheduled ? "Se movió" : "Se programó"} ${name} para el ${formatDate(s.scheduledFor)}.`);
      }
      const names = new Map<string, string | null>([
        ...lastSchedules.map((x) => [x.ruleId, x.caseTypeName] as const),
        ...(preview?.blocked ?? []).map((x) => [x.ruleId, x.caseTypeName] as const),
      ]);
      const problems = describeSkippedEffects(result.effects.skipped, names);
      parts.push(...problems);
      onClosed(parts.join(" "), problems.length > 0);
    } catch {
      setError("No se pudo cerrar la gestión. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  const tone = kind === "lost" ? "red" : "green";

  return (
    <div className="animate-pop-in space-y-2.5 rounded-lg border border-primary/30 bg-background p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">
          {isRequest ? `Pedir cierre «${outcomeName}»` : `Cerrar como «${outcomeName}»`}
        </p>
        <button onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">
          Cancelar
        </button>
      </div>

      {reasonsOfKind.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">{reasonRequired ? "Motivo (obligatorio)" : "Motivo"}</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Motivo">
            {reasonsOfKind.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={reasonId === r.id}
                onClick={() => setReasonId(reasonId === r.id ? "" : r.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  reasonId === r.id
                    ? tone === "red"
                      ? "border-red-300 bg-red-50 font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                      : "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border bg-background hover:bg-accent",
                )}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {showCategory && (
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Categoría (obligatoria)</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={cn(inputClass, "py-1 text-xs")}>
            <option value="">Elige una categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {(noteRequired || isRequest || showNote) && (
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {noteRequired ? "Qué se hizo (obligatorio)" : isRequest ? "Nota para el supervisor" : "Nota"}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={
              noteRequired
                ? "Cuenta qué se hizo para resolverlo"
                : isRequest
                  ? "Opcional: qué intentaste y por qué no se pudo resolver"
                  : "Opcional"
            }
            className={cn(inputClass, "resize-none py-1 text-xs")}
          />
        </label>
      )}
      {!noteRequired && !isRequest && !showNote && (
        <button type="button" onClick={() => setShowNote(true)} className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">
          + Agregar una nota
        </button>
      )}

      {preview?.askKeyDate && (
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">{preview.askKeyDate.label} (obligatoria)</span>
          <input
            type="date"
            value={keyDate}
            onChange={(e) => {
              setKeyDate(e.target.value);
              setKeyDateTouched(true);
            }}
            className={cn(inputClass, "py-1 text-xs")}
          />
        </label>
      )}

      {/* Lo que va a pasar */}
      <ul className="space-y-1 rounded-md bg-muted/50 px-2.5 py-2 text-xs" aria-label="Lo que va a pasar">
        {consequences.map((c, i) => (
          <li key={i} className="flex items-start gap-2">
            {c.tone === "ok" ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden />
            ) : (
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
            )}
            <span>{c.text}</span>
          </li>
        ))}
      </ul>

      {hadSchedules && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          {!skipSchedule && (
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{schedules.length > 1 ? "Cambiar la fecha (todas)" : "Cambiar la fecha"}</span>
              <input
                type="date"
                value={scheduleDate || (firstScheduled ? limaDateOf(new Date(firstScheduled)) : "")}
                min={limaDateOf(new Date())}
                onChange={(e) => setScheduleDate(e.target.value)}
                className={cn(inputClass, "w-auto py-0.5 text-xs")}
              />
            </label>
          )}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={skipSchedule} onChange={(e) => setSkipSchedule(e.target.checked)} />
            No programar esta vez
          </label>
        </div>
      )}

      {(error ?? previewError) && <p className="text-xs text-destructive">{error ?? previewError}</p>}

      <div className="flex items-center gap-2">
        <button onClick={handleSubmit} disabled={submitting} className={cn(primaryButtonClass, "py-1.5 text-xs")}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isRequest ? "Pedir aprobación" : "Confirmar"}
          {!submitting && <Check className="h-3.5 w-3.5" />}
        </button>
        <button onClick={onCancel} className={cn(secondaryButtonClass, "py-1.5 text-xs")}>
          Todavía no
        </button>
      </div>
    </div>
  );
}
