// Validación fila por fila de la importación (pura): la usan la vista previa
// (en el navegador) y el proceso por lotes (en el servidor), así ambos
// coinciden.

import { parseImportDate } from "./dates";
import type { ImportFieldKey, ImportRowInput } from "./mapping";
import { normalizeImportPhone } from "./phone";

export interface ImportOptions {
  /** Qué hacer con los contactos que ya existen. */
  existing: "update" | "skip";
  createTags: boolean;
  /** Canal de WhatsApp al que vincular el teléfono (contact_channels). */
  channelId: string | null;
  /** Programar gestiones según la fecha clave. */
  scheduleCases: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  existing: "skip",
  createTags: true,
  channelId: null,
  scheduleCases: false,
};

export interface ImportLookups {
  types: { id: string; name: string; archived: boolean }[];
  teams: { id: string; name: string }[];
  members: { userId: string; email: string | null }[];
  tags: { id: string; name: string }[];
  customFields: { id: string; slug: string }[];
  /** Dígitos del teléfono → id del contacto. */
  existingByPhone: ReadonlyMap<string, string>;
  /** Correo en minúsculas → id del contacto. */
  existingByEmail: ReadonlyMap<string, string>;
}

export interface ResolvedContact {
  displayName: string | null;
  email: string | null;
  phone: string | null;
  contactTypeId: string | null;
  teamId: string | null;
  ownerId: string | null;
  keyDate: string | null;
  /** Nombres de etiqueta sin repetir (ya recortados). */
  tagNames: string[];
  customValues: { fieldId: string; value: string }[];
}

export type RowStatus = "create" | "update" | "skip" | "error";

export interface ValidatedRow {
  line: number;
  status: RowStatus;
  /** Motivos por los que la fila no se importa (status "error"). */
  errors: string[];
  /** Avisos: la fila se importa, pero un valor se ignoró. */
  warnings: string[];
  /** Por qué se salta (status "skip"). */
  skipReason: string | null;
  existingId: string | null;
  /** Cómo se encontró el existente. */
  matchedBy: "phone" | "email" | null;
  contact: ResolvedContact;
}

const EMAIL_RE = /^[^\s@,;()<>"]+@[^\s@,;()<>"]+\.[^\s@,;()<>"]+$/;
const MAX_NAME = 200;

export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "");
}

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Etiquetas separadas por "|" (y por ";" o saltos de línea), sin repetir, sin distinguir mayúsculas. */
export function splitTags(text: string | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[|\n;]/)) {
    const t = part.trim().slice(0, 60);
    if (t && !seen.has(norm(t))) {
      seen.add(norm(t));
      out.push(t);
    }
  }
  return out;
}

function emailOf(text: string | undefined): { value: string | null; error?: string } {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return { value: null };
  return EMAIL_RE.test(t) ? { value: t } : { value: null, error: "El correo no es válido." };
}

/** Para cada fila repetida (por teléfono, luego por correo), la línea de la primera igual. */
export function findFileDuplicates(rows: ImportRowInput[]): Map<number, number> {
  const byPhone = new Map<string, number>();
  const byEmail = new Map<string, number>();
  const dups = new Map<number, number>();
  for (const row of rows) {
    const p = normalizeImportPhone(row.values.phone);
    const phone = p.ok && p.value ? phoneKey(p.value) : null;
    const email = emailOf(row.values.email).value;
    const first = (phone && byPhone.get(phone)) || (email && byEmail.get(email)) || null;
    if (first) {
      dups.set(row.line, first);
      continue;
    }
    if (phone) byPhone.set(phone, row.line);
    if (email) byEmail.set(email, row.line);
  }
  return dups;
}

