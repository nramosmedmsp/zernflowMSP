import { NextResponse, type NextRequest } from "next/server";
import { rpcViewAsStart } from "@/lib/supabase/extra-rpc";
import { VIEW_AS_COOKIE, VIEW_AS_HIT_COOKIE, formatViewAsCookie, viewAsCookieOptions } from "@/lib/view-as/cookie";
import { parseViewAsInfo, parseViewAsStartBody, viewAsStartErrorMessage } from "@/lib/view-as/rules";
import { requireRealOwner } from "@/lib/view-as/service";
import { enforceRateLimit } from "@/lib/rate-limit-http";
import { RATE_RULES } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/view-as/start  { kind: "person", userId } | { kind: "role", role, teamId? }
 *
 * Solo el Dueño. Abre una vista de solo lectura de 30 minutos atada a esta
 * sesión de Auth (la comprobación vive en la base: view_as_start) y deja la
 * cookie de candado. La interfaz debe recargar con una navegación completa.
 */
export async function POST(request: NextRequest) {
  const guard = await requireRealOwner(request, { checkOrigin: true });
  if (!guard.ok) return guard.response;
  const { viewerId, authSessionId, workspaceId, service } = guard.ctx;
  // SEG-01: tope de vistas iniciadas por el Dueño.
  const limited = await enforceRateLimit(RATE_RULES.viewAsStart, viewerId);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = parseViewAsStartBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const t = parsed.target;

  const { data, error } = await rpcViewAsStart(service, {
    viewer: viewerId,
    authSession: authSessionId,
    workspace: workspaceId,
    kind: t.kind,
    targetUser: t.kind === "person" ? t.userId : null,
    role: t.kind === "role" ? t.role : null,
    team: t.kind === "role" && t.role !== "admin" ? t.teamId : null,
  });
  if (error) {
    const forbidden = error.includes("view_as_not_owner") || error.includes("view_as_foreign_workspace");
    return NextResponse.json({ error: viewAsStartErrorMessage(error) }, { status: forbidden ? 403 : 400 });
  }
  const info = parseViewAsInfo(data);
  if (!info) return NextResponse.json({ error: "No se pudo iniciar la vista." }, { status: 500 });

  const exp = new Date(info.expiresAt).getTime();
  const res = NextResponse.json({ ok: true, view: info }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(
    VIEW_AS_COOKIE,
    formatViewAsCookie({ sid: info.sessionId, viewer: viewerId, exp }),
    viewAsCookieOptions(exp, Date.now(), process.env.NODE_ENV === "production"),
  );
  res.cookies.set(VIEW_AS_HIT_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
