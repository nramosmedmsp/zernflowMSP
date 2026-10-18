// Texto o plantilla en el nodo Enviar mensaje (docs/FASE-2-TECNICO.md 4).
// Puro: lo usan el motor y el simulador.

import { applyReplyVariables } from "@/lib/saved-replies";

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_NODE_TEMPLATE_PARAMS = 20;

/** Plantilla de WhatsApp configurada en un nodo (mismo formato que case_types.auto_template). */
export interface NodeTemplate {
  template_name: string;
  language: string;
  params: string[];
}

/** data.template del nodo normalizado, o null si falta el nombre o el idioma. */
export function parseNodeTemplate(raw: unknown): NodeTemplate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.template_name === "string" ? r.template_name.trim() : "";
  const language = typeof r.language === "string" ? r.language.trim() : "";
  if (!name || !language) return null;
  const params = Array.isArray(r.params) ? r.params.filter((p): p is string => typeof p === "string") : [];
  return { template_name: name, language, params: params.slice(0, MAX_NODE_TEMPLATE_PARAMS) };
}

/**
 * ¿Está abierta la ventana de 24 h de WhatsApp? Sin mensaje del cliente
 * (nunca escribió) está cerrada.
 */
export function isWindowOpen(lastInboundAt: string | null | undefined, now: Date | number = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  if (Number.isNaN(t)) return false;
  const at = typeof now === "number" ? now : now.getTime();
  return at - t <= WHATSAPP_WINDOW_MS;
}

export type SkipReason = "window_closed" | "no_content";

export type SendDecision = { mode: "text" } | { mode: "template" } | { mode: "skip"; reason: SkipReason };

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  window_closed: "La ventana de 24 h de WhatsApp está cerrada y el nodo no tiene una plantilla configurada.",
  no_content: "El nodo no tiene texto ni plantilla para enviar.",
};

/**
 * Qué enviar según la ventana de 24 h:
 * - ventana abierta y hay texto: texto;
 * - ventana cerrada y hay plantilla: plantilla;
 * - ventana cerrada y sin plantilla: no se envía (se registra el motivo).
 * Fuera de WhatsApp no hay ventana ni plantillas: solo texto.
 */
export function decideSendMode(input: {
  platform?: string | null;
  windowOpen: boolean;
  hasText: boolean;
  hasTemplate: boolean;
}): SendDecision {
  if (input.platform !== "whatsapp") {
    return input.hasText ? { mode: "text" } : { mode: "skip", reason: "no_content" };
  }
  if (input.windowOpen) {
    if (input.hasText) return { mode: "text" };
    return input.hasTemplate ? { mode: "template" } : { mode: "skip", reason: "no_content" };
  }
  return input.hasTemplate ? { mode: "template" } : { mode: "skip", reason: "window_closed" };
}

/** Valores de ejemplo para la vista previa de las variables en el simulador. */
export function previewTemplateParams(
  params: readonly string[],
  sample: { contactName?: string; keyDate?: string; workspaceName?: string } = {},
): string[] {
  return params.map((raw) =>
    applyReplyVariables(raw.replace(/\{fecha_clave\}/gi, sample.keyDate ?? "31/12/2026"), {
      contactName: sample.contactName ?? "Cliente de prueba",
      workspaceName: sample.workspaceName ?? "Mi empresa",
    }),
  );
}