export function validateImportRow(row: ImportRowInput, lookups: ImportLookups, options: ImportOptions): ValidatedRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const v: Partial<Record<ImportFieldKey, string>> = row.values;

  const phoneRes = normalizeImportPhone(v.phone);
  if (!phoneRes.ok) errors.push(phoneRes.error);
  const emailRes = emailOf(v.email);
  if (emailRes.error) errors.push(emailRes.error);
  const dateRes = parseImportDate(v.keyDate);
  if (!dateRes.ok) errors.push(dateRes.error);

  const phone = phoneRes.ok ? phoneRes.value : null;
  const email = emailRes.value;
  const name = (v.name ?? "").trim().slice(0, MAX_NAME);
  if (errors.length === 0 && !phone && !email) errors.push("La fila necesita al menos un teléfono o un correo.");

  let contactTypeId: string | null = null;
  if (v.type) {
    const wanted = norm(v.type);
    const t = lookups.types.find((x) => norm(x.name) === wanted);
    if (!t) warnings.push(`El tipo "${v.type}" no existe; se deja sin tipo.`);
    else if (t.archived) warnings.push(`El tipo "${t.name}" está archivado; se deja sin tipo.`);
    else contactTypeId = t.id;
  }
  let teamId: string | null = null;
  if (v.team) {
    const wanted = norm(v.team);
    const t = lookups.teams.find((x) => norm(x.name) === wanted);
    if (!t) warnings.push(`La sede "${v.team}" no existe; se deja sin equipo.`);
    else teamId = t.id;
  }
  let ownerId: string | null = null;
  if (v.owner) {
    const wanted = v.owner.trim().toLowerCase();
    const o = lookups.members.find((m) => m.email && m.email.toLowerCase() === wanted);
    if (!o) warnings.push(`El responsable "${v.owner}" no es miembro del espacio; se deja sin responsable.`);
    else ownerId = o.userId;
  }

  const tagNames = splitTags(v.tags);
  if (!options.createTags) {
    const known = new Set(lookups.tags.map((t) => norm(t.name)));
    const missing = tagNames.filter((t) => !known.has(norm(t)));
    if (missing.length) warnings.push(`Etiquetas que no existen y se ignoran: ${missing.join(", ")}.`);
  }

  const customValues: ResolvedContact["customValues"] = [];
  for (const [slug, value] of Object.entries(row.custom)) {
    const def = lookups.customFields.find((c) => c.slug === slug);
    if (def && value.trim()) customValues.push({ fieldId: def.id, value: value.trim().slice(0, 500) });
  }

  const contact: ResolvedContact = {
    displayName: name || null,
    email,
    phone,
    contactTypeId,
    teamId,
    ownerId,
    keyDate: dateRes.ok ? dateRes.value : null,
    tagNames,
    customValues,
  };

  let existingId: string | null = null;
  let matchedBy: ValidatedRow["matchedBy"] = null;
  if (phone && lookups.existingByPhone.has(phoneKey(phone))) {
    existingId = lookups.existingByPhone.get(phoneKey(phone)) ?? null;
    matchedBy = "phone";
  } else if (email && lookups.existingByEmail.has(email)) {
    existingId = lookups.existingByEmail.get(email) ?? null;
    matchedBy = "email";
  }

  const base = { line: row.line, errors, warnings, existingId, matchedBy, contact };
  if (errors.length) return { ...base, status: "error", skipReason: null, existingId: null, matchedBy: null };
  if (row.fileDuplicateOf) {
    return { ...base, status: "skip", skipReason: `Duplicada en el archivo (igual a la fila ${row.fileDuplicateOf}).` };
  }
  if (existingId) {
    if (options.existing === "skip") {
      return {
        ...base,
        status: "skip",
        skipReason: `Ya existe en el CRM (por ${matchedBy === "phone" ? "teléfono" : "correo"}).`,
      };
    }
    return { ...base, status: "update", skipReason: null };
  }
  return { ...base, status: "create", skipReason: null };
}

export interface ImportSummary {
  total: number;
  create: number;
  update: number;
  skip: number;
  error: number;
  withWarnings: number;
}

export function summarizeRows(rows: ValidatedRow[]): ImportSummary {
  const s: ImportSummary = { total: rows.length, create: 0, update: 0, skip: 0, error: 0, withWarnings: 0 };
  for (const r of rows) {
    s[r.status]++;
    if (r.warnings.length) s.withWarnings++;
  }
  return s;
}

export interface ImportErrorEntry {
  line: number;
  message: string;
}

/** Filas del CSV de errores: las filas originales con el motivo al final. */
export function buildErrorsCsvRows(headers: string[], dataRows: string[][], errors: ImportErrorEntry[]): string[][] {
  const out: string[][] = [[...headers, "error"]];
  for (const e of errors) {
    const row = dataRows[e.line - 2] ?? [];
    out.push([...headers.map((_, i) => row[i] ?? ""), e.message]);
  }
  return out;
}
