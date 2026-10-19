// Campos del nodo Condición sobre el contacto y la conversación (los de gestión
// están en case-conditions.ts). Puro: lo usan el panel del lienzo, el motor y
// el simulador, así lo que guarda el panel es exactamente lo que lee el motor.
//
// Formato de `field` que guarda el panel y lee el motor:
//   platform              plataforma del canal
//   is_subscribed         "true" / "false"
//   tag:<nombre>          "true" si el contacto tiene la etiqueta
//   variable:<nombre>     variable del flujo ({{nombre}}; admite rutas con puntos)
//   custom_field:<slug>   campo personalizado del contacto
//
// Formato antiguo (flujos guardados con versiones anteriores del panel), que el
// motor sigue aceptando:
//   tag / has_tag         sin nombre: el nombre de la etiqueta estaba en `value`
//   <slug>                el slug del campo personalizado sin prefijo
//   variable / custom_field sin nombre: no se guardó a cuál se refería, así que
//                         no se pueden evaluar (el valor queda vacío).

import { compareCondition } from "./case-conditions";
import { resolveVariablePath } from "./interpolate";

export interface FlowCondition {
  field: string;
  operator: string;
  value: string;
}

export type ContactConditionKind = "tag" | "custom_field" | "platform" | "variable" | "is_subscribed";

export const TAG_PREFIX = "tag:";
export const VARIABLE_PREFIX = "variable:";
export const CUSTOM_FIELD_PREFIX = "custom_field:";

export const CONTACT_CONDITION_LABELS: Record<ContactConditionKind, string> = {
  tag: "Etiqueta",
  custom_field: "Campo personalizado",
  platform: "Plataforma",
  variable: "Variable",
  is_subscribed: "Está suscrito",
};

export interface ParsedConditionField {
  kind: ContactConditionKind;
  /** Nombre de la etiqueta, de la variable o slug del campo ("" si no hay). */
  name: string;
}

/** Arma el `field` que guarda el panel. */
export function buildConditionField(kind: ContactConditionKind, name = ""): string {
  switch (kind) {
    case "tag":
      return `${TAG_PREFIX}${name}`;
    case "variable":
      return `${VARIABLE_PREFIX}${name}`;
    case "custom_field":
      return `${CUSTOM_FIELD_PREFIX}${name}`;
    case "platform":
    case "is_subscribed":
      return kind;
  }
}

/** Lee un `field` en cualquiera de los dos formatos. Los campos de gestión no pasan por aquí. */
export function parseConditionField(condition: FlowCondition): ParsedConditionField & { legacy: boolean } {
  const { field } = condition;
  if (field === "platform") return { kind: "platform", name: "", legacy: false };
  if (field === "is_subscribed") return { kind: "is_subscribed", name: "", legacy: false };
  if (field.startsWith(TAG_PREFIX)) return { kind: "tag", name: field.slice(TAG_PREFIX.length), legacy: false };
  if (field.startsWith(VARIABLE_PREFIX)) return { kind: "variable", name: field.slice(VARIABLE_PREFIX.length), legacy: false };
  if (field.startsWith(CUSTOM_FIELD_PREFIX)) {
    return { kind: "custom_field", name: field.slice(CUSTOM_FIELD_PREFIX.length), legacy: false };
  }
  // Formato antiguo.
  if (field === "tag" || field === "has_tag") return { kind: "tag", name: condition.value ?? "", legacy: true };
  if (field === "variable") return { kind: "variable", name: "", legacy: true };
  if (field === "custom_field") return { kind: "custom_field", name: "", legacy: true };
  return { kind: "custom_field", name: field, legacy: true };
}

/**
 * Pasa una condición del formato antiguo al actual. Las que ya están en el
 * formato actual (y las de gestión) quedan igual.
 */
export function upgradeCondition(condition: FlowCondition, isCaseField: (field: string) => boolean): FlowCondition {
  if (isCaseField(condition.field)) return condition;
  const parsed = parseConditionField(condition);
  if (!parsed.legacy) return condition;
  if (parsed.kind === "tag" && (condition.field === "tag" || condition.field === "has_tag")) {
    // "tag igual a VIP" quería decir "tiene la etiqueta VIP".
    return {
      field: buildConditionField("tag", parsed.name),
      operator: "equals",
      value: condition.operator === "not_equals" ? "false" : "true",
    };
  }
  return { ...condition, field: buildConditionField(parsed.kind, parsed.name) };
}

