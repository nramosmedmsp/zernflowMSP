import { isCronAuthorized } from "@/lib/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { MEDIA_RETENTION_DAYS, retentionCutoff } from "@/lib/chat-media";
import { removeObjects } from "@/lib/media-store";

export const maxDuration = 60;

const BATCH = 500;
const MAX_BATCHES = 10;

/**
 * GET /api/cron/media-cleanupcon la cabecera Authorization: Bearer CRON_SECRET (una vez al día)
 *
 * Borra las fotos, PDF y audios de los chats que cumplieron 2 meses y los marca
 * como vencidos: el chat muestra "Archivo vencido". Los archivos de las
 * respuestas guardadas no vencen.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const cutoff = retentionCutoff(new Date(), MEDIA_RETENTION_DAYS);
  let expired = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data: rows, error } = await supabase
      .from("message_media")
      .select("id, storage_path")
      .eq("status", "stored")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (error) {
      console.error("[media-cleanup] select", error.message);
      return NextResponse.json({ error: "No se pudo leer los archivos" }, { status: 500 });
    }
    if (!rows || rows.length === 0) break;

    const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
    // Si el almacenamiento falla, no se marcan: se reintenta mañana.
    if (!(await removeObjects(supabase, paths))) break;

    const { error: updateError } = await supabase
      .from("message_media")
      .update({ status: "expired", storage_path: null })
      .in(
        "id",
        rows.map((r) => r.id),
      );
    if (updateError) {
      console.error("[media-cleanup] update", updateError.message);
      break;
    }
    expired += rows.length;
    if (rows.length < BATCH) break;
  }

  return NextResponse.json({ ok: true, expired, cutoff });
}
