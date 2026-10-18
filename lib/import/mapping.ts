// Columnas de la importación y autodetección del mapeo por encabezado (pura).

export const IMPORT_FIELDS = [
  { key: "name", label: "Nombre" },
  { key: "phone", label: "Teléfono" },
  { key: "email", label: "Correo" },
  { key: "type", label: "Tipo de contacto" },
  { key: "team", label: "Sede (equipo)" },
  { key: "owner", label: "Responsable (correo)" },
  { key: "keyDate", label: "Fecha clave" },
  { key: "tags", label: "Etiquetas (separadas por |)" },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

export const MAX_IMPORT_ROWS = 5000;
export const IMPORT_BATCH_SIZE = 200;

/** Clave de un campo personalizado en el mapeo. */
export function customKey(slug: string): string {
  return `custom:${slug}`;
}

/** Campo (o `custom:<slug>`) → índice de columna, o null si no se importa. */
export type ColumnMapping = Record<string, number | null>;

export interface ImportRowInput {
  /** Línea del archivo (el encabezado es la 1). */
  line: number;
  values: Partial<Record<ImportFieldKey, string>>;
  /** slug del campo personalizado → valor. */
  custom: Record<string, string>;
  /** Línea de la primera fila igual (por teléfono o correo); null si no es duplicada. */
  fileDuplicateOf?: number | null;
}

/** Minúsculas, sin tildes, solo letras y números separados por un espacio. */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Del campo más específico al más general: una columna "Correo responsable"
// debe caer en `owner` y no en `email`.
const ALIASES: [ImportFieldKey, string[]][] = [
  ["owner", ["responsable", "correo responsable", "email responsable", "correo del responsable", "asesor", "vendedor", "encargado", "owner", "assigned to", "agent", "agente"]],
  ["team", ["sede", "equipo", "team", "sucursal", "local", "gimnasio", "branch"]],
  ["type", ["tipo", "tipo de contacto", "tipo contacto", "tipo de cliente", "tipo cliente", "type", "contact type"]],
  ["keyDate", ["fecha clave", "fecha de vencimiento", "fecha vencimiento", "vencimiento", "fecha fin", "fecha de fin", "key date", "due date", "expiration date", "expiry", "fecha"]],
  ["tags", ["etiquetas", "etiqueta", "tags", "tag", "labels"]],
  ["phone", ["telefono", "celular", "movil", "whatsapp", "telefono celular", "numero de celular", "numero", "phone", "mobile", "cel", "tel", "cell"]],
  ["email", ["correo", "correo electronico", "email", "e mail", "mail"]],
  ["name", ["nombre", "nombres", "nombre completo", "nombres y apellidos", "apellidos y nombres", "cliente", "name", "full name", "display name", "contacto", "socio"]],
];

export interface CustomFieldRef {
  slug: string;
  name: string;
}

/**
 * Propone el mapeo por el texto de los encabezados (español e inglés). Cada
 * columna se usa una sola vez. Primero coincidencia exacta; luego, si el
 * encabezado contiene el alias como palabra completa.
 */
export function autoMapColumns(headers: string[], customFields: CustomFieldRef[] = []): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const f of IMPORT_FIELDS) mapping[f.key] = null;
  for (const c of customFields) mapping[customKey(c.slug)] = null;

  const take = (key: string, match: (h: string) => boolean) => {
    if (mapping[key] !== null) return;
    const idx = normalized.findIndex((h, i) => !used.has(i) && h !== "" && match(h));
    if (idx >= 0) {
      mapping[key] = idx;
      used.add(idx);
    }
  };

  for (const [key, aliases] of ALIASES) {
    const set = new Set(aliases.map(normalizeHeader));
    take(key, (h) => set.has(h));
  }
  for (const c of customFields) {
    const targets = new Set([normalizeHeader(c.slug), normalizeHeader(c.name)]);
    take(customKey(c.slug), (h) => targets.has(h));
  }
  for (const [key, aliases] of ALIASES) {
    const padded = aliases.map((a) => ` ${normalizeHeader(a)} `);
    take(key, (h) => padded.some((a) => ` ${h} `.includes(a)));
  }
  return mapping;
}

/** Aplica el mapeo a las filas de datos (sin el encabezado). */
export function mapRows(dataRows: string[][], mapping: ColumnMapping): ImportRowInput[] {
  const cell = (row: string[], idx: number | null | undefined) =>
    idx === null || idx === undefined ? "" : (row[idx] ?? "").trim();
  return dataRows.map((row, i) => {
    const values: ImportRowInput["values"] = {};
    for (const f of IMPORT_FIELDS) {
      const v = cell(row, mapping[f.key]);
      if (v !== "") values[f.key] = v;
    }
    const custom: Record<string, string> = {};
    for (const [key, idx] of Object.entries(mapping)) {
      if (!key.startsWith("custom:")) continue;
      const v = cell(row, idx);
      if (v !== "") custom[key.slice("custom:".length)] = v;
    }
    return { line: i + 2, values, custom };
  });
}
