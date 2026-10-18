// Variables por contacto de las plantillas de difusiones y secuencias:
// {nombre}, {fecha_clave}, {empresa} y {campo:slug}. Reusa el armado de la
// plantilla automática de las gestiones (misma validación: WhatsApp no acepta
// valores vacíos ni saltos de línea).

import { buildAutoTemplateParams } from "@/lib/cases/auto-template";
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
