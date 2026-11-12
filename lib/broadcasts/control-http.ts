// Parte común de las rutas de pausar, reanudar y cancelar una difusión:
// permiso en el servidor (Dueño o Administrador, igual que para lanzarla),
// candado de «Ver como» y respuesta en español.

import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { VIEW_AS_READ_ONLY_MESSAGE } from "@/lib/view-as/guard";
import { isViewAsLocked, markReadOnlyHit } from "@/lib/view-as/lock";
import { cancelBroadcast, pauseBroadcast, resumeBroadcast, type ControlOutcome, type ControlParams } from "./control";

export type ControlAction = "pause" | "resume" | "cancel";

const RUN: Record<ControlAction, (db: Awaited<ReturnType<typeof createServiceClient>>, p: ControlParams) => Promise<ControlOutcome>> = {
  pause: pauseBroadcast,
  resume: resumeBroadcast,
  cancel: cancelBroadcast,
};

export async function handleBroadcastControl(action: ControlAction, broadcastId: string): Promise<NextResponse> {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  // «Ver como» es solo lectura: la acción no se ejecuta (el candado de las demás capas también la frenaría).
  if (await isViewAsLocked()) {
    await markReadOnlyHit();
    return NextResponse.json({ error: VIEW_AS_READ_ONLY_MESSAGE }, { status: 403 });
  }

  // Cliente de servicio: cancelar toca miles de destinatarios y el registro; el permiso ya se validó arriba
  // y todo va acotado al espacio de la persona.
  const service = await createServiceClient();
  const result = await RUN[action](service, { workspaceId: guard.ctx.workspaceId, broadcastId, actorId: guard.ctx.user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ broadcastId, status: result.status, changed: result.changed, progress: result.progress });
}
