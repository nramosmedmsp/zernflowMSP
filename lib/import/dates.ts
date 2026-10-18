// Fechas clave de la importación (puras): dd/mm/aaaa y aaaa-mm-dd.

import { isDateString } from "@/lib/cases/dates";

export type ImportDateResult = { ok: true; value: string | null } | { ok: false; error: string };

const ERROR = "La fecha no es válida: usa dd/mm/aaaa o aaaa-mm-dd.";

/** Devuelve "YYYY-MM-DD". Acepta separadores "/", "-" y ".". Años de 4 dígitos. */
export function parseImportDate(input: string | null | undefined): ImportDateResult {
  const raw = (input ?? "").trim();
  if (raw === "") return { ok: true, value: null };
  // Excel puede dejar una hora al final ("2026-03-05 00:00:00").
  const text = raw.replace(/[ T]\d{1,2}:\d{2}(:\d{2})?.*$/, "");
  let y: string, m: string, d: string;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (match) [, y, m, d] = match;
  else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text))) [, d, m, y] = match;
  else return { ok: false, error: ERROR };
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isDateString(iso) ? { ok: true, value: iso } : { ok: false, error: ERROR };
}
