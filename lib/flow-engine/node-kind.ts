// Tipo efectivo de un nodo del lienzo. Lo comparten el motor y el simulador.

import { CASE_ACTION_TYPES } from "./types";

/**
 * Tipos que el lienzo guarda como nodo `action` con `data.actionType`
 * (etiquetas, campo personalizado, HTTP, suscripción, secuencia, A/B...).
 */
export const CANVAS_ACTION_KINDS: readonly string[] = [
  "addTag",
  "removeTag",
  "setCustomField",
  "httpRequest",
  "goToFlow",
  "humanTakeover",
  "subscribe",
  "unsubscribe",
  "abSplit",
  "smartDelay",
  "enrollSequence",
];

/**
 * El lienzo guarda todas las acciones (y las gestiones) como nodo `action` con
 * `data.actionType`; aquí se resuelve a ese tipo. Los nodos con `type` propio
 * (formato antiguo) se ejecutan igual que antes.
 */
export function nodeKind(node: { type?: string; data?: unknown }): string {
  const type = (node.type as string) ?? "unknown";
  if (type === "action") {
    const actionType = (node.data as { actionType?: string } | undefined)?.actionType;
    if (
      actionType &&
      ((CASE_ACTION_TYPES as readonly string[]).includes(actionType) || CANVAS_ACTION_KINDS.includes(actionType))
    ) {
      return actionType;
    }
  }
  return type;
}
