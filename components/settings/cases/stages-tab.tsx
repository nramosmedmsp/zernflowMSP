"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { addItem, archiveItem, getStageUsage, removeItem, reorderItems, restoreItem, updateItem } from "@/lib/actions/case-config";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  STAGE_KINDS,
  STAGE_KIND_LABELS,
  moveId,
  stageKindChangeMessage,
  type StageConfig,
} from "./config-rules";
import {
  AddForm,
  ArchivedRow,
  ColorPicker,
  KIND_BADGE,
  ListRow,
  Modal,
  SectionTitle,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  type TabProps,
} from "./shared";
import type { StageKind } from "@/lib/types/database";
import { cn } from "@/lib/utils";

interface Removal {
  stage: StageConfig;
  /** "archive" = solo archivar; "delete" = borrar si no tiene uso, si no archivar. */
  mode: "archive" | "delete";
  openCases: number;
  closedCases: number;
  rules: number;
}

interface KindChange {
  stage: StageConfig;
  to: StageKind;
  openCases: number;
}

function KindSelect({ value, onChange, disabled, label }: { value: StageKind; onChange: (kind: StageKind) => void; disabled?: boolean; label: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as StageKind)}
      disabled={disabled}
      aria-label={label}
      className={cn(inputClass, "w-32 px-2 py-1", KIND_BADGE[value])}
    >
      {STAGE_KINDS.map((k) => (
        <option key={k} value={k}>
          {STAGE_KIND_LABELS[k]}
        </option>
      ))}
    </select>
  );
}

