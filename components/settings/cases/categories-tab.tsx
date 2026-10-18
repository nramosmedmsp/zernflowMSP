"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { addItem, archiveItem, removeItem, reorderItems, restoreItem, updateCaseType, updateItem } from "@/lib/actions/case-config";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { OUTCOME_KINDS, OUTCOME_KIND_LABELS, moveId, type CategoryConfig, type ReasonConfig } from "./config-rules";
import {
  AddForm,
  ArchivedRow,
  KIND_BADGE,
  ListRow,
  SectionTitle,
  Switch,
  inputClass,
  type TabProps,
} from "./shared";
import type { OutcomeKind } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Pending =
  | { list: "category"; item: CategoryConfig; mode: "archive" | "delete" }
  | { list: "reason"; item: ReasonConfig; mode: "archive" | "delete" }
  | { list: "reason-kind"; item: ReasonConfig; to: OutcomeKind };

function ReasonKindSelect({ value, onChange, disabled, label }: { value: OutcomeKind; onChange: (kind: OutcomeKind) => void; disabled?: boolean; label: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as OutcomeKind)}
      disabled={disabled}
      aria-label={label}
      className={cn(inputClass, "w-28 px-2 py-1", KIND_BADGE[value])}
    >
      {OUTCOME_KINDS.map((k) => (
        <option key={k} value={k}>
          {OUTCOME_KIND_LABELS[k]}
        </option>
      ))}
    </select>
  );
}

