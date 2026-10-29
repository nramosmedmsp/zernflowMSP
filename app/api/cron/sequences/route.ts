import { isCronAuthorized } from "@/lib/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { processSequenceSteps } from "@/lib/sequence-processor";

/**
 * Cron job handler that processes sequence enrollments.
 * Call via Vercel Cron or external cron every 30-60 seconds.
 * GET /api/cron/sequencescon la cabecera Authorization: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processSequenceSteps();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Sequence cron failed:", err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
