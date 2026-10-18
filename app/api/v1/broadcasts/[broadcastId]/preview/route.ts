import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { planBroadcast } from "@/lib/broadcasts/plan";
import { describeExclusions, loadBroadcastForPlan } from "@/lib/broadcasts/request";

/**
 * POST /api/v1/broadcasts/:broadcastId/preview
 *
 * Body opcional: { messageContent }. No envía nada: calcula cuántos contactos
 * recibirán la difusión y cuántos quedan fuera (ventana de 24 h cerrada, sin
 * conversación, sin teléfono de WhatsApp o con una variable vacía).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ broadcastId: string }> }
) {
  const { broadcastId } = await params;
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, workspaceId } = guard.ctx;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Sin cuerpo: se usa el contenido guardado.
  }

  const loaded = await loadBroadcastForPlan(supabase, workspaceId, broadcastId, body);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });

  try {
    // El cliente de servicio solo lee; el administrador ya se validó arriba y todo va acotado al espacio.
    const service = await createServiceClient();
    const plan = await planBroadcast(service, workspaceId, loaded.content, loaded.filter);
    return NextResponse.json({
      kind: plan.kind,
      segmentTotal: plan.segmentTotal,
      willReceive: plan.recipients.length,
      excludedTotal: plan.segmentTotal - plan.recipients.length,
      excluded: plan.excluded,
      excludedReasons: describeExclusions(plan.excluded),
    });
  } catch (err) {
    console.error("[broadcasts/preview]", err);
    return NextResponse.json({ error: "No se pudo calcular quién recibirá la difusión" }, { status: 500 });
  }
}
