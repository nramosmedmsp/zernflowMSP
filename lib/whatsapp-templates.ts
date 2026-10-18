// Plantillas de WhatsApp (docs/PLAN-CRM.md 7.5): lógica pura, sin servidor ni
// React, compartida por las rutas /api/v1/templates, la pantalla de
// configuración, el selector de la bandeja y el motor de gestiones (plantilla
// automática de las proactivas). Probada con vitest
// (components/composer/whatsapp-templates.test.ts).

import { normalizeSearch } from "@/lib/saved-replies";

export const TEMPLATE_BODY_MAX = 1024;
export const TEMPLATE_PARAM_MAX = 1024;

export type TemplateCategory = "UTILITY" | "MARKETING";
export const CREATABLE_CATEGORIES: readonly TemplateCategory[] = ["UTILITY", "MARKETING"];

export const TEMPLATE_STATUS_LABELS: Record<string, string> = {
  APPROVED: "Aprobada",
  PENDING: "En revisión",
  IN_APPEAL: "En apelación",
  REJECTED: "Rechazada",
  PAUSED: "Pausada",
  DISABLED: "Desactivada",
  PENDING_DELETION: "Por eliminar",
};

export const TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  UTILITY: "Utilidad",
  MARKETING: "Marketing",
  AUTHENTICATION: "Autenticación",
};

export function templateStatusLabel(status: string | null | undefined): string {
  return TEMPLATE_STATUS_LABELS[(status ?? "").toUpperCase()] ?? (status || "Desconocido");
}

export function templateCategoryLabel(category: string | null | undefined): string {
  return TEMPLATE_CATEGORY_LABELS[(category ?? "").toUpperCase()] ?? (category || "");
}

export type TemplateSlotSection = "header" | "body" | "button";

/** Un valor que hay que llenar al enviar (una variable de la plantilla). */
export interface TemplateSlot {
  section: TemplateSlotSection;
  /** `{{1}}` o `{{nombre}}`, tal como aparece en la plantilla. */
  token: string;
  label: string;
}

export interface TemplateButtonInfo {
  type: string;
  text: string;
}

