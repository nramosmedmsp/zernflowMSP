import { NextResponse } from "next/server";
import { getHealth } from "@/lib/health";

// Latido público para un monitor externo (UptimeRobot, BetterStack...). Sin
// sesión y sin datos sensibles: ver lib/health.ts.
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * GET /api/health
 *   200 {"ok":true}                              base y tareas automáticas al día
 *   503 {"ok":false,"reason":"base"}             la base no responde (o la consulta falla)
 *   503 {"ok":false,"reason":"cron_jobs"}        /api/cron/jobs no terminó bien en los últimos 5 min
 *   503 {"ok":false,"reason":"cron_secuencias"}  ídem para /api/cron/sequences
 */
export async function GET() {
  const result = await getHealth();
  return NextResponse.json(result, {
    status: result.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
