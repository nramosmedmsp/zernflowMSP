"use client";

// Editor de las expectativas de un escenario: una fila por expectativa con su
// momento (al final o tras un paso) y sus datos. Los nombres se escriben (con
// sugerencias del espacio) porque el escenario los guarda por nombre.

import { useId, useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { describeExpectation } from "@/lib/flow-lab/scenarios/describe";
import { EXPECTATION_KINDS, type ExpectationKind, type ScenarioExpectation, type ScenarioStep } from "@/lib/flow-lab/scenarios/types";
import { newExpectationId } from "@/lib/flow-lab/scenarios/validate";
import type { LabCatalog } from "@/lib/flow-lab/types";
import { inputClass, secondaryButtonClass, selectClass } from "@/components/inbox/ui";
import { KIND_LABELS, defaultCheck, fieldsFor, isIncomplete, stepLabel, suggestionsFor, type FieldSpec, type Suggestions } from "./scenarios-model";

function FieldControl({
  spec,
  value,
  suggestions,
  listId,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  suggestions: Suggestions;
  listId: string;
  onChange: (value: unknown) => void;
}) {
  const label = <span className="text-[11px] text-muted-foreground">{spec.label}</span>;
  switch (spec.type) {
    case "text": {
      const options = spec.suggest ? suggestions[spec.suggest] : [];
      return (
        <label className="flex min-w-[140px] flex-1 flex-col gap-0.5">
          {label}
          <input
            className={inputClass}
            value={typeof value === "string" ? value : ""}
            list={options.length > 0 ? `${listId}-${spec.suggest}` : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
    }
    case "number":
      return (
        <label className="flex w-28 flex-col gap-0.5">
          {label}
          <input className={inputClass} type="number" min={0} step={1} value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} />
        </label>
      );
    case "select":
      return (
        <label className="flex flex-col gap-0.5">
          {label}
          <select className={`${selectClass} py-2`} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)}>
            {spec.optional && <option value="">(sin indicar)</option>}
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "bool":
      return (
        <label className="flex flex-col gap-0.5">
          {label}
          <select className={`${selectClass} py-2`} value={value === false ? "no" : "yes"} onChange={(e) => onChange(e.target.value === "yes")}>
            <option value="yes">{spec.yes}</option>
            <option value="no">{spec.no}</option>
          </select>
        </label>
      );
  }
}

export function ExpectationsEditor({
  catalog,
  steps,
  expectations,
  onChange,
}: {
  catalog: LabCatalog;
  steps: readonly ScenarioStep[];
  expectations: ScenarioExpectation[];
  onChange: (next: ScenarioExpectation[]) => void;
}) {
  const baseId = useId();
  const suggestions = useMemo(() => suggestionsFor(catalog), [catalog]);

  function replace(index: number, next: ScenarioExpectation) {
    onChange(expectations.map((e, i) => (i === index ? next : e)));
  }

  function changeKind(index: number, kind: ExpectationKind) {
    const current = expectations[index];
    replace(index, { id: current.id, after: current.after ?? null, ...defaultCheck(kind) });
  }

  function setField(index: number, key: string, value: unknown) {
    const next = { ...expectations[index] } as Record<string, unknown>;
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    replace(index, next as unknown as ScenarioExpectation);
  }

  function add() {
    onChange([...expectations, { id: newExpectationId(expectations), after: null, ...defaultCheck("bot_message_contains") }]);
  }

  return (
    <div className="space-y-2">
      {Object.entries(suggestions).map(([key, list]) => (
        <datalist key={key} id={`${baseId}-${key}`}>
          {list.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ))}

      {expectations.length === 0 && <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">Sin expectativas: el escenario solo comprobará que todos los pasos se puedan aplicar.</p>}

      {expectations.map((e, i) => (
        <div key={e.id} className="space-y-2 rounded-lg border border-border bg-background p-2.5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">Qué se comprueba</span>
              <select className={`${selectClass} py-2`} value={e.kind} onChange={(ev) => changeKind(i, ev.target.value as ExpectationKind)}>
                {EXPECTATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[160px] max-w-[260px] flex-1 flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">Cuándo</span>
              <select className={`${selectClass} py-2`} value={e.after == null ? "" : String(e.after)} onChange={(ev) => replace(i, { ...e, after: ev.target.value === "" ? null : Number(ev.target.value) })}>
                <option value="">Al final</option>
                {steps.map((_, n) => (
                  <option key={n} value={n + 1}>
                    Después de: {stepLabel(steps, n + 1).slice(0, 70)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => onChange(expectations.filter((_, j) => j !== i))} className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-destructive" aria-label="Quitar expectativa" title="Quitar">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {fieldsFor(e.kind).length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              {fieldsFor(e.kind).map((spec) => (
                <FieldControl key={spec.key} spec={spec} value={(e as unknown as Record<string, unknown>)[spec.key]} suggestions={suggestions} listId={baseId} onChange={(v) => setField(i, spec.key, v)} />
              ))}
            </div>
          )}
          <p className={`text-[11px] ${isIncomplete(e) ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{isIncomplete(e) ? "Completa los datos para poder guardarla." : describeExpectation(e)}</p>
        </div>
      ))}

      <button type="button" onClick={add} className={secondaryButtonClass}>
        <Plus className="h-3.5 w-3.5" />
        Agregar expectativa
      </button>
    </div>
  );
}
