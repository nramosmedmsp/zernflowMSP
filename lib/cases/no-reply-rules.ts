// Parte pura de "cliente sin responder" (docs/FASE-2-TECNICO.md 3.6): minutos
// de un disparador, umbral que toca emitir y qué gestiones son candidatas. La
// usan no-reply.ts (el cron) y el laboratorio de conversaciones.

import { DEFAULT_NO_REPLY_MINUTES } from "@/lib/flow-engine/case-trigger-match";

/** Minutos de un disparador (config.minutes entero positivo, o el valor por defecto). */
export function noReplyMinutes(config: unknown): number {
  const raw =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>).minutes
      : undefined;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : DEFAULT_NO_REPLY_MINUTES;
}

/**
 * Umbral que toca emitir ahora (sin E/S): el menor umbral alcanzado que aún
 * no se emitió para este mensaje saliente, o null.
 */
export function nextNoReplyThreshold(params: {
  thresholds: readonly number[];
  lastOutboundAt: string;
  stampedOutboundAt: string | null;
  stampedMinutes: number | null;
  now: Date;
}): number | null {
  const out = new Date(params.lastOutboundAt).getTime();
  const sameMessage =
    params.stampedOutboundAt !== null && new Date(params.stampedOutboundAt).getTime() === out;
  const done = sameMessage ? (params.stampedMinutes ?? 0) : 0;
  const elapsed = (params.now.getTime() - out) / 60_000;
  const due = [...params.thresholds].sort((a, b) => a - b).find((t) => t > done && t <= elapsed);
  return due ?? null;
}

export interface NoReplyCaseLike {
  status: string;
  /** Se ignora: la espera del cliente no impide el aviso (ver isPendingNoReply). */
  waiting_since?: string | null;
  last_outbound_at: string | null;
  last_inbound_at: string | null;
  no_reply_event_outbound_at: string | null;
  no_reply_event_minutes: number | null;
}

/**
 * Candidatas a client_no_reply: lo mismo que filtra la función de la base
 * `cases_pending_no_reply` (migración 00022): abierta, con un mensaje saliente
 * (de bot o de persona) de `olderThan` o antes y posterior al último entrante,
 * y a la que aún le falta algún umbral (`maxMinutes` es el mayor). No mira
 * `waiting_since`: que el cliente espere una respuesta humana no impide avisar
 * de que no contestó el último mensaje que recibió.
 */
export function isPendingNoReply(row: NoReplyCaseLike, olderThan: Date, maxMinutes: number): boolean {
  if (row.status !== "open" || row.last_outbound_at === null) return false;
  const out = new Date(row.last_outbound_at).getTime();
  if (out > olderThan.getTime()) return false;
  if (row.last_inbound_at !== null && new Date(row.last_inbound_at).getTime() >= out) return false;
  const stamped = row.no_reply_event_outbound_at === null ? null : new Date(row.no_reply_event_outbound_at).getTime();
  return stamped !== out || (row.no_reply_event_minutes ?? 0) < maxMinutes;
}
