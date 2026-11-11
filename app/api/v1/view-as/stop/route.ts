import { NextResponse, type NextRequest } from "next/server";
import { rpcViewAsStop } from "@/lib/supabase/extra-rpc";
import { clearViewAsCookies, requireRealSession } from "@/lib/view-as/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/view-as/stop
 *
 * Cierra la vista de esta sesión (también la vencida) y quita el candado. Es la
 * única forma de salir del candado de una vista vencida. Es idempotente: sin
 * vista activa igual limpia las cookies. La interfaz debe recargar con una
 * navegación completa.
 */
export async function POST(request: NextRequest) {
  const guard = await requireRealSession(request, { checkOrigin: true });
  if (!guard.ok) return guard.response;
  const { viewerId, authSessionId, service } = guard.ctx;

  let stopped = false;
  if (authSessionId) {
    const result = await rpcViewAsStop(service, { viewer: viewerId, authSession: authSessionId });
    if (result.error) {
      console.error("[view-as/stop]", result.error);
      return NextResponse.json({ error: "No se pudo cerrar la vista. Inténtalo de nuevo." }, { status: 500 });
    }
    stopped = result.stopped;
  }
  const res = NextResponse.json({ ok: true, stopped }, { headers: { "Cache-Control": "no-store" } });
  clearViewAsCookies(res);
  return res;
}
