import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { loadBroadcastProgress } from "@/lib/broadcasts/control";
import { serverError } from "@/lib/server-error";

/**
 * GET /api/v1/broadcasts/:broadcastId/progress
 *
 * El estado y el avance real de una difusión (cuántos recibieron, cuántos faltan,
 * omitidos, fallidos y cancelados). La pantalla lo consulta sola mientras la
 * difusión envía. Lee con el cliente de la persona: las políticas de la base
 * limitan lo que ve a su espacio.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ broadcastId: string }> }) {
  const { broadcastId } = await params;
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, workspaceId } = guard.ctx;

  const { data: broadcast, error } = await supabase
    .from("broadcasts")
    .select("id, status, sent, delivered, failed, total_recipients, paused_reason, pause_note, paused_at")
    .eq("id", broadcastId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) return serverError("broadcasts/progress", error, "No se pudo cargar el avance de la difusión.");
  if (!broadcast) return NextResponse.json({ error: "No se encontró la difusión" }, { status: 404 });

  const progress = await loadBroadcastProgress(supabase, broadcastId);
  if (!progress) return NextResponse.json({ error: "No se pudo cargar el avance de la difusión." }, { status: 500 });
  return NextResponse.json({ broadcast, progress });
}
