// Contenido de una difusión (broadcasts.message_content) y de las plantillas
// de los pasos de secuencia. Puro: se usa en el servidor y en la interfaz.

import type { TemplateMessageContent } from "@/lib/types/database";

export const MAX_TEMPLATE_PARAMS = 20;
export const MAX_TEXT_LENGTH = 4096;

export type ParsedBroadcastContent = { kind: "text"; text: string } | TemplateMessageContent;

/** Plantilla normalizada (`kind: 'template'`), o null si falta el nombre o el idioma. */
export function parseTemplateContent(raw: unknown): TemplateMessageContent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.template_name === "string" ? r.template_name.trim() : "";
  const language = typeof r.language === "string" ? r.language.trim() : "";
  if (!name || !language) return null;
  const params = Array.isArray(r.params) ? r.params.filter((p): p is string => typeof p === "string") : [];
  return { kind: "template", template_name: name, language, params: params.slice(0, MAX_TEMPLATE_PARAMS) };
}

/**
 * Lee el contenido de una difusión: `{ kind: 'template', ... }` o texto (la
 * fase 1 guardaba `{ text }` sin `kind`). null si está vacío o no sirve.
 */
export function parseBroadcastContent(raw: unknown): ParsedBroadcastContent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "template") return parseTemplateContent(r);
  const text = typeof r.text === "string" ? r.text.trim() : "";
  if (!text || text.length > MAX_TEXT_LENGTH) return null;
  return { kind: "text", text };
}
