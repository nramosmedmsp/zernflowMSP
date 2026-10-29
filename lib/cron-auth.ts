// Autorización de las tareas automáticas (app/api/cron/*): la clave CRON_SECRET
// llega solo por la cabecera Authorization (así la manda Vercel). Ya no se
// acepta en la URL (?key=): quedaría en registros e historiales. Se compara en
// tiempo constante.

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function sameSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = header;
  return !!provided && sameSecret(provided, secret);
}
