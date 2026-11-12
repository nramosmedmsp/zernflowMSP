import { isCronAuthorized } from "@/lib/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { MEDIA_RETENTION_DAYS, retentionCutoff } from "@/lib/chat-media";
import { removeObjects } from "@/lib/media-store";
import { recordCronEnd, recordCronStart } from "@/lib/cron-runs";
import { cleanOrphanUploads } from "@/lib/upload-tracking";
import { rateLimitPruneCutoff } from "@/lib/rate-limit";

export const maxDuration = 60;

const BATCH = 500;
const MAX_BATCHES = 10;

/**
 * GET /api/cron/media-cleanup con la cabecera Authorization: Bearer CRON_SECRET (una vez al día)
 *
 * Borra las fotos, PDF y audios de los chats que cumplieron 2 meses y los marca
 * como vencidos: el chat muestra "Archivo vencido". Los archivos de las
 * respuestas guardadas no vencen.
 *
 * Además (SEG-10 / SEG-01), en la misma pasada diaria:
 *   * borra del bucket los archivos subidos hace más de 48 h que nunca se
 *     enviaron ni se guardaron en una respuesta (lib/upload-tracking.ts);
 *   * poda los contadores de los topes de frecuencia ya vencidos.
 * Ambas tareas son secundarias: si fallan se registran y no tumban la limpieza
 * principal.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = await createServiceClient();
  await recordCronStart(supabase, "media_cleanup");
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
      await recordCronEnd(supabase, "media_cleanup", { startedAt, error: error.message });
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

  // Subidas que nadie envió (SEG-10). Nunca toca archivos de mensajes ni de respuestas.
  let orphanUploads: Awaited<ReturnType<typeof cleanOrphanUploads>> = null;
  try {
    orphanUploads = await cleanOrphanUploads(supabase);
  } catch (err) {
    console.error("[media-cleanup] subidas sin usar:", err);
  }

  // Contadores de frecuencia vencidos (SEG-01).
  try {
    const { error: pruneError } = await supabase.from("rate_limit_hits").delete().lt("window_start", rateLimitPruneCutoff());
    if (pruneError) console.error("[media-cleanup] poda de contadores:", pruneError.message);
  } catch (err) {
    console.error("[media-cleanup] poda de contadores:", err);
  }

  await recordCronEnd(supabase, "media_cleanup", {
    startedAt,
    stats: { expired, orphanUploadsRemoved: orphanUploads?.removed ?? 0, orphanUploadsFailed: orphanUploads?.failed ?? false },
  });
  return NextResponse.json({ ok: true, expired, cutoff, orphanUploadsRemoved: orphanUploads?.removed ?? 0 });
}
