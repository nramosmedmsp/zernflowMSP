import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { scheduleBroadcastDelivery } from "@/lib/scheduler";
import { planBroadcast } from "@/lib/broadcasts/plan";
import { describeExclusions, loadBroadcastForPlan } from "@/lib/broadcasts/request";
import type { Json } from "@/lib/types/database";

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

  // Guardar el contenido que vino en la solicitud, ya normalizado.
  if (loaded.overrideContent) {
    await supabase
      .from("broadcasts")
      .update({ message_content: loaded.content as unknown as Json })
      .eq("id", broadcastId);
  }

  // Cliente de servicio: scheduled_jobs solo lo admite (el cron ejecuta esos
  // trabajos con la clave de servicio) y la selección lee mensajes y
  // conversaciones de todo el espacio. El administrador ya se validó arriba y
  // todo va acotado al espacio.
  const service = await createServiceClient();

  let plan;
  try {
    plan = await planBroadcast(service, workspaceId, loaded.content, loaded.filter);
  } catch (err) {
    console.error("[broadcasts/send] plan", err);
    return NextResponse.json({ error: "No se pudieron elegir los destinatarios de la difusión" }, { status: 500 });
  }

  if (plan.segmentTotal === 0) {
    return NextResponse.json({ error: "Ningún contacto cumple el filtro de segmento" }, { status: 400 });
  }
  if (plan.recipients.length === 0) {
    const why = describeExclusions(plan.excluded);
    return NextResponse.json(
      {
        error:
          plan.kind === "text"
            ? `Ningún contacto puede recibir un texto ahora${why.length ? ` (${why.join("; ")})` : ""}. Fuera de las 24 horas solo se pueden enviar plantillas de WhatsApp.`
            : `Ningún contacto puede recibir la plantilla${why.length ? ` (${why.join("; ")})` : ""}.`,
      },
      { status: 400 }
    );
  }

  // Crear broadcast_recipients (en lotes de 500).
  const recipientRows = plan.recipients.map((r) => ({
    broadcast_id: broadcastId,
    contact_id: r.contactId,
    channel_id: r.channelId,
    status: "pending",
  }));
  const recipientIds: string[] = [];
  for (let i = 0; i < recipientRows.length; i += 500) {
    const { data: inserted, error: insertErr } = await service
      .from("broadcast_recipients")
      .insert(recipientRows.slice(i, i + 500))
      .select("id");

    if (insertErr) {
      console.error("Failed to insert broadcast recipients:", insertErr);
      return NextResponse.json(
        { error: `No se pudieron crear los destinatarios: ${insertErr.message}` },
        { status: 500 }
      );
    }
    if (inserted) recipientIds.push(...inserted.map((r) => r.id));
  }

  if (recipientIds.length === 0) {
    return NextResponse.json({ error: "No se pudieron crear los destinatarios de la difusión" }, { status: 500 });
  }

  await scheduleBroadcastDelivery(service, broadcastId, recipientIds);

  return NextResponse.json({
    broadcastId,
    totalRecipients: recipientIds.length,
    excluded: plan.excluded,
    excludedTotal: plan.segmentTotal - plan.recipients.length,
    status: "sending",
  });
}
