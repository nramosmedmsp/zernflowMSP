// Reglas puras de «Plantilla al activarse» (docs/FASE-2-TECNICO.md 3.4 y 8):
// cómo se mapean las variables de una plantilla de WhatsApp a datos del
// contacto y cómo se arma `case_types.auto_template`. Sin E/S ni React:
// probado con vitest. Las usan la pantalla y la acción de servidor.

import type { CaseTypeAutoTemplate } from "@/lib/types/database";

export const AUTO_TEMPLATE_BASE_VARIABLES: readonly { token: string; label: string }[] = [
  { token: "{nombre}", label: "Nombre del contacto" },
  { token: "{fecha_clave}", label: "Fecha clave" },
  { token: "{empresa}", label: "Nombre de la empresa" },
];

export const MAX_AUTO_TEMPLATE_PARAMS = 20;
const CUSTOM_RE = /^\{campo:([a-z0-9_-]+)\}$/;

export interface CustomFieldOption {
  slug: string;
  name: string;
}

export function customFieldToken(slug: string): string {
  return `{campo:${slug}}`;
}

/** Slug de un valor `{campo:slug}`, o null si no lo es. */
export function customFieldSlug(token: string): string | null {
  return CUSTOM_RE.exec(token)?.[1] ?? null;
}

/** ¿Es un valor admitido? Uno base o un campo personalizado conocido. */
export function isAllowedParam(token: string, fieldSlugs: ReadonlySet<string>): boolean {
  if (AUTO_TEMPLATE_BASE_VARIABLES.some((v) => v.token === token)) return true;
  const slug = customFieldSlug(token);
  return slug !== null && fieldSlugs.has(slug);
}

/** Opciones del selector de cada variable: los datos base y los campos personalizados. */
export function paramOptions(fields: readonly CustomFieldOption[]): { token: string; label: string }[] {
  return [
    ...AUTO_TEMPLATE_BASE_VARIABLES,
    ...fields.map((f) => ({ token: customFieldToken(f.slug), label: `Campo: ${f.name}` })),
  ];
}

/** Mapeo inicial: la primera variable es el nombre; el resto queda por elegir. */
export function initialMapping(slotCount: number): string[] {
  return Array.from({ length: slotCount }, (_, i) => (i === 0 ? "{nombre}" : ""));
}

/**
 * Mapeo al editar una plantilla ya guardada: sus params si es la misma
 * plantilla y la misma cantidad de variables; si no, el inicial.
 */
export function mappingFor(
  slotCount: number,
  current: CaseTypeAutoTemplate | null,
  templateName: string,
  language: string,
): string[] {
  if (current && current.template_name === templateName && current.language === language && current.params.length === slotCount) {
    return [...current.params];
  }
  return initialMapping(slotCount);
}

export type AutoTemplateResult = { ok: true; value: CaseTypeAutoTemplate } | { ok: false; error: string };

/**
 * Arma el valor a guardar. Cada variable de la plantilla necesita un valor
 * (WhatsApp no acepta variables vacías) y debe ser uno de los admitidos.
 */
export function buildAutoTemplate(input: {
  templateName: unknown;
  language: unknown;
  params: unknown;
  fieldSlugs: ReadonlySet<string>;
  /** Si se conoce, la cantidad exacta de variables que pide la plantilla. */
  slotCount?: number;
}): AutoTemplateResult {
  const name = typeof input.templateName === "string" ? input.templateName.trim() : "";
  if (!name || name.length > 512) return { ok: false, error: "Elige una plantilla." };
  const language = typeof input.language === "string" ? input.language.trim() : "";
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) return { ok: false, error: "El idioma de la plantilla no es válido." };
  if (!Array.isArray(input.params) || input.params.length > MAX_AUTO_TEMPLATE_PARAMS) {
    return { ok: false, error: "Las variables de la plantilla no son válidas." };
  }
  if (input.slotCount !== undefined && input.params.length !== input.slotCount) {
    return { ok: false, error: "La cantidad de variables no coincide con la plantilla." };
  }
  const params: string[] = [];
  for (let i = 0; i < input.params.length; i++) {
    const raw = input.params[i];
    const token = typeof raw === "string" ? raw.trim() : "";
    if (!token) return { ok: false, error: `Elige qué dato va en la variable ${i + 1}.` };
    if (!isAllowedParam(token, input.fieldSlugs)) {
      return { ok: false, error: `El valor de la variable ${i + 1} no es válido.` };
    }
    params.push(token);
  }
  return { ok: true, value: { template_name: name, language, params } };
}

/** Lee `case_types.auto_template` (jsonb) o null si no está o no sirve. */
export function parseAutoTemplate(raw: unknown): CaseTypeAutoTemplate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.template_name !== "string" || !r.template_name) return null;
  if (typeof r.language !== "string" || !r.language) return null;
  const params = Array.isArray(r.params) ? r.params.filter((p): p is string => typeof p === "string") : [];
  return { template_name: r.template_name, language: r.language, params };
}

/** Valores de ejemplo para la vista previa de la plantilla. */
export function sampleParamValue(token: string, fields: readonly CustomFieldOption[]): string {
  switch (token) {
    case "{nombre}":
      return "María";
    case "{fecha_clave}":
      return "15 de enero";
    case "{empresa}":
      return "tu empresa";
    default: {
      const slug = customFieldSlug(token);
      const field = fields.find((f) => f.slug === slug);
      return field ? `(${field.name})` : "";
    }
  }
}
