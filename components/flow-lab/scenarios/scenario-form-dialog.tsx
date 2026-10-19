"use client";

// Diálogo para guardar un escenario nuevo (desde el laboratorio) o editar el
// nombre, la descripción y las expectativas de uno guardado. Los pasos se
// muestran pero no se editan aquí: se cambian haciendo la prueba de nuevo en el
// laboratorio.

import { useState } from "react";
import { describeSetup, describeStep } from "@/lib/flow-lab/scenarios/describe";
import type { ScenarioDefinition } from "@/lib/flow-lab/scenarios/types";
import type { LabCatalog } from "@/lib/flow-lab/types";
import { ErrorText, Field, Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/inbox/ui";
import { ExpectationsEditor } from "./expectations-editor";
import { isIncomplete } from "./scenarios-model";

export interface ScenarioDraft {
  name: string;
  description: string;
  definition: ScenarioDefinition;
}

export function ScenarioFormDialog({
  title,
  confirmLabel,
  catalog,
  initial,
  notices = [],
  onClose,
  onSave,
}: {
  title: string;
  confirmLabel: string;
  catalog: LabCatalog;
  initial: ScenarioDraft;
  /** Avisos sobre lo que no se pudo convertir (por ejemplo pasos de una prueba vieja). */
  notices?: string[];
  onClose: () => void;
  /** Devuelve el motivo si no se pudo guardar; null si se guardó (el que llama cierra el diálogo). */
  onSave: (draft: ScenarioDraft) => Promise<string | null>;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [expectations, setExpectations] = useState(initial.definition.expectations);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = initial.definition.steps;
  const incomplete = expectations.some(isIncomplete);
  const canSave = name.trim().length > 0 && !incomplete && !saving;

  async function save() {
    setSaving(true);
    setError(null);
    const failure = await onSave({ name: name.trim(), description: description.trim(), definition: { ...initial.definition, expectations } });
    setSaving(false);
    if (failure) setError(failure);
  }

  return (
    <Modal
      open
      title={title}
      onClose={saving ? () => undefined : onClose}
      className="max-w-2xl"
      footer={
        <>
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className={primaryButtonClass} onClick={save} disabled={!canSave}>
            {saving ? "Guardando…" : confirmLabel}
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input className={inputClass} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Por ejemplo: Pregunta el precio" autoFocus />
      </Field>
      <Field label="Descripción (opcional)">
        <textarea className={inputClass} rows={2} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <section className="space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Punto de partida</h4>
        <p className="text-xs">{describeSetup(initial.definition)}</p>
      </section>

      <section className="space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pasos ({steps.length})</h4>
        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay pasos: en el laboratorio, escribe como cliente o usa los controles del asesor antes de guardar.</p>
        ) : (
          <ol className="list-decimal space-y-0.5 pl-5 text-xs">
            {steps.map((s, i) => (
              <li key={i}>{describeStep(s)}</li>
            ))}
          </ol>
        )}
        {notices.map((n) => (
          <p key={n} className="text-[11px] text-amber-700 dark:text-amber-300">
            {n}
          </p>
        ))}
      </section>

      <section className="space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expectativas</h4>
        <p className="text-[11px] text-muted-foreground">Lo que debe cumplirse. Quita las que no te interesen o agrega otras; se comprueban cada vez que se corre el escenario.</p>
        <ExpectationsEditor catalog={catalog} steps={steps} expectations={expectations} onChange={setExpectations} />
      </section>

      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
