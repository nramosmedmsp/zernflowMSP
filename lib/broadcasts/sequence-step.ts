// Qué enviar en un paso de secuencia (docs/FASE-2-TECNICO.md 5). Puro.
//
// Modos de un paso de mensaje:
// - Mensaje: `type: 'message'` sin plantilla. Solo sale con la ventana abierta.
// - Plantilla: `type: 'template'`. Sale siempre (también a contactos que nunca
//   escribieron), por teléfono.
// - Mensaje con plantilla alternativa: `type: 'message'` con `template`. Con la
//   ventana abierta sale el texto; con la ventana cerrada, la plantilla.

import type { SequenceStep, TemplateMessageContent } from "@/lib/types/database";
import { parseTemplateContent } from "./content";
import type { WindowState } from "./window";

export const NO_TEMPLATE_REASON = "Pasaron más de 24 horas y el paso no tiene plantilla";
export const NO_CONVERSATION_REASON = "El contacto no tiene una conversación en este canal y el paso no tiene plantilla";
export const NO_TEXT_REASON = "El paso no tiene texto";
export const INVALID_TEMPLATE_REASON = "El paso no tiene una plantilla válida";

export type StepDecision =
  | { action: "text"; text: string }
  | { action: "template"; template: TemplateMessageContent; viaFallback: boolean }
  | { action: "fail"; reason: string };

export function decideStepSend(step: Pick<SequenceStep, "type" | "content" | "template">, window: WindowState): StepDecision {
  const template = parseTemplateContent(step.template);

  if (step.type === "template") {
    return template ? { action: "template", template, viaFallback: false } : { action: "fail", reason: INVALID_TEMPLATE_REASON };
  }

  const text = (step.content ?? "").trim();
  if (window === "open") {
    if (text) return { action: "text", text };
    // Sin texto pero con plantilla alternativa: sale la plantilla.
    return template ? { action: "template", template, viaFallback: true } : { action: "fail", reason: NO_TEXT_REASON };
  }
  if (template) return { action: "template", template, viaFallback: true };
  return { action: "fail", reason: window === "closed" ? NO_TEMPLATE_REASON : NO_CONVERSATION_REASON };
}
