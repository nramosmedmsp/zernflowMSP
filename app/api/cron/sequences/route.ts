import { isCronAuthorized } from "@/lib/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { recordCronEnd, recordCronStart } from "@/lib/cron-runs";
import { processSequenceSteps } from "@/lib/sequence-processor";

export const maxDuration = 60;

// No se empieza otro paso pasados 35 s: un envío a Zernio puede tardar hasta
// 20 s y la función debe terminar antes de los 60 s. Lo que quede espera a la
// siguiente pasada (las inscripciones siguen vencidas).
const START_LIMIT_MS = 35_000;

/**
 * Cron job handler that processes sequence enrollments.
 * Call via Vercel Cron or external cron every 30-60 seconds.
 * GET /api/cron/sequences con la cabecera Authorization: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = await createServiceClient();
  await recordCronStart(supabase, "sequences");

  try {
    const result = await processSequenceSteps({ deadline: startedAt + START_LIMIT_MS });
    await recordCronEnd(supabase, "sequences", { startedAt, stats: { ...result } });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Sequence cron failed:", err);
    await recordCronEnd(supabase, "sequences", {
      startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
