// Qué enviar en un paso de secuencia (docs/FASE-2-TECNICO.md 5). Puro.
//
// Modos de un paso de mensaje:
// - Mensaje: `type: 'message'` sin plantilla. Solo sale con la ventana abierta.
// - Plantilla: `type: 'template'`. Sale siempre (también a contactos que nunca
//   escribieron), por teléfono.
// - Mensaje con plantilla alternativa: `type: 'message'` con `template`. Con la
//   ventana abierta sale el texto; con la ventana cerrada, la plantilla.

import type { SequenceStep, TemplateMessageContent } from "@/lib/types/database";
import { MAX_TEXT_LENGTH, parseTemplateContent } from "./content";
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

/**
 * Revisión de los pasos de una secuencia antes de activarla (pantalla y
 * servidor): al menos un paso de mensaje, cada mensaje con texto o plantilla
 * y cada espera con minutos. Devuelve el primer problema en español, o null.
 */
export function validateSequenceSteps(steps: readonly SequenceStep[]): string | null {
  if (!steps.some((s) => s.type === "message" || s.type === "template")) {
    return "Agrega al menos un paso de mensaje o de plantilla antes de activar la secuencia.";
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const n = i + 1;
    if (step.type === "delay") {
      if (!Number.isFinite(step.delayMinutes) || (step.delayMinutes ?? 0) < 1) {
        return `El paso ${n} es una espera: indica cuánto tiempo esperar.`;
      }
      continue;
    }
    if (step.type === "template") {
      if (!parseTemplateContent(step.template)) return `El paso ${n} es de plantilla: elige una plantilla aprobada.`;
      continue;
    }
    if (step.type !== "message") return `El paso ${n} no es válido.`;
    const text = (step.content ?? "").trim();
    if (!text && !parseTemplateContent(step.template)) return `El paso ${n} no tiene texto: escribe el mensaje.`;
    if (text.length > MAX_TEXT_LENGTH) return `El paso ${n} es demasiado largo (máximo ${MAX_TEXT_LENGTH} caracteres).`;
  }
  return null;
}
