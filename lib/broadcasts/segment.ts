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

// ── Revisión y descripción en palabras de un filtro ────────────────────────

function ruleIsComplete(rule: SegmentRule): boolean {
  const value = (rule.value ?? "").trim();
  switch (rule.field) {
    case "is_subscribed":
      return true;
    case "key_date": {
      if (rule.operator === "between") {
        const { from, to } = parseDateRange(value);
        return !!(from || to);
      }
      return DATE_RE.test(value);
    }
    case "last_interaction":
      return !Number.isNaN(new Date(value).getTime());
    case "custom_field": {
      const { slug, value: fieldValue } = parseCustomFieldValue(value);
      return !!slug.trim() && !!fieldValue.trim();
    }
    default:
      return value.length > 0;
  }
}

/**
 * Primer problema de un filtro de segmento guardable, en español, o null.
 * Un filtro con una regla sin completar (p. ej. "Tiene etiqueta" sin elegir
 * la etiqueta) no coincide con nadie: no se guarda. `null` o sin grupos = sin filtro.
 */
export function incompleteFilterProblem(filter: SegmentFilter | null | undefined): string | null {
  if (!filter || !Array.isArray(filter.groups) || filter.groups.length === 0) return null;
  for (const group of filter.groups) {
    if (!Array.isArray(group.rules) || group.rules.length === 0) {
      return "El filtro tiene un grupo sin reglas. Agrega una regla o quita el grupo.";
    }
    for (const rule of group.rules) {
      if (!ruleIsComplete(rule)) {
        return "El filtro tiene reglas sin completar. Elige el valor de cada regla o quita las que no uses.";
      }
    }
  }
  return null;
}

/** Nombres para mostrar un filtro en palabras: cada función devuelve el nombre de un id (o undefined). */
export interface SegmentNames {
  tag?: (idOrName: string) => string | undefined;
  contactType?: (id: string) => string | undefined;
  team?: (id: string) => string | undefined;
  owner?: (id: string) => string | undefined;
  platform?: (value: string) => string | undefined;
}

function shortDate(iso: string): string {
  return DATE_RE.test(iso) ? iso.split("-").reverse().join("/") : iso;
}

/** Una regla en palabras: «Tiene la etiqueta "VIP"». */
export function describeSegmentRule(rule: SegmentRule, names: SegmentNames = {}): string {
  const value = (rule.value ?? "").trim();
  const not = rule.operator === "not_equals";
  const pick = (fn: ((v: string) => string | undefined) | undefined) =>
    value === SEGMENT_NONE_VALUE ? "ninguno" : `“${fn?.(value) ?? value}”`;
  switch (rule.field) {
    case "has_tag":
      return `Tiene la etiqueta ${pick(names.tag)}`;
    case "missing_tag":
      return `No tiene la etiqueta ${pick(names.tag)}`;
    case "is_subscribed":
      return value === "false" ? "No está suscrito" : "Está suscrito";
    case "platform":
      return `La plataforma ${not ? "no es" : "es"} ${pick(names.platform)}`;
    case "contact_type":
      return `El tipo de contacto ${not ? "no es" : "es"} ${pick(names.contactType)}`;
    case "team":
      return `El equipo ${not ? "no es" : "es"} ${pick(names.team)}`;
    case "owner":
      return `El responsable ${not ? "no es" : "es"} ${pick(names.owner)}`;
    case "last_interaction":
      return `Última interacción ${rule.operator === "before" ? "antes del" : "después del"} ${shortDate(value.slice(0, 10))}`;
    case "key_date": {
      if (rule.operator === "between") {
        const { from, to } = parseDateRange(value);
        return `Fecha clave entre ${from ? shortDate(from) : "el inicio"} y ${to ? shortDate(to) : "hoy en adelante"}`;
      }
      return `Fecha clave ${rule.operator === "before" ? "hasta el" : "desde el"} ${shortDate(value)}`;
    }
    case "custom_field": {
      const { slug, value: fieldValue } = parseCustomFieldValue(value);
      const verbs: Record<string, string> = {
        equals: "es igual a",
        not_equals: "no es igual a",
        contains: "contiene",
        gt: "es mayor que",
        lt: "es menor que",
      };
      return `El campo “${slug}” ${verbs[rule.operator] ?? "es"} “${fieldValue}”`;
    }
    default:
      return `${rule.field} ${rule.operator} ${value}`.trim();
  }
}

/** El filtro entero en frases, una por grupo: «Cumple TODAS: …». */
export function describeSegmentFilter(filter: SegmentFilter, names: SegmentNames = {}): string[] {
  const lines = filter.groups.map((g) => {
    const rules = g.rules.map((r) => describeSegmentRule(r, names));
    if (rules.length === 1) return rules[0];
    return `${g.combinator === "or" ? "Cumple alguna" : "Cumple todas"}: ${rules.join("; ")}`;
  });
  return lines;
}
