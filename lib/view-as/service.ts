// Servidor de "Ver como": comprobaciones y acciones de las rutas
// /api/v1/view-as/*. Usa la identidad REAL (nunca la efectiva) y el cliente de
// servicio sin candado, porque estas rutas escriben el registro mientras la
// vista está activa.

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient, createRawServiceClient } from "@/lib/supabase/server";
import { WORKSPACE_COOKIE } from "@/lib/workspace";
import { VIEW_AS_COOKIE, VIEW_AS_HIT_COOKIE } from "./cookie";
import { isSameOriginRequest } from "./guard";
import { getRealSession, getVerifiedAuthUser } from "./state";

export const NOT_OWNER_MESSAGE = "Solo el Dueño puede usar «Ver como».";

export type RawService = ReturnType<typeof createRawServiceClient>;

export interface RealOwnerContext {
  viewerId: string;
  authSessionId: string;
  workspaceId: string;
  service: RawService;
}

export interface RealSessionContext {
  viewerId: string;
  authSessionId: string | null;
  service: RawService;
}

function fail(status: number, error: string, code?: string) {
  return { ok: false as const, response: NextResponse.json(code ? { error, code } : { error }, { status }) };
}

/** Sesión real (confirmada contra Auth) y, en POST, mismo origen. */
export async function requireRealSession(
  request: NextRequest,
  options: { checkOrigin: boolean },
): Promise<{ ok: true; ctx: RealSessionContext } | { ok: false; response: NextResponse }> {
  if (options.checkOrigin && !isSameOriginRequest(request.headers)) {
    return fail(403, "Petición no permitida.", "BAD_ORIGIN");
  }
  const supabase = await createClient();
  const real = await getVerifiedAuthUser(supabase);
  if (!real) return fail(401, "No autorizado");
  const session = await getRealSession();
  return {
    ok: true,
    ctx: { viewerId: real.id, authSessionId: session?.authSessionId ?? null, service: createRawServiceClient() },
  };
}

/**
 * La persona real es Dueño del espacio activo (cookie del selector, o el primero
 * del que sea Dueño). Se comprueba con el cliente de servicio: con una vista
 * activa el cliente del usuario ya vería como la persona vista.
 */
export async function requireRealOwner(
  request: NextRequest,
  options: { checkOrigin: boolean },
): Promise<{ ok: true; ctx: RealOwnerContext } | { ok: false; response: NextResponse }> {
  const base = await requireRealSession(request, options);
  if (!base.ok) return base;
  const { viewerId, authSessionId, service } = base.ctx;
  if (!authSessionId) return fail(400, "La sesión no tiene identificador. Vuelve a iniciar sesión.");

  const { data: rows } = await service
    .from("workspace_members")
    .select("workspace_id, role, created_at")
    .eq("user_id", viewerId)
    .order("created_at", { ascending: true });
  const selected = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const mine = rows ?? [];
  const active = mine.find((m) => m.workspace_id === selected) ?? mine[0];
  if (!active || active.role !== "owner") return fail(403, NOT_OWNER_MESSAGE);
  return { ok: true, ctx: { viewerId, authSessionId, workspaceId: active.workspace_id, service } };
}

/** Quita la cookie de la vista (y el aviso de solo lectura) en la respuesta. */
export function clearViewAsCookies(response: NextResponse): void {
  response.cookies.set(VIEW_AS_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(VIEW_AS_HIT_COOKIE, "", { path: "/", maxAge: 0 });
}
