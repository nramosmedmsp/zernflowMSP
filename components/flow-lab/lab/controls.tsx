"use client";

// Controles bajo el teléfono: paso del tiempo y acciones del asesor.

import { useMemo, useState, type ReactNode } from "react";
import { Clock, Pause, Play, Send, XCircle } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";
import { previewClose } from "@/lib/flow-lab";
import { currentCase } from "@/lib/flow-lab/state";
import type { CloseCaseInput, LabCatalog, LabState } from "@/lib/flow-lab/types";
import { Field, Modal, inputClass, primaryButtonClass, secondaryButtonClass, selectClass } from "@/components/inbox/ui";
import { formatMinutes } from "./lab-model";

export type AgentAction =
  | { type: "advance"; minutes: number }
  | { type: "reply"; text: string; agentId: string | null }
  | { type: "stage"; stageId: string }
  | { type: "classify"; caseTypeId: string }
  | { type: "category"; categoryId: string | null }
  | { type: "assign"; memberId: string | null }
  | { type: "close"; input: CloseCaseInput }
  | { type: "pause"; paused: boolean };

const QUICK_MINUTES = [
  { label: "+15 min", minutes: 15 },
  { label: "+2 h", minutes: 120 },
  { label: "+24 h", minutes: 24 * 60 },
  { label: "+7 días", minutes: 7 * 24 * 60 },
];

