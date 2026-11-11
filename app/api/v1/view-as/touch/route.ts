import { NextResponse, type NextRequest } from "next/server";
import { rpcViewAsTouch } from "@/lib/supabase/extra-rpc";
import { viewAsSectionForPath } from "@/lib/view-as/rules";
import { requireRealSession } from "@/lib/view-as/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/view-as/touch  { path?: "/dashboard/inbox" }
 *
 * Marca actividad y registra la sección abierta (la ruta se traduce con una
 * lista fija; nunca se guarda la ruta cruda). Responde si la vista sigue
 * activa y cuándo caduca.
 */
export async function POST(request: NextRequest) {
  const guard = await requireRealSession(request, { checkOrigin: true });
  if (!guard.ok) return guard.response;
  const { viewerId, authSessionId, service } = guard.ctx;
  if (!authSessionId) return NextResponse.json({ active: false, expiresAt: null });

  const body = (await request.json().catch(() => ({}))) as { path?: unknown };
  const { expiresAt, error } = await rpcViewAsTouch(service, {
    viewer: viewerId,
    authSession: authSessionId,
    section: viewAsSectionForPath(body?.path),
  });
  if (error) {
    console.error("[view-as/touch]", error);
    return NextResponse.json({ error: "No se pudo actualizar la vista." }, { status: 500 });
  }
  return NextResponse.json({ active: !!expiresAt, expiresAt }, { headers: { "Cache-Control": "no-store" } });
}
