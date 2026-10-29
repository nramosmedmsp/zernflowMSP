import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { launchBroadcast } from "@/lib/broadcasts/launch";
import { loadBroadcastForPlan } from "@/lib/broadcasts/request";

/**
 * POST /api/v1/broadcasts/:broadcastId/send
 *
 * Elige los destinatarios según el tipo de difusión (texto: solo contactos con
 * la ventana de 24 h abierta; plantilla: cualquier contacto con teléfono de
 * WhatsApp), crea broadcast_recipients y programa los envíos. El cron envía
 * cada uno (app/api/cron/jobs/route.ts).
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
    // Sin cuerpo o JSON inválido: se usa el contenido guardado.
  }

  const loaded = await loadBroadcastForPlan(supabase, workspaceId, broadcastId, body);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });

  // Cliente de servicio: scheduled_jobs solo lo admite (el cron ejecuta esos
  // trabajos con la clave de servicio) y la selección lee mensajes y
  // conversaciones de todo el espacio. El administrador ya se validó arriba y
  // todo va acotado al espacio.
  const service = await createServiceClient();

  const result = await launchBroadcast(service, {
    workspaceId,
    broadcastId,
    previousStatus: loaded.broadcast.status === "scheduled" ? "scheduled" : "draft",
    content: loaded.content,
    overrideContent: loaded.overrideContent,
    filter: loaded.filter,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    broadcastId,
    totalRecipients: result.totalRecipients,
    excluded: result.excluded,
    excludedTotal: result.excludedTotal,
    status: "sending",
  });
}
