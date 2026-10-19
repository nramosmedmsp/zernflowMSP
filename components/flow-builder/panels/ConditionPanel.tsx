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
import {
  CONTACT_CONDITION_LABELS,
  newContactCondition,
  parseConditionField,
  renameConditionTarget,
  setTagPresence,
  tagCondition,
  upgradeCondition,
  type ContactConditionKind,
} from "@/lib/flow-engine/condition-fields";
import { PLATFORMS, PLATFORM_LABELS } from "@/lib/platforms";
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

// Lo que guarda el panel es lo que lee el motor: tag:<nombre>, variable:<nombre>,
// custom_field:<slug>, platform e is_subscribed (ver lib/flow-engine/condition-fields.ts).
const fieldOptions: Array<{ value: ContactConditionKind; label: string }> = (
  ["tag", "custom_field", "platform", "variable", "is_subscribed"] as const
).map((value) => ({ value, label: CONTACT_CONDITION_LABELS[value] }));

const nameLabels: Record<"tag" | "variable" | "custom_field", { label: string; placeholder: string }> = {
  tag: { label: "Nombre de la etiqueta", placeholder: "Ej. VIP" },
  variable: { label: "Nombre de la variable", placeholder: "Ej. message" },
  custom_field: { label: "Campo personalizado (slug)", placeholder: "Ej. numero_pedido" },
};

const selectClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

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
  // Las condiciones guardadas con el formato antiguo se muestran (y se guardan al editarlas) en el actual.
  const conditions = (data.conditions || []).map((c) => upgradeCondition(c, isCaseConditionField));
  const logic = data.logic || "and";

  const addCondition = useCallback(() => {
    onChange({
      ...data,
      conditions: [...conditions, newContactCondition("tag")],
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
        {conditions.map((condition, index) => {
          const isCase = isCaseConditionField(condition.field);
          const contactKind = parseConditionField(condition).kind;
          const target = parseConditionField(condition).name;
          return (
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
                  value={isCaseConditionField(condition.field) ? condition.field : contactKind}
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
                      updateCondition(index, newContactCondition(field as ContactConditionKind));
                    }
                  }}
                  className={selectClass}
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

                {/* Nombre de la etiqueta, variable o campo */}
                {!isCase && (contactKind === "tag" || contactKind === "variable" || contactKind === "custom_field") && (
                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">{nameLabels[contactKind].label}</label>
                    <input
                      type="text"
                      value={target}
                      onChange={(e) => updateCondition(index, renameConditionTarget(condition, e.target.value))}
                      placeholder={nameLabels[contactKind].placeholder}
                      className={inputClass}
                    />
                  </div>
                )}

                {/* Etiqueta: tiene o no tiene */}
                {!isCase && contactKind === "tag" && (
                  <select
                    value={tagCondition(condition).has ? "true" : "false"}
                    onChange={(e) => updateCondition(index, setTagPresence(condition, e.target.value === "true"))}
                    className={selectClass}
                  >
                    <option value="true">El contacto tiene la etiqueta</option>
                    <option value="false">El contacto no tiene la etiqueta</option>
                  </select>
                )}

                {/* Suscripción: Sí / No */}
                {!isCase && contactKind === "is_subscribed" && (
                  <select
                    value={condition.value === "false" ? "false" : "true"}
                    onChange={(e) => updateCondition(index, { ...condition, operator: "equals", value: e.target.value })}
                    className={selectClass}
                  >
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                )}

                {/* Operator */}
                {(isCase || (contactKind !== "tag" && contactKind !== "is_subscribed")) && (
                  <select
                    value={condition.operator}
                    onChange={(e) =>
                      updateCondition(index, { ...condition, operator: e.target.value })
                    }
                    className={selectClass}
                  >
                    {(isCase ? caseOperatorOptions : operatorOptions).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}

                {/* Plataforma: lista de plataformas */}
                {!isCase && contactKind === "platform" && (
                  <select
                    value={condition.value}
                    onChange={(e) => updateCondition(index, { ...condition, value: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">Selecciona...</option>
                    {PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_LABELS[p]}
                      </option>
                    ))}
                  </select>
                )}

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
                {!isCase &&
                  (contactKind === "variable" || contactKind === "custom_field") &&
                  condition.operator !== "exists" && (
                    <input
                      type="text"
                      value={condition.value}
                      onChange={(e) =>
                        updateCondition(index, { ...condition, value: e.target.value })
                      }
                      placeholder="Valor..."
                      className={inputClass}
                    />
                  )}
                {!isCase && contactKind === "variable" && target === "message" && (
                  <p className="text-[11px] text-muted-foreground">
                    La variable message es el último mensaje del cliente. Los textos se comparan sin mayúsculas ni tildes.
                  </p>
                )}
              </div>
            </div>
          </div>
          );
        })}
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
