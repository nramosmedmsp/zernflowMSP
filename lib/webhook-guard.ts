// Protección del webhook de Zernio contra reenvíos viejos (SEG-03).
//
// Qué trae firmado el cuerpo (node_modules/@zernio/node, tipos WebhookPayload*):
//   * `id`: "ID estable del evento", el mismo en todos los reintentos y
//     reenvíos del mismo evento (la cabecera X-Zernio-Event-Id repite ese valor
//     pero la cabecera NO va firmada: la firma HMAC cubre solo el cuerpo).
//   * `timestamp`: "UTC en que Zernio generó el evento; los reintentos y
//     reenvíos conservan el valor original" (refleja el evento, no el intento).
// Por eso: el id sale SOLO del cuerpo firmado (si falta, se deriva de un hash
// del cuerpo) y la edad se mide con `timestamp`.
//
// Margen elegido: 36 horas. La anti-repetición (webhook_events, estado
// "processed") se conserva 48 horas (PROCESSED_RETENTION_MS en
// lib/inbound-events.ts), así que cualquier evento admitido sigue estando en esa
// memoria: un reenvío del mismo evento siempre se reconoce como duplicado, y uno
// más viejo que el margen ya no se podría reconocer y se descarta. Las 12 horas
// de diferencia absorben la poda y los relojes. 36 horas cubren de sobra los
// reintentos normales de Zernio (minutos u horas) y una caída nuestra de varias
// horas; solo se descarta lo que ya no es un reintento sino un reenvío viejo.

import { createHash } from "node:crypto";

export const WEBHOOK_MAX_EVENT_AGE_MS = 36 * 60 * 60 * 1000;
/** Un evento "del futuro" solo se tolera por diferencia de relojes. */
export const WEBHOOK_MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

const MAX_ID_LENGTH = 200;

export interface WebhookEventKey {
  id: string;
  /** true cuando el cuerpo no traía `id` y se derivó del cuerpo firmado. */
  derived: boolean;
}

/** Hash corto y estable del cuerpo recibido (ya verificado o por verificar). */
export function bodyHash(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

/**
 * Identificador del evento. Usa el `id` del cuerpo; nunca una cabecera. Un id
 * vacío, no textual o con caracteres de control se trata como ausente.
 */
export function webhookEventKey(parsed: { id?: unknown }, rawBody: string): WebhookEventKey {
  const raw = typeof parsed.id === "string" ? parsed.id.trim() : "";
  if (raw && raw.length <= MAX_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(raw)) {
    return { id: raw, derived: false };
  }
  return { id: `body:${bodyHash(rawBody)}`, derived: true };
}

export type EventAge =
  | { status: "fresh" }
  /** Sin fecha utilizable: no se puede juzgar la edad; queda la anti-repetición. */
  | { status: "unknown" }
  | { status: "stale"; ageMs: number }
  | { status: "future"; aheadMs: number };

/** ¿El evento (según el `timestamp` firmado del cuerpo) es lo bastante reciente para procesarse? */
export function checkEventAge(timestamp: unknown, now: Date = new Date()): EventAge {
  if (typeof timestamp !== "string" || !timestamp.trim()) return { status: "unknown" };
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at)) return { status: "unknown" };
  const age = now.getTime() - at;
  if (age > WEBHOOK_MAX_EVENT_AGE_MS) return { status: "stale", ageMs: age };
  if (age < -WEBHOOK_MAX_FUTURE_SKEW_MS) return { status: "future", aheadMs: -age };
  return { status: "fresh" };
}
