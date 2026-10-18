"use client";

import { useCallback } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CASE_CONDITION_FIELDS,
  CASE_CONDITION_LABELS,
  isBooleanCaseField,
  isCaseConditionField,
  type CaseConditionField,
} from "@/lib/flow-engine/case-conditions";
import { useCaseCatalog, type CaseCatalog } from "./use-case-catalog";

interface Condition {
  field: string;
  operator: string;
  value: string;
}

interface ConditionPanelData {
  conditions?: Condition[];
  logic?: "and" | "or";
  [key: string]: unknown;
}

interface ConditionPanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

const fieldOptions = [
  { value: "tag", label: "Etiqueta" },
  { value: "custom_field", label: "Campo personalizado" },
  { value: "platform", label: "Plataforma" },
  { value: "variable", label: "Variable" },
  { value: "is_subscribed", label: "Está suscrito" },
  { value: "last_interaction", label: "Última interacción" },
];

// Condiciones de gestión (fase 2): se comparan con el id elegido o con Sí/No.
const caseFieldOptions = CASE_CONDITION_FIELDS.map((f) => ({ value: f, label: CASE_CONDITION_LABELS[f] }));
const caseOperatorOptions = [
  { value: "equals", label: "es igual a" },
  { value: "not_equals", label: "no es igual a" },
];

/** Opciones del valor de una condición de gestión (ids para tipos, etapas y equipos; Sí/No para el resto). */
function caseValueOptions(field: CaseConditionField, catalog: CaseCatalog): Array<{ value: string; label: string }> {
  switch (field) {
    case "contact_type":
      return catalog.contactTypes.map((t) => ({ value: t.id, label: t.name }));
    case "case_type":
      return catalog.caseTypes.map((t) => ({ value: t.id, label: t.name }));
    case "case_stage":
      return catalog.caseTypes.flatMap((t) => t.stages.map((s) => ({ value: s.id, label: `${t.name} > ${s.name}` })));
    case "case_team":
      return catalog.teams.map((t) => ({ value: t.id, label: t.name }));
    case "has_assignee":
    case "within_hours":
      return [
        { value: "true", label: "Sí" },
        { value: "false", label: "No" },
      ];
  }
}

const operatorOptions = [
  { value: "equals", label: "es igual a" },
  { value: "not_equals", label: "no es igual a" },
  { value: "contains", label: "contiene" },
  { value: "exists", label: "existe" },
  { value: "gt", label: "es mayor que" },
  { value: "lt", label: "es menor que" },
];

export function ConditionPanel({ data: rawData, onChange }: ConditionPanelProps) {
  const data = rawData as ConditionPanelData;
  const catalog = useCaseCatalog();
  const conditions = data.conditions || [];
  const logic = data.logic || "and";

  const addCondition = useCallback(() => {
    onChange({
      ...data,
      conditions: [...conditions, { field: "tag", operator: "equals", value: "" }],
    });
  }, [data, conditions, onChange]);

  const updateCondition = useCallback(
    (index: number, updated: Condition) => {
      const updated_conditions = [...conditions];
      updated_conditions[index] = updated;
      onChange({ ...data, conditions: updated_conditions });
    },
    [data, conditions, onChange]
  );

  const removeCondition = useCallback(
    (index: number) => {
      onChange({ ...data, conditions: conditions.filter((_, i) => i !== index) });
    },
    [data, conditions, onChange]
  );

  const toggleLogic = useCallback(() => {
    onChange({ ...data, logic: logic === "and" ? "or" : "and" });
  }, [data, logic, onChange]);

  return (
    <div className="space-y-4">
      {/* Logic Toggle */}
      {conditions.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Cumplir</span>
          <button
            type="button"
            onClick={toggleLogic}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              logic === "and"
                ? "bg-amber-100 text-amber-700"
                : "bg-blue-100 text-blue-700"
            )}
          >
            {logic === "and" ? "TODAS" : "ALGUNA"}
          </button>
          <span className="text-xs text-muted-foreground">de las condiciones</span>
        </div>
      )}

      {/* Conditions List */}
      <div className="space-y-3">
        {conditions.map((condition, index) => (
          <div key={index}>
            {index > 0 && (
              <div className="my-2 flex items-center justify-center">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                    logic === "and"
                      ? "bg-amber-100 text-amber-600"
                      : "bg-blue-100 text-blue-600"
                  )}
                >
                  {logic === "and" ? "y" : "o"}
                </span>
              </div>
            )}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Condición {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeCondition(index)}
                  aria-label="Quitar condición"
                  title="Quitar condición"
                  className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              {/* Field */}
              <div className="space-y-2">
                <select
                  value={condition.field}
                  onChange={(e) => {
                    const field = e.target.value;
                    // Al pasar a un campo de gestión el valor es un id o Sí/No, y el operador solo igual / no igual.
                    if (isCaseConditionField(field)) {
                      updateCondition(index, {
                        field,
                        operator: condition.operator === "not_equals" ? "not_equals" : "equals",
                        value: isBooleanCaseField(field) ? "true" : "",
                      });
                    } else {
                      updateCondition(index, { ...condition, field });
                    }
                  }}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  {fieldOptions.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                  <optgroup label="Gestión">
                    {caseFieldOptions.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                </select>

                {/* Operator */}
                <select
                  value={condition.operator}
                  onChange={(e) =>
                    updateCondition(index, { ...condition, operator: e.target.value })
                  }
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  {(isCaseConditionField(condition.field) ? caseOperatorOptions : operatorOptions).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>

                {isCaseConditionField(condition.field) && (
                  <>
                    <select
                      value={condition.value}
                      onChange={(e) => updateCondition(index, { ...condition, value: e.target.value })}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      {!isBooleanCaseField(condition.field) && <option value="">Selecciona...</option>}
                      {caseValueOptions(condition.field, catalog).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {condition.field === "within_hours" && (
                      <p className="text-[11px] text-muted-foreground">
                        Usa el horario del equipo de la gestión, o el de la empresa si no tiene, con sus feriados.
                      </p>
                    )}
                    {condition.field === "has_assignee" && (
                      <p className="text-[11px] text-muted-foreground">
                        Mira la gestión abierta del contacto (o la del evento que disparó el flujo).
                      </p>
                    )}
                  </>
                )}

                {/* Value (hidden for "exists" operator) */}
                {!isCaseConditionField(condition.field) && condition.operator !== "exists" && (
                  <input
                    type="text"
                    value={condition.value}
                    onChange={(e) =>
                      updateCondition(index, { ...condition, value: e.target.value })
                    }
                    placeholder="Valor..."
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Condition */}
      <button
        type="button"
        onClick={addCondition}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-amber-400 hover:text-amber-500"
      >
        <Plus className="h-4 w-4" />
        Agregar condición
      </button>

      {conditions.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Agrega condiciones para crear una bifurcación. Los contactos que cumplan las condiciones van por la rama &ldquo;Sí&rdquo; y los demás por &ldquo;No&rdquo;.
        </p>
      )}
    </div>
  );
}
