// Parte pura de la plantilla automática (la que arma sus variables): la usan
// auto-template.ts, los flujos, las difusiones y el laboratorio de
// conversaciones. Sin acceso a la base ni al servidor.

import { applyReplyVariables } from "@/lib/saved-replies";
import type { CaseTypeAutoTemplate } from "@/lib/types/database";
import { TEMPLATE_PARAM_MAX, sanitizeTemplateParam, type BuildParamsResult } from "@/lib/whatsapp-templates";
import { isDateString } from "./dates";

export const MAX_AUTO_TEMPLATE_PARAMS = 20;

/** case_types.auto_template normalizado, o null si no está o no sirve. */
export function parseAutoTemplate(raw: unknown): CaseTypeAutoTemplate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.template_name === "string" ? r.template_name.trim() : "";
  const language = typeof r.language === "string" ? r.language.trim() : "";
  if (!name || !language) return null;
  const params = Array.isArray(r.params) ? r.params.filter((p): p is string => typeof p === "string") : [];
  return { template_name: name, language, params: params.slice(0, MAX_AUTO_TEMPLATE_PARAMS) };
}

/** "2026-11-30" → "30/11/2026" (sin pasar por zonas horarias). */
export function formatKeyDate(value: string | null | undefined): string {
  if (!isDateString(value)) return "";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

export interface AutoTemplateVars {
  contactName?: string | null;
  keyDate?: string | null;
  workspaceName?: string | null;
  teamName?: string | null;
  agentName?: string | null;
  /** Campos personalizados por slug ({campo:slug}). */
  customFields?: Record<string, string>;
}

/**
 * Valores de la plantilla: reemplaza {nombre}, {fecha_clave}, {empresa},
 * {sede}, {asesor} y {campo:slug}. WhatsApp no acepta valores vacíos: si una
 * variable queda vacía, devuelve el error.
 */
export function buildAutoTemplateParams(template: CaseTypeAutoTemplate, vars: AutoTemplateVars): BuildParamsResult {
  const params: string[] = [];
  const keyDate = formatKeyDate(vars.keyDate);
  for (let i = 0; i < template.params.length; i++) {
    const raw = template.params[i];
    const replaced = applyReplyVariables(raw.replace(/\{fecha_clave\}/gi, keyDate), {
      contactName: vars.contactName ?? undefined,
      workspaceName: vars.workspaceName ?? undefined,
      teamName: vars.teamName ?? undefined,
      agentName: vars.agentName ?? undefined,
      customFields: vars.customFields,
    });
    const value = sanitizeTemplateParam(replaced);
    if (!value) return { ok: false, error: `La variable ${i + 1} de la plantilla ("${raw}") quedó vacía para este contacto.` };
    if (value.length > TEMPLATE_PARAM_MAX) return { ok: false, error: `La variable ${i + 1} de la plantilla es demasiado larga.` };
    params.push(value);
  }
  return { ok: true, params };
}
