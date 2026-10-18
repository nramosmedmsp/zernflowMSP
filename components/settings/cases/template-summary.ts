// Resumen de las plantillas de negocio para la interfaz. Solo se importa desde
// páginas de servidor: `lib/business-templates.ts` tiene una importación
// dinámica del cliente de servicio que no debe entrar al código del navegador.

import { BUSINESS_TEMPLATES, BUSINESS_TEMPLATE_KEYS } from "@/lib/business-templates";
import type { BusinessTemplate, StageKind } from "@/lib/types/database";

export interface TemplateSummary {
  key: BusinessTemplate;
  name: string;
  description: string;
  contactTypes: string[];
  caseTypes: {
    name: string;
    color: string;
    isProactive: boolean;
    stages: { name: string; kind: StageKind }[];
    categories: string[];
    reasons: string[];
    rules: number;
  }[];
}

export function summarizeTemplates(): TemplateSummary[] {
  return BUSINESS_TEMPLATE_KEYS.map((key) => {
    const def = BUSINESS_TEMPLATES[key];
    return {
      key,
      name: def.name,
      description: def.description,
      contactTypes: def.contactTypes.map((c) => c.name),
      caseTypes: def.caseTypes.map((t) => ({
        name: t.name,
        color: t.color,
        isProactive: t.isProactive === true,
        stages: t.stages.map((s) => ({ name: s.name, kind: s.kind })),
        categories: (t.categories ?? []).map((c) => c.name),
        reasons: (t.reasons ?? []).map((r) => r.name),
        rules: (t.rules ?? []).length,
      })),
    };
  });
}
