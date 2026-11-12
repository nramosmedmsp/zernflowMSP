import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { recordCronEnd, recordCronStart } from "@/lib/cron-runs";
import { runRetention } from "@/lib/retention";

export const maxDuration = 60;

/**
 * GET /api/cron/retention con la cabecera Authorization: Bearer CRON_SECRET (una vez al día).
 *
 * Limpieza automática: notificaciones leídas y registros técnicos terminados con
 * más de 90 días (lib/retention.ts). Nunca toca chats, mensajes, gestiones,
 * notas, contactos ni el historial.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = await createServiceClient();
  await recordCronStart(supabase, "retention");
  const result = await runRetention(supabase);
  const error = result.errors.length > 0 ? result.errors.join("; ") : null;
  await recordCronEnd(supabase, "retention", {
    startedAt,
    error,
    stats: { ...result.deleted, capped: result.capped },
  });
  if (error) console.error("[retention]", error);
  return NextResponse.json({ ok: !error, deleted: result.deleted, capped: result.capped }, { status: error ? 500 : 200 });
}
