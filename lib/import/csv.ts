// Lectura de CSV para la importación de contactos (pura, probada con vitest).
// Detecta la codificación (UTF-8 o Latin-1/Windows-1252) y el separador
// (coma, punto y coma o tabulación), y entiende comillas, comillas escapadas
// ("") y saltos de línea dentro de un campo.

export type CsvEncoding = "utf-8" | "latin-1";

export interface DecodedCsv {
  text: string;
  encoding: CsvEncoding;
}

/** UTF-8 si los bytes lo son; si no, Latin-1 (Windows-1252, lo que exporta Excel en español). */
export function decodeCsvBytes(bytes: Uint8Array): DecodedCsv {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: stripBom(text), encoding: "utf-8" };
  } catch {
    return { text: stripBom(new TextDecoder("windows-1252").decode(bytes)), encoding: "latin-1" };
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export const CSV_DELIMITERS = [",", ";", "\t"] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** Separador más usado en la primera línea con datos (fuera de comillas). Empate: coma. */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === "\n" || ch === "\r") {
        if (Object.values(counts).some((n) => n > 0)) break;
      } else if (ch in counts) counts[ch]++;
    }
  }
  let best: CsvDelimiter = ",";
  for (const d of CSV_DELIMITERS) if (counts[d] > counts[best]) best = d;
  return best;
}

/** Filas del CSV como arreglos de texto. Las filas totalmente vacías se omiten. */
export function parseCsv(text: string, delimiter: string = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;

  const endField = () => {
    row.push(field);
    field = "";
    quotedField = false;
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "" && !quotedField) {
      inQuotes = true;
      quotedField = true;
    } else if (ch === delimiter) endField();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") endRow();
    else field += ch;
  }
  if (field !== "" || row.length > 0 || quotedField) endRow();
  return rows;
}

/** Escapa un campo para escribir CSV (comillas si trae separador, comillas o saltos). */
export function csvEscape(value: string, delimiter = ","): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Texto CSV con BOM (Excel lo abre bien en español). */
export function toCsv(rows: string[][], delimiter = ","): string {
  return "﻿" + rows.map((r) => r.map((c) => csvEscape(c, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}
