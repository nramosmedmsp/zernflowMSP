"use client";

// Diálogo "Cerrar gestión" (docs/FASE-1-TECNICO.md 3.4 y 4.1): resultado,
// motivo, nota, fecha clave si una regla la pide y las gestiones que se
// programarán, con la fecha editable o la opción de no programar.

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { describeSkippedEffects } from "@/lib/cases/close-messages";
import { closeCase, previewCloseCase, type CaseTypeOption, type CaseView } from "@/lib/actions/cases";
import type { ClosePreview } from "@/lib/cases/close";
import { isDateString, limaDateOf } from "@/lib/cases/dates";
import { OUTCOME_LABELS } from "@/lib/cases/rules";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OutcomeKind } from "@/lib/types/database";
import { closeSelection } from "./case-card-model";
import { ErrorText, Field, Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "./ui";

const KIND_ORDER: OutcomeKind[] = ["won", "lost", "resolved"];

const KIND_STYLES: Record<OutcomeKind, string> = {
  won: "border-green-300 bg-green-50 text-green-800",
  lost: "border-red-300 bg-red-50 text-red-800",
  resolved: "border-sky-300 bg-sky-50 text-sky-800",
};

// Se monta solo mientras está abierto: cada apertura empieza con el formulario limpio.
export function CloseCaseDialog({
  caseView,
  caseType,
  initialStageId = null,
  onCancel,
  onClosed,
}: {
  caseView: CaseView;
  caseType: CaseTypeOption | null;
  /** Etapa final preseleccionada (la elegida en el menú "Cerrar"). */
  initialStageId?: string | null;
  onCancel: () => void;
  /** `problem`: la gestión se cerró pero algún efecto de las reglas no se aplicó (el aviso es de error). */
  onClosed: (message: string, problem?: boolean) => void;
}) {
  const finalStages = useMemo(
    () => (caseType?.stages ?? []).filter((s) => s.kind !== "open" && !s.archived),
    [caseType],
  );
  const kinds = useMemo<OutcomeKind[]>(
    () => (caseType ? KIND_ORDER.filter((k) => finalStages.some((s) => s.kind === k)) : ["resolved"]),
    [caseType, finalStages],
  );

  const initial = useMemo(() => closeSelection(caseType?.stages, initialStageId), [caseType, initialStageId]);
  const [kind, setKind] = useState<OutcomeKind | null>(initial?.kind ?? kinds[0] ?? null);
  const [stageId, setStageId] = useState(initial?.stageId ?? "");
  const [reasonId, setReasonId] = useState("");
  const [categoryId, setCategoryId] = useState(caseView.categoryId ?? "");
  const [note, setNote] = useState("");
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
  const noteRequired = isProtected && kind !== null && kind !== "lost";
  const isRequest = isProtected && kind === "lost" && !caseView.canSupervise;

  const stagesOfKind = finalStages.filter((s) => s.kind === kind);
  const reasonsOfKind = (caseType?.outcomeReasons ?? []).filter((r) => r.kind === kind && !r.archived);
  const categories = (caseType?.categories ?? []).filter((c) => !c.archived || c.id === caseView.categoryId);
  const showCategory = !!caseType?.requireCategory && categories.length > 0;
  const categoryOverride = showCategory && categoryId !== (caseView.categoryId ?? "") ? categoryId || null : undefined;

  // Vista previa: qué reglas se aplicarán con lo elegido.
  useEffect(() => {
    if (!kind) return;
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
    }, 250);
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

  async function handleSubmit() {
    if (!kind) return setError("Elige el resultado de la gestión.");
    if (reasonRequired && !reasonId) return setError("Elige el motivo.");
    if (showCategory && !categoryId) return setError("Elige una categoría antes de cerrar.");
    if (noteRequired && !note.trim()) return setError(`Cuenta qué se hizo antes de cerrar la ${caseType?.name ?? "gestión"}.`);
    if (preview?.askKeyDate && !isDateString(keyDate)) return setError(`Indica la fecha: ${preview.askKeyDate.label}.`);
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
        parts.push(
          `${s.rescheduled ? "Se movió" : "Se programó"} ${name} para el ${formatDate(s.scheduledFor)}.`,
        );
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

  return (
    <Modal
      open
      title={isRequest ? "Pedir cierre sin solución" : "Cerrar gestión"}
      onClose={onCancel}
      footer={
        <>
          <button onClick={onCancel} className={secondaryButtonClass}>
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={submitting || !kind} className={primaryButtonClass}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isRequest ? "Pedir aprobación" : "Cerrar gestión"}
          </button>
        </>
      }
    >
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Resultado</span>
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setStageId("");
                setReasonId("");
              }}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                kind === k ? KIND_STYLES[k] : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {OUTCOME_LABELS[k]}
            </button>
          ))}
        </div>
        {!caseType && (
          <p className="text-[11px] text-muted-foreground">
            Clasifica la gestión para cerrarla como ganada o perdida.
          </p>
        )}
      </div>

      {stagesOfKind.length > 1 && (
        <Field label="Etapa final">
          <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={inputClass}>
            {stagesOfKind.map((s, i) => (
              <option key={s.id} value={i === 0 ? "" : s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {reasonsOfKind.length > 0 && (
        <Field label={reasonRequired ? "Motivo (obligatorio)" : "Motivo"}>
          <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} className={inputClass}>
            <option value="">{reasonRequired ? "Elige un motivo" : "Sin motivo"}</option>
            {reasonsOfKind.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {showCategory && (
        <Field label="Categoría (obligatoria)">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
            <option value="">Elige una categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {isRequest && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          Un supervisor tiene que aprobar este cierre. Mientras tanto la gestión sigue abierta y le avisamos de tu pedido.
        </p>
      )}

      <Field label={noteRequired ? "Qué se hizo (obligatorio)" : isRequest ? "Nota para el supervisor" : "Nota"}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={
            noteRequired
              ? "Cuenta qué se hizo para resolverlo"
              : isRequest
                ? "Opcional: qué intentaste y por qué no se pudo resolver"
                : "Opcional: qué pasó, acuerdos, próximos pasos..."
          }
          className={cn(inputClass, "resize-none")}
        />
      </Field>

      {preview?.askKeyDate && (
        <Field label={`${preview.askKeyDate.label} (obligatoria)`}>
          <input
            type="date"
            value={keyDate}
            onChange={(e) => {
              setKeyDate(e.target.value);
              setKeyDateTouched(true);
            }}
            className={inputClass}
          />
        </Field>
      )}

      {preview?.contactType && (
        <p className="text-xs text-muted-foreground">El tipo del contacto se actualizará al cerrar.</p>
      )}

      {hadSchedules && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <CalendarClock className="h-3.5 w-3.5" />
            Se programará
          </p>
          {skipSchedule ? (
            <p className="text-xs text-muted-foreground">No se programará ninguna gestión esta vez.</p>
          ) : (
            <ul className="space-y-1">
              {schedules.map((s) => (
                <li key={s.ruleId} className="text-sm">
                  <span className="font-medium">{s.caseTypeName ?? "Gestión"}</span>
                  {" · "}
                  {s.scheduledFor ? (
                    formatDate(s.scheduledFor)
                  ) : (
                    <span className="text-amber-700">falta la fecha clave</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!skipSchedule && (
            <Field
              label={schedules.length > 1 ? "Cambiar la fecha (se aplica a todas)" : "Cambiar la fecha"}
            >
              <input
                type="date"
                value={scheduleDate || (firstScheduled ? limaDateOf(new Date(firstScheduled)) : "")}
                min={limaDateOf(new Date())}
                onChange={(e) => setScheduleDate(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={skipSchedule} onChange={(e) => setSkipSchedule(e.target.checked)} />
            No programar esta vez
          </label>
        </div>
      )}

      {(preview?.blocked ?? []).map((b) => (
        <p key={b.ruleId} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          No se programará {b.caseTypeName ?? "la gestión siguiente"}: ese tipo de gestión está archivado. Prográmala a mano.
        </p>
      ))}

      <ErrorText>{error ?? previewError}</ErrorText>
    </Modal>
  );
}