/** Plantilla lista para mostrar (lo que devuelve GET /api/v1/templates). */
export interface TemplateSummary {
  id: string | null;
  name: string;
  language: string;
  category: string;
  /** APPROVED, PENDING, REJECTED... */
  status: string;
  header: string | null;
  /** TEXT, IMAGE, VIDEO, DOCUMENT... */
  headerFormat: string | null;
  body: string;
  footer: string | null;
  buttons: TemplateButtonInfo[];
  /** Total de valores que pide el envío (encabezado + cuerpo + botones). */
  variableCount: number;
  slots: TemplateSlot[];
}

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Variables distintas de un texto, en orden de aparición. */
export function extractPlaceholders(text: string | null | undefined): string[] {
  const seen: string[] = [];
  if (!text) return seen;
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

interface RawComponent {
  type?: unknown;
  format?: unknown;
  text?: unknown;
  buttons?: unknown;
}

function upper(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase() : "";
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Convierte una plantilla de Zernio/Meta al formato de la interfaz. */
export function summarizeTemplate(raw: unknown): TemplateSummary {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const components = (Array.isArray(t.components) ? t.components : []) as RawComponent[];
  const find = (type: string) => components.find((c) => upper(c?.type) === type);

  const headerComp = find("HEADER");
  const bodyComp = find("BODY");
  const footerComp = find("FOOTER");
  const buttonsComp = find("BUTTONS");

  const headerFormat = headerComp ? upper(headerComp.format) || "TEXT" : null;
  const header = headerComp && headerFormat === "TEXT" ? str(headerComp.text) : null;
  const body = str(bodyComp?.text) ?? "";
  const footer = str(footerComp?.text);

  const rawButtons = (Array.isArray(buttonsComp?.buttons) ? buttonsComp.buttons : []) as Array<
    Record<string, unknown>
  >;
  const buttons: TemplateButtonInfo[] = rawButtons.map((b) => ({
    type: upper(b.type),
    text: str(b.text) ?? "",
  }));

  const slots: TemplateSlot[] = [];
  for (const name of extractPlaceholders(header)) {
    slots.push({ section: "header", token: `{{${name}}}`, label: `Encabezado ${tokenLabel(name)}` });
  }
  for (const name of extractPlaceholders(body)) {
    slots.push({ section: "body", token: `{{${name}}}`, label: `Variable ${tokenLabel(name)}` });
  }
  for (const b of rawButtons) {
    if (upper(b.type) === "URL" && typeof b.url === "string" && extractPlaceholders(b.url).length > 0) {
      slots.push({
        section: "button",
        token: "{{1}}",
        label: `Final del enlace del botón "${str(b.text) ?? "enlace"}"`,
      });
    }
  }

  return {
    id: str(t.id),
    name: typeof t.name === "string" ? t.name : "",
    language: typeof t.language === "string" ? t.language : "",
    category: upper(t.category),
    status: upper(t.status),
    header,
    headerFormat,
    body,
    footer,
    buttons,
    variableCount: slots.length,
    slots,
  };
}

function tokenLabel(name: string): string {
  return /^\d+$/.test(name) ? name : `"${name}"`;
}

/** Reemplaza las variables de un texto con los valores dados (en orden de aparición). */
export function fillPlaceholders(text: string, values: readonly string[], offset = 0): string {
  const order = extractPlaceholders(text);
  return text.replace(PLACEHOLDER_RE, (match, name: string) => {
    const value = values[offset + order.indexOf(name)];
    return value !== undefined && value.trim() ? value : match;
  });
}

export interface TemplatePreview {
  header: string | null;
  body: string;
  footer: string | null;
}

/** Vista previa con los valores escritos; las variables vacías quedan como `{{1}}`. */
export function renderTemplatePreview(template: TemplateSummary, values: readonly string[]): TemplatePreview {
  const headerCount = template.slots.filter((s) => s.section === "header").length;
  return {
    header: template.header ? fillPlaceholders(template.header, values, 0) : null,
    body: fillPlaceholders(template.body, values, headerCount),
    footer: template.footer,
  };
}

/**
 * WhatsApp rechaza saltos de línea, tabulaciones y más de 4 espacios seguidos
 * dentro de un valor de variable.
 */
export function sanitizeTemplateParam(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
}

export type BuildParamsResult = { ok: true; params: string[] } | { ok: false; error: string };

/** Arma el arreglo plano de parámetros para el envío, validando que no falte ninguno. */
export function buildTemplateParams(
  template: Pick<TemplateSummary, "slots">,
  values: readonly string[],
): BuildParamsResult {
  const params: string[] = [];
  for (let i = 0; i < template.slots.length; i++) {
    const value = sanitizeTemplateParam(values[i] ?? "");
    if (!value) return { ok: false, error: `Completa ${template.slots[i].label.toLowerCase()}.` };
    if (value.length > TEMPLATE_PARAM_MAX) {
      return { ok: false, error: `${template.slots[i].label} es demasiado largo.` };
    }
    params.push(value);
  }
  return { ok: true, params };
}

/**
 * Valor inicial de la primera variable: el primer nombre del contacto, solo si
 * parece un nombre (no un teléfono, un correo ni un usuario con números).
 */
export function suggestFirstParam(contactName: string | null | undefined): string {
  const name = (contactName ?? "").trim();
  if (!name || name.includes("@") || /\d/.test(name)) return "";
  const first = name.split(/\s+/)[0] ?? "";
  const letters = first.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return "";
  return first;
}

/** Aprobada y con idioma y nombre: la única que se puede enviar. */
export function isSendable(template: Pick<TemplateSummary, "status" | "name" | "language">): boolean {
  return template.status === "APPROVED" && !!template.name && !!template.language;
}

// ── Crear plantillas ───────────────────────────────────────────────────────

export function normalizeTemplateName(raw: string): string {
  return normalizeSearch(raw)
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface TemplateCreateInput {
  name: string;
  language?: string | null;
  category: string;
  body: string;
  /** Un ejemplo por variable `{{n}}`; Meta los pide para revisar la plantilla. */
  examples?: readonly string[] | null;
}

export interface TemplateCreateValue {
  name: string;
  language: string;
  category: TemplateCategory;
  body: string;
  examples: string[];
}

export type TemplateCreateValidation = { ok: true; value: TemplateCreateValue } | { ok: false; error: string };

export function validateTemplateCreate(input: TemplateCreateInput): TemplateCreateValidation {
  const name = normalizeTemplateName(input.name ?? "");
  if (!name) return { ok: false, error: "Escribe un nombre para la plantilla." };
  if (!/^[a-z]/.test(name)) return { ok: false, error: "El nombre debe empezar con una letra." };
  if (name.length > 512) return { ok: false, error: "El nombre es demasiado largo." };

  const language = (input.language ?? "").trim() || "es";
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) {
    return { ok: false, error: "El idioma no es válido. Usa un código como es, es_MX o en_US." };
  }

  const category = upper(input.category);
  if (!(CREATABLE_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: "La categoría debe ser Utilidad o Marketing." };
  }

  const body = (input.body ?? "").trim();
  if (!body) return { ok: false, error: "Escribe el cuerpo de la plantilla." };
  if (body.length > TEMPLATE_BODY_MAX) {
    return { ok: false, error: `El cuerpo puede tener hasta ${TEMPLATE_BODY_MAX} caracteres.` };
  }

  const placeholders = extractPlaceholders(body);
  for (let i = 0; i < placeholders.length; i++) {
    if (placeholders[i] !== String(i + 1)) {
      return {
        ok: false,
        error: "Las variables deben ser {{1}}, {{2}}, {{3}}... en orden, sin saltarte ninguna.",
      };
    }
  }
  if (/^\s*\{\{[^}]*\}\}/.test(body) || /\{\{[^}]*\}\}\s*$/.test(body)) {
    return { ok: false, error: "El cuerpo no puede empezar ni terminar con una variable." };
  }

  const examples: string[] = [];
  for (let i = 0; i < placeholders.length; i++) {
    const example = (input.examples?.[i] ?? "").trim();
    if (!example) return { ok: false, error: `Escribe un ejemplo para la variable {{${i + 1}}}.` };
    examples.push(example);
  }

  return { ok: true, value: { name, language, category: category as TemplateCategory, body, examples } };
}

/** Componentes de Meta para una plantilla solo con cuerpo. */
export function buildCreateComponents(
  body: string,
  examples: readonly string[],
): Array<{ type: "body"; text: string; example?: { body_text: string[][] } }> {
  return [
    examples.length > 0
      ? { type: "body", text: body, example: { body_text: [[...examples]] } }
      : { type: "body", text: body },
  ];
}

/** Quita el prefijo y deja solo los dígitos de un teléfono para WhatsApp. */
export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D+/g, "");
}
