// Comprobación de lo que llega del navegador al servidor (puro): filas y
// opciones de la importación.

import { IMPORT_BATCH_SIZE, IMPORT_FIELDS, type ImportRowInput } from "./mapping";
import { DEFAULT_IMPORT_OPTIONS, type ImportOptions } from "./validate";

const MAX_CELL = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9_-]{1,64}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_CELL) : "";
}

/** Filas de un lote; null si la forma no es válida o hay más de 200. */
export function sanitizeImportRows(raw: unknown): ImportRowInput[] | null {
  if (!Array.isArray(raw) || raw.length > IMPORT_BATCH_SIZE) return null;
  const rows: ImportRowInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    const line = r.line;
    if (typeof line !== "number" || !Number.isInteger(line) || line < 2 || line > 1_000_000) return null;
    const values: ImportRowInput["values"] = {};
    const rawValues = r.values && typeof r.values === "object" ? (r.values as Record<string, unknown>) : {};
    for (const f of IMPORT_FIELDS) {
      const v = str(rawValues[f.key]);
      if (v) values[f.key] = v;
    }
    const custom: Record<string, string> = {};
    const rawCustom = r.custom && typeof r.custom === "object" ? (r.custom as Record<string, unknown>) : {};
    for (const [slug, value] of Object.entries(rawCustom)) {
      const v = str(value);
      if (v && SLUG_RE.test(slug)) custom[slug] = v;
    }
    const dup = r.fileDuplicateOf;
    rows.push({
      line,
      values,
      custom,
      fileDuplicateOf: typeof dup === "number" && Number.isInteger(dup) && dup > 0 ? dup : null,
    });
  }
  return rows;
}

export function sanitizeImportOptions(raw: unknown): ImportOptions | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.channelId !== null && o.channelId !== undefined && !isUuid(o.channelId)) return null;
  return {
    existing: o.existing === "update" ? "update" : "skip",
    createTags: typeof o.createTags === "boolean" ? o.createTags : DEFAULT_IMPORT_OPTIONS.createTags,
    channelId: isUuid(o.channelId) ? o.channelId : null,
    scheduleCases: o.scheduleCases === true,
  };
}