export function StagesTab({ type, run, busy, notify }: TabProps) {
  const [newKind, setNewKind] = useState<StageKind>("open");
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [kindChange, setKindChange] = useState<KindChange | null>(null);

  const sorted = [...type.stages].sort((a, b) => a.position - b.position);
  const active = sorted.filter((s) => !s.archived);
  const archived = sorted.filter((s) => s.archived);
  const activeIds = active.map((s) => s.id);
  const hasOpen = active.some((s) => s.kind === "open");
  const hasClosing = active.some((s) => s.kind !== "open");
  const targets = removal ? active.filter((s) => s.kind === "open" && s.id !== removal.stage.id) : [];

  function reorder(id: string, direction: "up" | "down") {
    run(() => reorderItems({ list: "stage", caseTypeId: type.id, orderedIds: moveId(activeIds, id, direction) }));
  }

  async function startRemoval(stage: StageConfig, mode: "archive" | "delete") {
    const res = await getStageUsage(stage.id);
    if ("error" in res) {
      notify({ kind: "error", text: res.error });
      return;
    }
    if (res.usage.isLastOpen && !stage.archived) {
      notify({ kind: "error", text: "Debe quedar al menos una etapa abierta activa en cada tipo de gestión. Agrega otra antes de quitar esta." });
      return;
    }
    setMoveTo(active.find((s) => s.kind === "open" && s.id !== stage.id)?.id ?? "");
    setRemoval({ stage, mode, openCases: res.usage.openCases, closedCases: res.usage.closedCases, rules: res.usage.rules });
  }

  async function startKindChange(stage: StageConfig, to: StageKind) {
    if (to === stage.kind) return;
    const res = await getStageUsage(stage.id);
    if ("error" in res) {
      notify({ kind: "error", text: res.error });
      return;
    }
    if (res.usage.isLastOpen && stage.kind === "open" && !stage.archived) {
      notify({ kind: "error", text: "Debe quedar al menos una etapa abierta activa en cada tipo de gestión. Agrega otra antes de cambiar la clase de esta." });
      return;
    }
    setKindChange({ stage, to, openCases: res.usage.openCases });
  }

  async function confirmRemoval() {
    if (!removal) return;
    const { stage, mode, openCases } = removal;
    const moveToStageId = openCases > 0 ? moveTo : null;
    setRemoval(null);
    if (mode === "archive") {
      await run(
        () => archiveItem({ list: "stage", id: stage.id, moveToStageId }),
        (r) => (r.moved > 0 ? `La etapa «${stage.name}» se archivó y ${r.moved} ${r.moved === 1 ? "gestión se movió" : "gestiones se movieron"}.` : `La etapa «${stage.name}» se archivó.`),
      );
    } else {
      await run(
        () => removeItem({ list: "stage", id: stage.id, moveToStageId }),
        (r) => (r.moved > 0 ? `${r.message} ${r.moved} ${r.moved === 1 ? "gestión se movió" : "gestiones se movieron"}.` : r.message),
      );
    }
  }

  const removalText = removal
    ? removal.mode === "archive"
      ? "Dejará de ofrecerse, pero el historial y las métricas pasadas se conservan. Puedes reactivarla cuando quieras."
      : removal.closedCases > 0
        ? "Tiene historial (gestiones que pasaron por ella), así que se archivará en lugar de borrarse. Puedes reactivarla cuando quieras."
        : `Si nunca se usó, se borrará de verdad.${removal.rules > 0 ? ` También se ${removal.rules === 1 ? "borrará la regla que empieza" : `borrarán las ${removal.rules} reglas que empiezan`} en ella.` : ""}`
    : "";

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Etapas"
        hint="Cada gestión avanza por las etapas abiertas y termina en una de cierre: ganada, perdida o resuelta."
      />

      {!hasOpen && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Este tipo no tiene ninguna etapa abierta activa. Agrega una para poder abrir gestiones.
        </p>
      )}
      {hasOpen && !hasClosing && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          No hay ninguna etapa de cierre (ganada, perdida o resuelta): las gestiones de este tipo no se podrían cerrar.
        </p>
      )}

      <ul className="space-y-1.5">
        {active.map((s, i) => (
          <ListRow
            key={`${s.id}:${s.updatedAt}`}
            name={s.name}
            nameLabel={`Nombre de la etapa ${s.name}`}
            lead={
              <ColorPicker
                value={s.color}
                disabled={busy}
                label={`Color de ${s.name}`}
                onChange={(color) => run(() => updateItem({ list: "stage", id: s.id, color }))}
              />
            }
            extra={
              <KindSelect
                value={s.kind}
                disabled={busy}
                label={`Clase de ${s.name}`}
                onChange={(kind) => startKindChange(s, kind)}
              />
            }
            canUp={i > 0}
            canDown={i < active.length - 1}
            onUp={() => reorder(s.id, "up")}
            onDown={() => reorder(s.id, "down")}
            onRename={(name) => run(() => updateItem({ list: "stage", id: s.id, name }))}
            onArchive={() => startRemoval(s, "archive")}
            onRemove={() => startRemoval(s, "delete")}
            disabled={busy}
          />
        ))}
        {active.length === 0 && <li className="text-xs text-muted-foreground">Sin etapas activas.</li>}
      </ul>

      <AddForm
        placeholder="Nombre de la etapa nueva"
        disabled={busy}
        onAdd={(name) => run(() => addItem({ list: "stage", caseTypeId: type.id, name, kind: newKind }), `Etapa «${name}» agregada.`)}
        extra={<KindSelect value={newKind} onChange={setNewKind} disabled={busy} label="Clase de la etapa nueva" />}
      />

      {archived.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Archivadas</h4>
          <ul className="space-y-1.5">
            {archived.map((s) => (
              <ArchivedRow
                key={s.id}
                name={s.name}
                tag={<span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", KIND_BADGE[s.kind])}>{STAGE_KIND_LABELS[s.kind]}</span>}
                disabled={busy}
                onRestore={() => run(() => restoreItem({ list: "stage", id: s.id }), `La etapa «${s.name}» se reactivó.`)}
                onRemove={() => startRemoval(s, "delete")}
              />
            ))}
          </ul>
        </div>
      )}

      <Modal open={removal !== null} title={removal ? `${removal.mode === "archive" ? "Archivar" : "Quitar"} la etapa «${removal.stage.name}»` : ""} onClose={() => setRemoval(null)}>
        {removal && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{removalText}</p>
            {removal.openCases > 0 && (
              <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="text-xs">
                  Hay {removal.openCases} {removal.openCases === 1 ? "gestión abierta o programada" : "gestiones abiertas o programadas"} en esta etapa. Elige a qué etapa moverlas antes de quitarla.
                </p>
                <select
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                  aria-label="Mover las gestiones a la etapa"
                  className={cn(inputClass, "w-full text-foreground")}
                >
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className={secondaryButtonClass} onClick={() => setRemoval(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className={primaryButtonClass}
                disabled={busy || (removal.openCases > 0 && moveTo === "")}
                onClick={confirmRemoval}
              >
                {removal.openCases > 0 ? "Mover y continuar" : removal.mode === "archive" ? "Archivar" : "Quitar"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={kindChange !== null}
        title="Cambiar la clase de la etapa"
        message={kindChange ? stageKindChangeMessage({ name: kindChange.stage.name, from: kindChange.stage.kind, to: kindChange.to, openCases: kindChange.openCases }) : ""}
        confirmLabel="Cambiar clase"
        onCancel={() => setKindChange(null)}
        onConfirm={async () => {
          const change = kindChange;
          setKindChange(null);
          if (change) {
            await run(
              () => updateItem({ list: "stage", id: change.stage.id, kind: change.to, confirmedKindChange: true }),
              `La etapa «${change.stage.name}» ahora es ${STAGE_KIND_LABELS[change.to].toLowerCase()}.`,
            );
          }
        }}
      />
    </div>
  );
}
