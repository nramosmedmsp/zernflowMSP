// SEG-13: un error interno (Postgres, Zernio, excepciones) nunca llega al
// navegador. El detalle se queda en el log del servidor y la persona recibe un
// texto genérico en español.

import { NextResponse } from "next/server";

/** Texto por defecto cuando no se pasa uno más concreto. */
export const GENERIC_SERVER_ERROR = "No se pudo completar la operación. Inténtalo de nuevo.";

/** Registra el detalle (con una etiqueta de dónde pasó) y responde con `message`. */
export function serverError(
  tag: string,
  detail: unknown,
  message: string = GENERIC_SERVER_ERROR,
  status: number = 500,
): NextResponse {
  console.error(`[${tag}]`, detail);
  return NextResponse.json({ error: message }, { status });
}
