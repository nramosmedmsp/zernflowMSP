// Ventana de 24 h de respuesta (WhatsApp, Instagram, Messenger): solo se puede
// escribir texto libre dentro de las 24 h siguientes al último mensaje del
// contacto; fuera de ella solo se aceptan plantillas aprobadas.

export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Estado de la ventana de un contacto en un canal. */
export type WindowState = "open" | "closed" | "no_conversation";

function toTime(value: Date | number | string): number {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
}

/** ¿El último mensaje entrante es de hace menos de 24 h? Sin mensaje entrante, la ventana está cerrada. */
export function isWindowOpen(lastInboundAt: string | null | undefined, now: Date | number): boolean {
  if (!lastInboundAt) return false;
  const t = toTime(lastInboundAt);
  if (Number.isNaN(t)) return false;
  return toTime(now) - t <= REPLY_WINDOW_MS;
}

/** Instante más antiguo cuyo mensaje entrante todavía abre la ventana. */
export function windowCutoffIso(now: Date | number): string {
  return new Date(toTime(now) - REPLY_WINDOW_MS).toISOString();
}

export const CLOSED_WINDOW_MESSAGE = "Pasaron más de 24 horas desde el último mensaje del contacto";
