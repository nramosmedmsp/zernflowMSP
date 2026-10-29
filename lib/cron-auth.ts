// Autorización de las tareas automáticas (app/api/cron/*): la clave CRON_SECRET
// llega por la cabecera Authorization (así la manda Vercel) o, para
// programadores externos, en ?key=. Se compara en tiempo constante.

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
  const provided = request.nextUrl.searchParams.get("key") || header;
  return !!provided && sameSecret(provided, secret);
}
