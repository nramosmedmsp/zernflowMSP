// Parte pura de la respuesta fuera de horario: texto y cuándo toca enviarla.
// La usan off-hours.ts y el laboratorio de conversaciones.

import { formatOpening } from "@/lib/business-hours";
import { applyReplyVariables } from "@/lib/saved-replies";

const HOUR_MS = 3_600_000;

/**
 * Reemplaza {apertura} (próxima apertura, p. ej. "lunes 9:00") y las
 * variables de las respuestas guardadas: {nombre}, {empresa} y {sede}.
 */
export function renderOffHoursReply(
  text: string,
  vars: { contactName?: string | null; workspaceName?: string | null; teamName?: string | null; opening: Date | null; now: Date },
): string {
  const apertura = vars.opening ? formatOpening(vars.opening, vars.now) : "pronto";
  return applyReplyVariables(text.replace(/\{apertura\}/gi, apertura), {
    contactName: vars.contactName ?? undefined,
    workspaceName: vars.workspaceName ?? undefined,
    teamName: vars.teamName ?? undefined,
  }).trim();
}

/** ¿Toca enviar? (sin E/S): nunca enviada, o pasaron las horas mínimas. */
export function offHoursReplyDue(lastSentAt: string | null, minHoursBetween: number | null, at: string): boolean {
  if (!lastSentAt) return true;
  if (!minHoursBetween) return false;
  return new Date(at).getTime() - new Date(lastSentAt).getTime() >= minHoursBetween * HOUR_MS;
}
