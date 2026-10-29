// Pasos de secuencia: ids estables, posición de una inscripción y cuándo toca el
// siguiente paso (respetando el horario de atención). Puro, probado con vitest.

import { isWithinHours, nextOpening, type BusinessHours } from "@/lib/business-hours";
import type { SequenceStep } from "@/lib/types/database";

export interface StepSchedule {
  hours: BusinessHours | null;
  holidays: ReadonlySet<string>;
}

/** Si no hay próxima apertura calculable (todo feriado), se reintenta en este tiempo. */
const NO_OPENING_RETRY_MS = 6 * 60 * 60 * 1000;

/** Prefijo con el que los mensajes de una secuencia marcan su origen en messages.sent_by_node_id. */
export const SEQUENCE_ORIGIN_PREFIX = "sequence:";

/** Da un id a cada paso que no lo tenga (o lo repita); conserva los existentes. */
export function ensureStepIds(steps: readonly SequenceStep[], genId: () => string = () => crypto.randomUUID()): SequenceStep[] {
  const seen = new Set<string>();
  return steps.map((step) => {
    let id = typeof step.id === "string" && step.id.trim() ? step.id : "";
    if (!id || seen.has(id)) id = genId();
    seen.add(id);
    return { ...step, id };
  });
}

/**
 * Posición del paso que le toca a una inscripción. Con el id guardado, sigue al
 * paso aunque lo hayan movido; si ese paso ya no existe (lo borraron) o la
 * inscripción es anterior a los ids, usa el número guardado, sin pasarse del final.
 */
export function resolveStepIndex(
  steps: readonly SequenceStep[],
  enrollment: { current_step_id?: string | null; current_step_index: number },
): number {
  if (enrollment.current_step_id) {
    const found = steps.findIndex((s) => s.id === enrollment.current_step_id);
    if (found >= 0) return found;
  }
  return Math.min(Math.max(0, enrollment.current_step_index), steps.length);
}

/** ¿El paso manda algo al cliente (y por eso solo debe salir en horario de atención)? */
export function isSendStep(step: Pick<SequenceStep, "type">): boolean {
  return step.type === "message" || step.type === "template";
}

/** Primer momento en que se puede enviar, a partir de `from` (ahora si ya se atiende). */
export function nextSendTime(from: Date, schedule: StepSchedule | null): Date {
  if (!schedule) return from;
  if (isWithinHours(from, schedule.hours, schedule.holidays)) return from;
  return nextOpening(from, schedule.hours, schedule.holidays) ?? new Date(from.getTime() + NO_OPENING_RETRY_MS);
}

/**
 * Cuándo toca un paso que empieza a esperarse en `now`: una espera dura sus
 * minutos de reloj; un paso que envía sale ahora o, fuera de horario, en la
 * siguiente hora hábil.
 */
export function stepDueAt(step: SequenceStep | undefined, now: Date, schedule: StepSchedule | null): Date {
  if (step && step.type === "delay" && step.delayMinutes) return new Date(now.getTime() + step.delayMinutes * 60_000);
  return nextSendTime(now, schedule);
}
