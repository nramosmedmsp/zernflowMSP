// Evaluación del nodo Condición (contacto y gestión). Puro: lo usan el motor y
// el laboratorio de conversaciones.

import { evaluateCaseCondition, isCaseConditionField, type CaseConditionSnapshot } from "./case-conditions";
import { evaluateContactCondition, type ContactFacts, type FlowCondition } from "./condition-fields";

export interface ConditionNodeInput {
  conditions: readonly FlowCondition[];
  logic?: string;
}

/**
 * Resultado de cada condición y del nodo. Las de gestión se evalúan con
 * `caseSnapshot` (sin él se tratan como condiciones del contacto, igual que el
 * motor cuando el nodo no usa ninguna); las demás con lo que se sabe del contacto.
 */
export function evaluateConditionNode(
  data: ConditionNodeInput,
  facts: ContactFacts,
  caseSnapshot: CaseConditionSnapshot | null,
): { results: boolean[]; passed: boolean } {
  const results = data.conditions.map((condition) => {
    if (caseSnapshot && isCaseConditionField(condition.field)) {
      return evaluateCaseCondition(
        { field: condition.field, operator: condition.operator, value: condition.value },
        caseSnapshot,
      );
    }
    return evaluateContactCondition(condition, facts);
  });
  const passed = data.logic === "and" ? results.every(Boolean) : results.some(Boolean);
  return { results, passed };
}