/** Lo que el motor (o el simulador) sabe del contacto al evaluar una condición. */
export interface ContactFacts {
  platform?: string;
  isSubscribed: boolean;
  tags: readonly string[];
  customFields: Readonly<Record<string, string | undefined>>;
  variables: Readonly<Record<string, unknown>>;
}

function asText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Evalúa una condición sobre el contacto (no de gestión), en cualquiera de los dos formatos. */
export function evaluateContactCondition(condition: FlowCondition, facts: ContactFacts): boolean {
  const parsed = parseConditionField(condition);
  const { operator, value } = upgradeCondition(condition, () => false);

  switch (parsed.kind) {
    case "platform":
      return compareCondition(facts.platform, operator, value);
    case "is_subscribed":
      return compareCondition(String(facts.isSubscribed), operator, value);
    case "tag": {
      const has = facts.tags.includes(parsed.name);
      // "existe" sobre una etiqueta es "la tiene".
      if (operator === "exists") return has;
      return compareCondition(String(has), operator, value);
    }
    case "variable":
      if (!parsed.name) return compareCondition(undefined, operator, value);
      return compareCondition(asText(resolveVariablePath(facts.variables as Record<string, unknown>, parsed.name)), operator, value);
    case "custom_field":
      return compareCondition(parsed.name ? facts.customFields[parsed.name] : undefined, operator, value);
  }
}

/** Texto corto de una condición para el lienzo y la prueba. */
export function describeContactCondition(condition: FlowCondition): string {
  const parsed = parseConditionField(condition);
  const { operator, value } = upgradeCondition(condition, () => false);
  const yesNo = value === "true" ? "Sí" : value === "false" ? "No" : value;
  switch (parsed.kind) {
    case "tag":
      return operator === "exists" ||
        (operator === "equals" && value === "true") ||
        (operator === "not_equals" && value === "false")
        ? `Tiene la etiqueta ${parsed.name || "(sin nombre)"}`
        : `No tiene la etiqueta ${parsed.name || "(sin nombre)"}`;
    case "is_subscribed":
      return `Está suscrito: ${yesNo}`;
    case "platform":
      return `Plataforma ${OPERATOR_SYMBOLS[operator] ?? operator} ${value}`;
    case "variable":
      return `Variable ${parsed.name || "(sin nombre)"} ${OPERATOR_SYMBOLS[operator] ?? operator} ${value}`.trim();
    case "custom_field":
      return `Campo ${parsed.name || "(sin nombre)"} ${OPERATOR_SYMBOLS[operator] ?? operator} ${value}`.trim();
  }
}

export const OPERATOR_SYMBOLS: Record<string, string> = {
  equals: "=",
  not_equals: "!=",
  contains: "contiene",
  exists: "existe",
  gt: ">",
  lt: "<",
};

// ── Lo que usa el panel del lienzo para guardar en el formato del motor ─────

/** Condición nueva de un tipo de campo, ya en el formato que lee el motor. */
export function newContactCondition(kind: ContactConditionKind): FlowCondition {
  switch (kind) {
    case "tag":
    case "is_subscribed":
      return { field: buildConditionField(kind), operator: "equals", value: "true" };
    default:
      return { field: buildConditionField(kind), operator: "equals", value: "" };
  }
}

/** Cambia el nombre (etiqueta, variable o campo) de una condición conservando lo demás. */
export function renameConditionTarget(condition: FlowCondition, name: string): FlowCondition {
  const { kind } = parseConditionField(condition);
  return { ...condition, field: buildConditionField(kind, name) };
}

/** ¿La condición de etiqueta pide que el contacto la tenga? */
export function tagCondition(condition: FlowCondition): { name: string; has: boolean } {
  const { operator, value } = upgradeCondition(condition, () => false);
  const { name } = parseConditionField(condition);
  const has = operator === "exists" || (operator === "equals" && value !== "false") || (operator === "not_equals" && value === "false");
  return { name, has };
}

/** Condición de etiqueta: "tiene" (true) o "no tiene" (false) la etiqueta. */
export function setTagPresence(condition: FlowCondition, has: boolean): FlowCondition {
  return { ...condition, operator: "equals", value: has ? "true" : "false" };
}
