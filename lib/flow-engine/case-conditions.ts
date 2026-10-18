// Condiciones del nodo Condición sobre la gestión del contacto
// (docs/FASE-2-TECNICO.md 4). Puro: lo usan el motor y el simulador.

export const CASE_CONDITION_FIELDS = [
  "contact_type",
  "case_type",
  "case_stage",
  "case_team",
  "has_assignee",
  "within_hours",
] as const;

export type CaseConditionField = (typeof CASE_CONDITION_FIELDS)[number];

export const CASE_CONDITION_LABELS: Record<CaseConditionField, string> = {
  contact_type: "Tipo de contacto",
  case_type: "Tipo de gestión",
  case_stage: "Etapa de la gestión",
  case_team: "Equipo de la gestión",
  has_assignee: "Tiene responsable",
  within_hours: "Dentro de horario",
};

export function isCaseConditionField(field: string): field is CaseConditionField {
  return (CASE_CONDITION_FIELDS as readonly string[]).includes(field);
}

/** Campos cuyo valor es Sí/No. */
export function isBooleanCaseField(field: string): boolean {
  return field === "has_assignee" || field === "within_hours";
}

export interface CaseConditionSnapshot {
  contactTypeId: string | null;
  caseTypeId: string | null;
  stageId: string | null;
  teamId: string | null;
  hasAssignee: boolean;
  /** Horario efectivo del equipo de la gestión (o de la empresa), con feriados. */
  withinHours: boolean;
}

export function compareCondition(actual: string | undefined, operator: string, expected: string): boolean {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "contains":
      return actual?.includes(expected) || false;
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "gt":
      return Number(actual) > Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    default:
      return false;
  }
}

function actualValue(field: CaseConditionField, snap: CaseConditionSnapshot): string | undefined {
  switch (field) {
    case "contact_type":
      return snap.contactTypeId ?? undefined;
    case "case_type":
      return snap.caseTypeId ?? undefined;
    case "case_stage":
      return snap.stageId ?? undefined;
    case "case_team":
      return snap.teamId ?? undefined;
    case "has_assignee":
      return String(snap.hasAssignee);
    case "within_hours":
      return String(snap.withinHours);
  }
}

/**
 * Evalúa una condición de gestión. Los campos de identificador se comparan con
 * el id elegido en el panel; "tiene responsable" y "dentro de horario" con
 * "true" o "false".
 */
export function evaluateCaseCondition(
  condition: { field: CaseConditionField; operator: string; value: string },
  snapshot: CaseConditionSnapshot,
): boolean {
  return compareCondition(actualValue(condition.field, snapshot), condition.operator, condition.value);
}
