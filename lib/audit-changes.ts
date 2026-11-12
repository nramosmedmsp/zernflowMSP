// Armado del `meta` (solo valores simples y cortos) de los cambios de configuración
// que se registran con antes → después. Funciones puras, sin base: se prueban con vitest.
// Quien arma la frase es `describeAudit` (lib/audit-labels.ts), que solo lee los campos
// que esa lista permite. Nunca se guardan claves, textos completos ni datos de clientes.

import { WEEKDAYS, parseBusinessHours, type BusinessHours, type Weekday } from "@/lib/business-hours";

export type AuditScalar = string | number | boolean | null;

function dayText(hours: BusinessHours | null, day: Weekday, open24: boolean): string {
  if (!hours) return open24 ? "24 horas" : "Cerrado";
  const ranges = hours[day] ?? [];
  return ranges.length === 0 ? "Cerrado" : ranges.map((r) => `${r[0]}-${r[1]}`).join(", ");
}

/**
 * Cambios día por día entre dos horarios: `day_mon_from` / `day_mon_to`, etc., solo de los días
 * que cambiaron. `null` = sin horario propio (en la empresa, 24 horas). Sin cambios → `null`.
 */
export function hoursChangeMeta(before: unknown, after: unknown, scope: "company" | "team"): Record<string, AuditScalar> | null {
  const a = parseBusinessHours(before);
  const b = parseBusinessHours(after);
  const open24 = scope === "company";
  const meta: Record<string, AuditScalar> = {};
  for (const day of WEEKDAYS) {
    const from = dayText(a, day, open24);
    const to = dayText(b, day, open24);
    if (from !== to) {
      meta[`day_${day}_from`] = from;
      meta[`day_${day}_to`] = to;
    }
  }
  if (scope === "team" && (a === null) !== (b === null)) {
    meta.uses_company_hours = b === null;
  }
  return Object.keys(meta).length > 0 ? meta : null;
}

/** Agrega `<campo>_from` y `<campo>_to` solo si el valor cambió. */
export function pairIfChanged(meta: Record<string, AuditScalar>, field: string, from: AuditScalar, to: AuditScalar): void {
  if (from === to) return;
  meta[`${field}_from`] = from;
  meta[`${field}_to`] = to;
}

interface KeywordLike {
  keyword: string;
  action?: string;
}

const KEYWORD_ACTION_LABEL: Record<string, string> = { unsubscribe: "baja", subscribe: "alta" };

function keywordText(k: KeywordLike): string {
  return `${k.keyword} (${KEYWORD_ACTION_LABEL[k.action ?? "unsubscribe"] ?? "baja"})`;
}

/** Palabras clave globales: qué se agregó, qué se quitó y a cuáles se les cambió la acción. */
export function keywordsChangeMeta(before: readonly KeywordLike[], after: readonly KeywordLike[]): Record<string, AuditScalar> | null {
  const was = new Map(before.map((k) => [k.keyword, k]));
  const now = new Map(after.map((k) => [k.keyword, k]));
  const added = after.filter((k) => !was.has(k.keyword)).map(keywordText);
  const removed = before.filter((k) => !now.has(k.keyword)).map(keywordText);
  const changed = after
    .filter((k) => {
      const old = was.get(k.keyword);
      return old && (old.action ?? "unsubscribe") !== (k.action ?? "unsubscribe");
    })
    .map(keywordText);
  const meta: Record<string, AuditScalar> = {};
  if (added.length) meta.added = added.join(", ");
  if (removed.length) meta.removed = removed.join(", ");
  if (changed.length) meta.changed = changed.join(", ");
  meta.total = after.length;
  return added.length || removed.length || changed.length ? meta : null;
}
