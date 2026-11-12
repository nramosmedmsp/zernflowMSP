// Deshacer un cambio de etapa (tarjeta de gestión). Lógica pura: la acción de
// servidor (changes.ts → undoStageChange) la usa con datos de la base.
//
// Qué dispara un cambio de etapa hoy (changeStage en changes.ts):
//  1. Reversible: `cases.stage_id` y la fila `stage_changed` del historial.
//  2. Reglas del tipo con disparador «al cambiar de etapa» (runEventRules):
//     pueden cambiar el tipo de contacto o programar otra gestión. No se revierten.
//  3. Flujos con el disparador «case_stage_changed» (emitStageChanged): corren
//     después de responder, pueden enviar mensajes al cliente. No se revierten.
// Deshacer solo restaura la etapa y deja constancia; NUNCA vuelve a disparar
// las reglas ni los flujos de «entrar» a la etapa restaurada (no se reenvían
// mensajes). Lo que el movimiento original ya disparó se avisa con claridad.

/** Cuánto tiempo ofrece la tarjeta «Deshacer». */
export const UNDO_WINDOW_MS = 10_000;
/** Holgura del servidor (latencia, reloj del navegador) además de la ventana. */
export const UNDO_GRACE_MS = 5_000;

export const UNDO_EXPIRED_MESSAGE = "Ya pasó el tiempo para deshacer este cambio.";
export const UNDO_NOT_YOURS_MESSAGE = "Solo quien movió la gestión puede deshacer el cambio.";
export const UNDO_CHANGED_MESSAGE = "Alguien más cambió la gestión después: ya no se puede deshacer.";
export const UNDO_NOTHING_MESSAGE = "No hay un cambio de etapa reciente para deshacer.";

/** Lo que disparó un cambio de etapa y no se puede revertir. */
export interface StageMoveEffects {
  /** Flujos publicados con el disparador «cambió de etapa» que coinciden con la nueva etapa. */
  flows: number;
  /** Una regla cambió el tipo de contacto. */
  contactTypeChanged: boolean;
  /** Gestiones que una regla programó o reprogramó. */
  scheduledCases: number;
}

export const NO_EFFECTS: StageMoveEffects = { flows: 0, contactTypeChanged: false, scheduledCases: 0 };

/**
 * Aviso de lo que Deshacer NO revierte, o null si el movimiento no disparó nada.
 * Se muestra junto al aviso «Pasó a …» para no prometer que todo se deshace.
 */
export function irreversibleNotice(effects: StageMoveEffects): string | null {
  const parts: string[] = [];
  if (effects.flows > 0) {
    parts.push(
      effects.flows === 1
        ? "Al entrar a este paso se activó 1 flujo automático que pudo enviarle mensajes al cliente"
        : `Al entrar a este paso se activaron ${effects.flows} flujos automáticos que pudieron enviarle mensajes al cliente`,
    );
  }
  if (effects.contactTypeChanged) parts.push("una regla cambió el tipo del contacto");
  if (effects.scheduledCases > 0) {
    parts.push(
      effects.scheduledCases === 1
        ? "una regla programó otra gestión"
        : `las reglas programaron ${effects.scheduledCases} gestiones`,
    );
  }
  if (parts.length === 0) return null;
  const [first, ...rest] = parts;
  const sentence = [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join("; ");
  return `${sentence}. Deshacer solo devuelve la etapa: eso no se revierte.`;
}

export interface UndoActivity {
  id: number | string;
  type: string;
  actor_id: string | null;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
}

/** Registros de una persona que no cambian la gestión (responder en el chat, pausar el bot). */
const NOT_A_CHANGE = new Set(["first_response", "human_reply", "automation_paused", "automation_resumed"]);

/**
 * ¿Se puede deshacer? `last` es el último movimiento registrado de la gestión
 * y `after` lo que se registró después de él. Reglas:
 *  - el último movimiento es un cambio de etapa (no un deshacer) de quien pide;
 *  - sigue dentro de la ventana (más la holgura);
 *  - la gestión sigue en la etapa a la que se movió;
 *  - ninguna persona hizo nada más en la gestión desde entonces (lo que
 *    registró el sistema, como los efectos de reglas o flujos, no cuenta).
 * Devuelve null si se puede, o el mensaje de por qué no.
 */
export function undoBlockReason(input: {
  last: UndoActivity | null;
  after: readonly Pick<UndoActivity, "actor_id" | "type">[];
  actorId: string;
  currentStageId: string | null;
  now: Date;
}): string | null {
  const { last } = input;
  if (!last || last.type !== "stage_changed" || !last.from_value) return UNDO_NOTHING_MESSAGE;
  if (last.actor_id !== input.actorId) return UNDO_NOT_YOURS_MESSAGE;
  const age = input.now.getTime() - new Date(last.created_at).getTime();
  if (!Number.isFinite(age) || age > UNDO_WINDOW_MS + UNDO_GRACE_MS) return UNDO_EXPIRED_MESSAGE;
  if (input.currentStageId !== last.to_value) return UNDO_CHANGED_MESSAGE;
  if (input.after.some((a) => a.actor_id !== null && !NOT_A_CHANGE.has(a.type))) return UNDO_CHANGED_MESSAGE;
  return null;
}

/** «Pasó a Asesorando». */
export function movedNoticeText(toName: string): string {
  return `Pasó a ${toName}`;
}

/** Mensaje tras deshacer: avisa lo que ya había pasado y no se devolvió. */
export function undoneMessage(fromName: string, irreversible: string | null): string {
  return irreversible ? `Volviste a ${fromName}. ${irreversible}` : `Volviste a ${fromName}.`;
}
