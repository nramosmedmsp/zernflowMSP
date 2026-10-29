// Variables por contacto de las plantillas de difusiones y secuencias:
// {nombre}, {fecha_clave}, {empresa} y {campo:slug}. Reusa el armado de la
// plantilla automática de las gestiones (misma validación: WhatsApp no acepta
// valores vacíos ni saltos de línea).

import { buildAutoTemplateParams, formatKeyDate } from "@/lib/cases/auto-template-params";
import { applyReplyVariablesDetailed } from "@/lib/saved-replies";
import { suggestFirstParam, type BuildParamsResult } from "@/lib/whatsapp-templates";

export interface ContactTemplateVars {
  displayName: string | null | undefined;
  keyDate: string | null | undefined;
  workspaceName: string | null | undefined;
  customFields?: Record<string, string>;
}

/** ¿Alguna variable pide campos personalizados? (para no leerlos si no hacen falta) */
export function needsCustomFields(params: readonly string[]): boolean {
  return params.some((p) => p.toLowerCase().includes("{campo:"));
}

/**
 * Valores de la plantilla para un contacto. `{nombre}` es el primer nombre si
 * el nombre parece de persona (no un teléfono ni un correo); si no, queda
 * vacío y el contacto no recibe la plantilla (error claro en español).
 */
export function buildContactTemplateParams(
  template: { params: readonly string[] },
  vars: ContactTemplateVars,
): BuildParamsResult {
  const built = buildContactTemplateParamsRaw(template, vars);
  if (!built.ok) return built;
  // Una llave que no es variable conocida ("{precio}", "{{1}}") saldría tal cual al cliente.
  for (let i = 0; i < built.params.length; i++) {
    const left = leftoverVariables(built.params[i]);
    if (left.length > 0) {
      return { ok: false, error: `La variable ${i + 1} de la plantilla tiene ${left.join(", ")}, que no es una variable conocida.` };
    }
  }
  return built;
}

function buildContactTemplateParamsRaw(
  template: { params: readonly string[] },
  vars: ContactTemplateVars,
): BuildParamsResult {
  return buildAutoTemplateParams(
    { template_name: "", language: "", params: [...template.params] },
    {
      contactName: suggestFirstParam(vars.displayName),
      keyDate: vars.keyDate,
      workspaceName: vars.workspaceName,
      customFields: vars.customFields,
    },
  );
}

const LEFTOVER_RE = /\{\{[^{}]*\}\}|\{[a-z_][a-z0-9_:-]*\}/gi;

/** Llaves que quedaron en un texto ya armado ("{precio}", "{{1}}"): el cliente las vería tal cual. */
export function leftoverVariables(text: string): string[] {
  return [...new Set(text.match(LEFTOVER_RE) ?? [])];
}

export type RenderedText = { ok: true; text: string } | { ok: false; error: string };

/**
 * Texto de una difusión o de un paso de secuencia para un contacto, con sus
 * variables ({nombre}, {fecha_clave}, {empresa}, {campo:slug}...) ya puestas.
 * Falla (el contacto no recibe nada) si el texto queda vacío, si una variable
 * queda vacía para ese contacto o si queda una llave que no es una variable.
 */
export function renderContactText(text: string, vars: ContactTemplateVars): RenderedText {
  const keyDate = formatKeyDate(vars.keyDate);
  const missing: string[] = [];
  if (!keyDate && /\{fecha_clave\}/i.test(text)) missing.push("{fecha_clave}");
  const { text: replaced, empty } = applyReplyVariablesDetailed(text.replace(/\{fecha_clave\}/gi, keyDate), {
    contactName: suggestFirstParam(vars.displayName) || undefined,
    workspaceName: vars.workspaceName ?? undefined,
    customFields: vars.customFields,
  });
  missing.push(...empty);
  if (missing.length > 0) {
    return { ok: false, error: `La variable ${[...new Set(missing)].join(", ")} está vacía para este contacto.` };
  }
  const result = replaced.trim();
  if (!result) return { ok: false, error: "El mensaje está vacío." };
  const left = leftoverVariables(result);
  if (left.length > 0) return { ok: false, error: `El mensaje tiene ${left.join(", ")}, que no es una variable conocida.` };
  return { ok: true, text: result };
}
