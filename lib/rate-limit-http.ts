// Envoltorios de los topes de frecuencia para rutas de la API y acciones del
// servidor (SEG-01). El contador usa el cliente de servicio SIN el candado de
// "Ver como" (lib/supabase/server.ts, createRawServiceClient): ese candado
// bloquea toda escritura y el contador debe poder sumar siempre.

import { NextResponse } from "next/server";
import { createRawServiceClient } from "@/lib/supabase/server";
import { RATE_LIMIT_MESSAGE, checkRateLimit, type RateDecision, type RateRule } from "@/lib/rate-limit";

/** Respuesta 429 con mensaje claro y la cabecera Retry-After. */
export function rateLimitedResponse(retryAfterSeconds: number, message: string = RATE_LIMIT_MESSAGE): NextResponse {
  return NextResponse.json(
    { error: message, code: "rate_limited", retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}

/** Suma al contador. Un fallo al crear el cliente tampoco bloquea el trabajo. */
export async function rateLimitDecision(rateRule: RateRule, subject: string): Promise<RateDecision> {
  try {
    return await checkRateLimit(createRawServiceClient(), rateRule, subject);
  } catch (err) {
    console.error(`[rate-limit] no se pudo medir (${rateRule.name}), se deja pasar:`, err);
    return { allowed: true };
  }
}

/** Para rutas: devuelve la respuesta 429 si se pasó del tope, o null si puede seguir. */
export async function enforceRateLimit(rateRule: RateRule, subject: string): Promise<NextResponse | null> {
  const decision = await rateLimitDecision(rateRule, subject);
  return decision.allowed ? null : rateLimitedResponse(decision.retryAfterSeconds);
}