export function CategoriesTab({ type, run, busy }: TabProps) {
  const [newReasonKind, setNewReasonKind] = useState<OutcomeKind>("lost");
  const [newHighPriority, setNewHighPriority] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const categories = [...type.categories].sort((a, b) => a.position - b.position);
  const activeCategories = categories.filter((c) => !c.archived);
  const archivedCategories = categories.filter((c) => c.archived);
  const reasons = [...type.reasons].sort((a, b) => a.position - b.position);
  const activeReasons = reasons.filter((r) => !r.archived);
  const archivedReasons = reasons.filter((r) => r.archived);

  const hasLostStage = type.stages.some((s) => !s.archived && s.kind === "lost");
  const hasWonStage = type.stages.some((s) => !s.archived && s.kind === "won");
  const reasonsKindsWithoutStage = [...new Set(activeReasons.map((r) => r.kind))].filter(
    (k) => (k === "lost" && !hasLostStage) || (k === "won" && !hasWonStage),
  );

  function pendingText(p: Pending): { title: string; message: string; confirm: string } {
    if (p.list === "reason-kind") {
      return {
        title: "Cambiar la clase del motivo",
        message: `«${p.item.name}» pasará de ${OUTCOME_KIND_LABELS[p.item.kind].toLowerCase()} a ${OUTCOME_KIND_LABELS[p.to].toLowerCase()}. Cambia cómo se cuentan las métricas desde este momento; el historial anterior no se recalcula.`,
        confirm: "Cambiar clase",
      };
    }
    const noun = p.list === "category" ? "la categoría" : "el motivo";
    return p.mode === "archive"
      ? { title: `Archivar ${noun} «${p.item.name}»`, message: "Dejará de ofrecerse, pero el historial se conserva. Puedes reactivarla cuando quieras.", confirm: "Archivar" }
      : {
          title: `Quitar ${noun} «${p.item.name}»`,
          message: "Si ya se usó en gestiones, o una regla lo menciona, se archivará en lugar de borrarse. Si nunca se usó, se borrará.",
          confirm: "Quitar",
        };
  }

  async function confirmPending() {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.list === "reason-kind") {
      await run(() => updateItem({ list: "reason", id: p.item.id, kind: p.to, confirmedKindChange: true }), `El motivo «${p.item.name}» cambió de clase.`);
    } else if (p.mode === "archive") {
      await run(() => archiveItem({ list: p.list, id: p.item.id }), `Se archivó «${p.item.name}».`);
    } else {
      await run(() => removeItem({ list: p.list, id: p.item.id }), (r) => r.message);
    }
  }

  const text = pending ? pendingText(pending) : null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionTitle title="Categorías" hint="Sirven para clasificar el tema de la gestión (por ejemplo: estado de pedido, reclamo). Las de alta prioridad suben la prioridad de la gestión." />
        <Switch
          checked={type.requireCategory}
          disabled={busy}
          onChange={(requireCategory) => run(() => updateCaseType({ id: type.id, requireCategory }))}
          label="Categoría obligatoria"
          hint="Al cerrar una gestión de este tipo, hay que haber elegido una categoría."
        />
        <ul className="space-y-1.5">
          {activeCategories.map((c, i) => (
            <ListRow
              key={`${c.id}:${c.updatedAt}`}
              name={c.name}
              nameLabel={`Nombre de la categoría ${c.name}`}
              extra={
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={c.isHighPriority}
                    disabled={busy}
                    onChange={(e) => run(() => updateItem({ list: "category", id: c.id, isHighPriority: e.target.checked }))}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  Alta prioridad
                </label>
              }
              canUp={i > 0}
              canDown={i < activeCategories.length - 1}
              onUp={() => run(() => reorderItems({ list: "category", caseTypeId: type.id, orderedIds: moveId(activeCategories.map((x) => x.id), c.id, "up") }))}
              onDown={() => run(() => reorderItems({ list: "category", caseTypeId: type.id, orderedIds: moveId(activeCategories.map((x) => x.id), c.id, "down") }))}
              onRename={(name) => run(() => updateItem({ list: "category", id: c.id, name }))}
              onArchive={() => setPending({ list: "category", item: c, mode: "archive" })}
              onRemove={() => setPending({ list: "category", item: c, mode: "delete" })}
              disabled={busy}
            />
          ))}
          {activeCategories.length === 0 && <li className="text-xs text-muted-foreground">Este tipo no tiene categorías.</li>}
        </ul>
        <AddForm
          placeholder="Nombre de la categoría nueva"
          disabled={busy}
          onAdd={(name) => run(() => addItem({ list: "category", caseTypeId: type.id, name, isHighPriority: newHighPriority }), `Categoría «${name}» agregada.`)}
          extra={
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={newHighPriority} onChange={(e) => setNewHighPriority(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
              Alta prioridad
            </label>
          }
        />
        {archivedCategories.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Archivadas</h4>
            <ul className="space-y-1.5">
              {archivedCategories.map((c) => (
                <ArchivedRow
                  key={c.id}
                  name={c.name}
                  disabled={busy}
                  onRestore={() => run(() => restoreItem({ list: "category", id: c.id }), `La categoría «${c.name}» se reactivó.`)}
                  onRemove={() => setPending({ list: "category", item: c, mode: "delete" })}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <SectionTitle title="Motivos de resultado" hint="Se eligen al cerrar la gestión: por qué se ganó, se perdió o se resolvió. La clase dice para qué tipo de cierre se ofrece." />
        <Switch
          checked={type.requireOutcomeReason}
          disabled={busy}
          onChange={(requireOutcomeReason) => run(() => updateCaseType({ id: type.id, requireOutcomeReason }))}
          label="Motivo obligatorio"
          hint="Al cerrar una gestión de este tipo, hay que elegir un motivo del resultado."
        />
        {type.requireOutcomeReason && reasonsKindsWithoutStage.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Hay motivos para un cierre que este tipo no tiene como etapa ({reasonsKindsWithoutStage.map((k) => OUTCOME_KIND_LABELS[k].toLowerCase()).join(", ")}).
          </p>
        )}
        <ul className="space-y-1.5">
          {activeReasons.map((r, i) => (
            <ListRow
              key={`${r.id}:${r.updatedAt}`}
              name={r.name}
              nameLabel={`Nombre del motivo ${r.name}`}
              extra={
                <ReasonKindSelect
                  value={r.kind}
                  disabled={busy}
                  label={`Clase del motivo ${r.name}`}
                  onChange={(to) => to !== r.kind && setPending({ list: "reason-kind", item: r, to })}
                />
              }
              canUp={i > 0}
              canDown={i < activeReasons.length - 1}
              onUp={() => run(() => reorderItems({ list: "reason", caseTypeId: type.id, orderedIds: moveId(activeReasons.map((x) => x.id), r.id, "up") }))}
              onDown={() => run(() => reorderItems({ list: "reason", caseTypeId: type.id, orderedIds: moveId(activeReasons.map((x) => x.id), r.id, "down") }))}
              onRename={(name) => run(() => updateItem({ list: "reason", id: r.id, name }))}
              onArchive={() => setPending({ list: "reason", item: r, mode: "archive" })}
              onRemove={() => setPending({ list: "reason", item: r, mode: "delete" })}
              disabled={busy}
            />
          ))}
          {activeReasons.length === 0 && <li className="text-xs text-muted-foreground">Este tipo no tiene motivos.</li>}
        </ul>
        <AddForm
          placeholder="Nombre del motivo nuevo"
          disabled={busy}
          onAdd={(name) => run(() => addItem({ list: "reason", caseTypeId: type.id, name, kind: newReasonKind }), `Motivo «${name}» agregado.`)}
          extra={<ReasonKindSelect value={newReasonKind} onChange={setNewReasonKind} disabled={busy} label="Clase del motivo nuevo" />}
        />
        {archivedReasons.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Archivados</h4>
            <ul className="space-y-1.5">
              {archivedReasons.map((r) => (
                <ArchivedRow
                  key={r.id}
                  name={r.name}
                  tag={<span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", KIND_BADGE[r.kind])}>{OUTCOME_KIND_LABELS[r.kind]}</span>}
                  disabled={busy}
                  onRestore={() => run(() => restoreItem({ list: "reason", id: r.id }), `El motivo «${r.name}» se reactivó.`)}
                  onRemove={() => setPending({ list: "reason", item: r, mode: "delete" })}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={pending !== null}
        title={text?.title ?? ""}
        message={text?.message ?? ""}
        confirmLabel={text?.confirm}
        destructive={pending !== null && pending.list !== "reason-kind" && pending.mode === "delete"}
        onCancel={() => setPending(null)}
        onConfirm={confirmPending}
      />
    </div>
  );
}
