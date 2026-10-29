/**
 * Zernio API client.
 *
 * Thin wrapper around the official @zernio/node SDK.
 * All endpoints are auto-generated from the OpenAPI spec.
 */

import Zernio from "@zernio/node";

export type { Zernio };

/**
 * Tiempo máximo de cada llamada. El SDK espera 5 minutos por defecto: un envío
 * colgado dejaría sin respuesta al webhook o al cron (límite de 60 s).
 */
export const ZERNIO_TIMEOUT_MS = 20_000;

export function createZernioClient(apiKey: string, options: { timeoutMs?: number } = {}): Zernio {
  return new Zernio({ apiKey, timeout: options.timeoutMs ?? ZERNIO_TIMEOUT_MS });
}
