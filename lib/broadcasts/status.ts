// Estados de una difusión y su avance, en palabras claras para la pantalla.
// Puro (sin base ni React) para probarlo con vitest.

import { pluralize } from "@/lib/format";
import type { BroadcastPauseReason, BroadcastStatus } from "@/lib/types/database";

/** Cómo se llama cada estado en la pantalla. */
export const BROADCAST_STATUS_TEXT: Record<BroadcastStatus, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  sending: "Enviando",
  paused: "En pausa",
  completed: "Terminada",
  cancelled: "Cancelada",
};

export function broadcastStatusText(status: string): string {
  return BROADCAST_STATUS_TEXT[status as BroadcastStatus] ?? status;
}

/** Estados en los que la difusión todavía tiene trabajo por delante (la pantalla se actualiza sola). */
export function isBroadcastLive(status: string): boolean {
  return status === "sending" || status === "paused";
}

/** Estados desde los que se puede cancelar. */
export function canCancelBroadcast(status: string): boolean {
  return status === "sending" || status === "paused" || status === "scheduled";
}

/** Estados de los destinatarios, tal como se guardan. */
export type RecipientStatus = "pending" | "sending" | "sent" | "skipped" | "failed" | "cancelled";
export const RECIPIENT_STATUSES: readonly RecipientStatus[] = ["pending", "sending", "sent", "skipped", "failed", "cancelled"];

/** Cuántos destinatarios hay en cada estado. */
export interface BroadcastProgress {
  total: number;
  /** Aún no se les envió. */
  pending: number;
  /** En este momento se les está enviando. */
  sending: number;
  sent: number;
  /** Omitidos por baja o falta de consentimiento al momento de enviar. */
  skipped: number;
  failed: number;
  cancelled: number;
}

export function progressFromCounts(counts: Partial<Record<RecipientStatus, number>>): BroadcastProgress {
  const n = (k: RecipientStatus) => Math.max(0, counts[k] ?? 0);
  const p = {
    pending: n("pending"),
    sending: n("sending"),
    sent: n("sent"),
    skipped: n("skipped"),
    failed: n("failed"),
    cancelled: n("cancelled"),
  };
  return { ...p, total: p.pending + p.sending + p.sent + p.skipped + p.failed + p.cancelled };
}

/** Los que todavía no recibieron nada y siguen en la fila (pendientes y en envío). */
export function waitingCount(p: BroadcastProgress): number {
  return p.pending + p.sending;
}

/** Los que ya tienen un resultado final. */
export function doneCount(p: BroadcastProgress): number {
  return p.sent + p.skipped + p.failed + p.cancelled;
}

/** Avance de 0 a 100 (cuenta todo lo que ya no está esperando). */
export function progressPercent(p: BroadcastProgress): number {
  if (p.total <= 0) return 0;
  return Math.min(100, Math.floor((doneCount(p) / p.total) * 100));
}

/** Mensaje de la confirmación de «Cancelar difusión»: cuántos ya recibieron y cuántos no recibirán. */
export function cancelConfirmMessage(p: BroadcastProgress): string {
  const willNot = p.pending;
  const received = pluralize(p.sent, "contacto ya recibió", "contactos ya recibieron");
  if (willNot === 0) {
    return `${received} el mensaje. No quedan contactos por enviar, así que no cambiará nada para ellos. La difusión quedará como cancelada y no se podrá reanudar.`;
  }
  const lost = pluralize(willNot, "contacto no lo recibirá", "contactos no lo recibirán");
  return `${received} el mensaje y ${lost}. Lo ya enviado no se puede deshacer. La difusión quedará cancelada y no se podrá reanudar.`;
}

/** Resumen corto tras cancelar, con las cifras reales que devolvió el servidor. */
export function cancelledSummary(p: BroadcastProgress): string {
  return `Difusión cancelada. ${pluralize(p.sent, "contacto la recibió", "contactos la recibieron")} y ${pluralize(p.cancelled, "no la recibirá", "no la recibirán")}.`;
}

/** Texto de por qué está en pausa (el equipo lo ve junto al estado). */
export function pauseExplanation(reason: BroadcastPauseReason | string | null, note: string | null): string {
  if (reason === "auto_failures") {
    return note?.trim() || "Se pausó sola porque varios envíos seguidos fallaron. Revisa la conexión y reanúdala.";
  }
  return "La pausaste tú o alguien del equipo. Lo ya enviado queda enviado; al reanudar sigue con los pendientes.";
}