const UNIT_MINUTES = { min: 1, h: 60, dias: 1440 } as const;

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function Controls({
  catalog,
  state,
  busy,
  error,
  onAction,
}: {
  catalog: LabCatalog;
  state: LabState;
  busy: boolean;
  error: string | null;
  onAction: (action: AgentAction) => void;
}) {
  const [amount, setAmount] = useState("30");
  const [unit, setUnit] = useState<keyof typeof UNIT_MINUTES>("min");
  const [agentId, setAgentId] = useState<string>("");
  const [reply, setReply] = useState("");
  const [closing, setClosing] = useState(false);

  const row = currentCase(state);
  const isOpen = row?.status === "open";
  const caseType = row?.caseTypeId ? catalog.caseTypes.find((t) => t.id === row.caseTypeId) : undefined;
  const openStages = caseType?.stages.filter((s) => s.kind === "open") ?? [];
  const customMinutes = Math.round(Number(amount.replace(",", ".")) * UNIT_MINUTES[unit]);
  const validCustom = Number.isFinite(customMinutes) && customMinutes > 0;

  return (
    <div className="space-y-3">
      <Block title="Tiempo">
        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_MINUTES.map((q) => (
            <button key={q.minutes} type="button" disabled={busy} onClick={() => onAction({ type: "advance", minutes: q.minutes })} className={secondaryButtonClass}>
              <Clock className="h-3.5 w-3.5" />
              {q.label}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (validCustom) onAction({ type: "advance", minutes: customMinutes });
          }}
        >
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Cantidad de tiempo" className={`${inputClass} w-24`} />
          <select value={unit} onChange={(e) => setUnit(e.target.value as keyof typeof UNIT_MINUTES)} aria-label="Unidad" className={selectClass}>
            <option value="min">minutos</option>
            <option value="h">horas</option>
            <option value="dias">días</option>
          </select>
          <button type="submit" disabled={busy || !validCustom} className={primaryButtonClass}>
            Avanzar{validCustom ? ` ${formatMinutes(customMinutes)}` : ""}
          </button>
        </form>
      </Block>

      <Block title="Asesor">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Quién responde" className={selectClass}>
              <option value="">Asesor sin nombre</option>
              {catalog.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted-foreground">Al responder, el bot se pausa.</span>
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reply.trim()) return;
              onAction({ type: "reply", text: reply.trim(), agentId: agentId || null });
              setReply("");
            }}
          >
            <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Responder a mano…" aria-label="Respuesta del asesor" className={inputClass} />
            <button type="submit" disabled={busy || !reply.trim()} className={primaryButtonClass} aria-label="Enviar respuesta del asesor">
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Etapa">
            <select
              className={`${selectClass} w-full`}
              disabled={busy || !isOpen || openStages.length === 0}
              value={row?.stageId ?? ""}
              onChange={(e) => e.target.value && onAction({ type: "stage", stageId: e.target.value })}
            >
              {!openStages.some((s) => s.id === row?.stageId) && <option value="">{isOpen ? "Elige una etapa" : "Sin gestión abierta"}</option>}
              {openStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Clasificar como">
            <select
              className={`${selectClass} w-full`}
              disabled={busy || !isOpen}
              value={row?.caseTypeId ?? ""}
              onChange={(e) => e.target.value && onAction({ type: "classify", caseTypeId: e.target.value })}
            >
              {!row?.caseTypeId && <option value="">Sin clasificar</option>}
              {catalog.caseTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoría">
            <select
              className={`${selectClass} w-full`}
              disabled={busy || !isOpen || !caseType || caseType.categories.length === 0}
              value={row?.categoryId ?? ""}
              onChange={(e) => onAction({ type: "category", categoryId: e.target.value || null })}
            >
              <option value="">Sin categoría</option>
              {caseType?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Responsable">
            <select
              className={`${selectClass} w-full`}
              disabled={busy || !isOpen}
              value={row?.assigneeId ?? ""}
              onChange={(e) => onAction({ type: "assign", memberId: e.target.value || null })}
            >
              <option value="">En cola (nadie)</option>
              {catalog.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={busy || !isOpen} onClick={() => setClosing(true)} className={secondaryButtonClass}>
            <XCircle className="h-3.5 w-3.5" />
            Cerrar gestión…
          </button>
          <button type="button" disabled={busy} onClick={() => onAction({ type: "pause", paused: !state.automationPaused })} className={secondaryButtonClass}>
            {state.automationPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {state.automationPaused ? "Reanudar el bot" : "Pausar el bot"}
          </button>
        </div>
        {state.automationPaused && <p className="text-[11px] text-muted-foreground">Reanudar a mano es solo del laboratorio: en el CRM real el bot se reanuda al cerrar la gestión.</p>}
      </Block>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {closing && row && caseType && (
        <CloseDialog
          catalog={catalog}
          state={state}
          caseId={row.id}
          onClose={() => setClosing(false)}
          onConfirm={(input) => {
            setClosing(false);
            onAction({ type: "close", input });
          }}
        />
      )}
    </div>
  );
}

const KIND_LABEL = { won: "Ganada", lost: "Perdida", resolved: "Resuelta" } as const;

function CloseDialog({
  catalog,
  state,
  caseId,
  onClose,
  onConfirm,
}: {
  catalog: LabCatalog;
  state: LabState;
  caseId: string;
  onClose: () => void;
  onConfirm: (input: CloseCaseInput) => void;
}) {
  const row = state.cases.find((c) => c.id === caseId)!;
  const caseType = catalog.caseTypes.find((t) => t.id === row.caseTypeId)!;
  const finalStages = caseType.stages.filter((s) => s.kind !== "open");
  const [stageId, setStageId] = useState<string>(finalStages[0]?.id ?? "");
  const [reasonId, setReasonId] = useState("");
  const [categoryId, setCategoryId] = useState<string>(row.categoryId ?? "");
  const [keyDate, setKeyDate] = useState(state.contact.keyDate ?? "");
  const [note, setNote] = useState("");
  const [skip, setSkip] = useState(false);

  const stage = finalStages.find((s) => s.id === stageId);
  const reasons = caseType.reasons.filter((r) => !stage || r.kind === stage.kind);

  const input: CloseCaseInput = useMemo(
    () => ({
      caseId,
      stageId: stageId || undefined,
      outcomeReasonId: reasonId || null,
      categoryId: categoryId || null,
      keyDate: keyDate || null,
      note: note.trim() || null,
      scheduleOverride: skip ? { skip: true } : undefined,
    }),
    [caseId, stageId, reasonId, categoryId, keyDate, note, skip],
  );
  const preview = useMemo(() => previewClose(catalog, state, input), [catalog, state, input]);
  const ok = "ok" in preview ? preview.preview : null;

  return (
    <Modal
      open
      title="Cerrar la gestión"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={primaryButtonClass} disabled={!ok} onClick={() => onConfirm(input)}>
            Cerrar gestión
          </button>
        </>
      }
    >
      {finalStages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este tipo de gestión no tiene etapas de cierre.</p>
      ) : (
        <>
          <Field label="Resultado (etapa de cierre)">
            <select
              className={`${inputClass}`}
              value={stageId}
              onChange={(e) => {
                setStageId(e.target.value);
                setReasonId("");
              }}
            >
              {finalStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.kind === "open" ? "" : KIND_LABEL[s.kind]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Motivo${caseType.requireOutcomeReason ? " (obligatorio)" : ""}`}>
            <select className={inputClass} value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
              <option value="">Sin motivo</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Categoría${caseType.requireCategory ? " (obligatoria)" : ""}`}>
            <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {caseType.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {ok?.askKeyDate && (
            <Field label={ok.askKeyDate.label} hint="Una regla de este tipo la usa para programar la próxima gestión.">
              <input type="date" className={inputClass} value={keyDate} onChange={(e) => setKeyDate(e.target.value)} />
            </Field>
          )}
          <Field label="Nota interna (opcional)">
            <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <p className="font-semibold">Qué pasará al cerrar</p>
            {"error" in preview && <p className="text-destructive">{preview.error}</p>}
            {ok && (
              <>
                <p>Resultado: {KIND_LABEL[ok.kind]}.</p>
                {ok.contactType && (
                  <p>
                    El contacto pasa a «{catalog.contactTypes.find((t) => t.id === ok.contactType?.to)?.name ?? "otro tipo"}».
                  </p>
                )}
                {ok.schedules.length === 0 && <p className="text-muted-foreground">No se programa ninguna gestión.</p>}
                {ok.schedules.map((s, i) => (
                  <p key={i}>
                    Se programa «{s.caseTypeName}»:{" "}
                    {s.missingKeyDate ? <span className="text-amber-700 dark:text-amber-300">falta la fecha clave, no se podrá programar.</span> : s.scheduledFor ? <strong>{formatDate(s.scheduledFor)}</strong> : "sin fecha"}
                    {s.scheduledFor && !s.missingKeyDate && <span className="text-muted-foreground"> ({formatDateTime(s.scheduledFor)})</span>}
                  </p>
                ))}
                {(ok.schedules.length > 0 || skip) && (
                  <label className="flex items-center gap-1.5 pt-1">
                    <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
                    No programar la próxima gestión
                  </label>
                )}
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
