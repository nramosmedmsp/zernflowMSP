// Filtros de segmento de las difusiones: lo puro (docs/FASE-2-TECNICO.md 5).
// Los filtros nuevos (tipo de contacto, equipo, responsable y fecha clave)
// se evalúan en memoria sobre las columnas de `contacts`; las consultas a la
// base viven en resolve.ts.

import { SEGMENT_NONE_VALUE } from "./tokens";

export interface SegmentRule {
  field: string;
  operator: string;
  value: string;
}

export interface SegmentGroup {
  combinator: "and" | "or";
  rules: SegmentRule[];
}

export interface SegmentFilter {
  combinator: "and" | "or";
  groups: SegmentGroup[];
}

/** Columnas de `contacts` que usan los filtros nuevos. */
export interface SegmentContact {
  id: string;
  contact_type_id: string | null;
  team_id: string | null;
  owner_id: string | null;
  /** YYYY-MM-DD */
  key_date: string | null;
}

/** Campos que se resuelven sobre las columnas del contacto. */
export const CONTACT_ATTRIBUTE_FIELDS = ["contact_type", "team", "owner", "key_date"] as const;
export type ContactAttributeField = (typeof CONTACT_ATTRIBUTE_FIELDS)[number];

export function isContactAttributeField(field: string): field is ContactAttributeField {
  return (CONTACT_ATTRIBUTE_FIELDS as readonly string[]).includes(field);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Rango de fechas de un filtro: "desde::hasta" (cualquiera puede faltar). */
export function parseDateRange(value: string): { from: string | null; to: string | null } {
  const [rawFrom = "", rawTo = ""] = value.split("::");
  const from = DATE_RE.test(rawFrom.trim()) ? rawFrom.trim() : null;
  const to = DATE_RE.test(rawTo.trim()) ? rawTo.trim() : null;
  return { from, to };
}

export function formatDateRange(from: string | null, to: string | null): string {
  return `${from ?? ""}::${to ?? ""}`;
}

function matchesId(column: string | null, rule: SegmentRule): boolean {
  const wanted = rule.value.trim();
  if (!wanted) return false;
  const isMatch = wanted === SEGMENT_NONE_VALUE ? column === null : column === wanted;
  return rule.operator === "not_equals" ? !isMatch : isMatch;
}

/**
 * ¿El contacto cumple un filtro de columna del contacto? Un filtro sin valor
 * no coincide con nadie (igual que las etiquetas sin elegir). Fecha clave:
 * `after` = desde (inclusive), `before` = hasta (inclusive), `between` =
 * "desde::hasta"; un contacto sin fecha clave nunca cumple.
 */
export function matchesContactRule(contact: SegmentContact, rule: SegmentRule): boolean {
  switch (rule.field) {
    case "contact_type":
      return matchesId(contact.contact_type_id, rule);
    case "team":
      return matchesId(contact.team_id, rule);
    case "owner":
      return matchesId(contact.owner_id, rule);
    case "key_date": {
      if (!contact.key_date) return false;
      let from: string | null;
      let to: string | null;
      if (rule.operator === "between") {
        ({ from, to } = parseDateRange(rule.value));
      } else if (rule.operator === "before") {
        from = null;
        to = DATE_RE.test(rule.value.trim()) ? rule.value.trim() : null;
      } else {
        from = DATE_RE.test(rule.value.trim()) ? rule.value.trim() : null;
        to = null;
      }
      if (!from && !to) return false;
      if (from && contact.key_date < from) return false;
      if (to && contact.key_date > to) return false;
      return true;
    }
    default:
      return false;
  }
}

export function intersectSets<T>(sets: Set<T>[]): Set<T> {
  if (sets.length === 0) return new Set();
  const result = new Set(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    for (const item of result) {
      if (!sets[i].has(item)) result.delete(item);
    }
  }
  return result;
}

export function unionSets<T>(sets: Set<T>[]): Set<T> {
  const result = new Set<T>();
  for (const s of sets) for (const item of s) result.add(item);
  return result;
}

/** Combina los resultados de reglas (o grupos) con "and" u "or". */
export function combineSets<T>(combinator: "and" | "or", sets: Set<T>[]): Set<T> {
  return combinator === "and" ? intersectSets(sets) : unionSets(sets);
}

/** Valor de un filtro de campo personalizado: "slug::valor" (lo que guarda la interfaz) o "slug:valor". */
export function parseCustomFieldValue(value: string): { slug: string; value: string } {
  const sep = value.includes("::") ? "::" : ":";
  const [slug, ...rest] = value.split(sep);
  return { slug: slug ?? "", value: rest.join(sep) };
}
