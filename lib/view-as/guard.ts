// Candado de solo lectura del servidor para "Ver como": decide, solo con el
// método y la ruta, si una petición puede seguir. Es la capa 3 (middleware);
// las demás capas son la base de datos (transacción de solo lectura), los
// clientes de Supabase del servidor (read-only-fetch.ts) y los efectos externos
// (correo y envío de mensajes).

import { isViewAsCookieExpired, type ViewAsCookie } from "./cookie";

/** Mensaje que ve la persona cuando algo intenta escribir en vista. */
export const VIEW_AS_READ_ONLY_MESSAGE =
  "Estás viendo como otra persona (solo lectura): no se guardó nada. Sal de la vista para hacer cambios.";
export const VIEW_AS_READ_ONLY_CODE = "VIEW_AS_READ_ONLY";

/** Rutas de la propia función (entrar, salir, marcar actividad, opciones). */
export const VIEW_AS_API_PREFIX = "/api/v1/view-as/";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method.toUpperCase());
}

export function isViewAsApiPath(pathname: string): boolean {
  return pathname === "/api/v1/view-as" || pathname.startsWith(VIEW_AS_API_PREFIX);
}

export type ViewAsGuardDecision = { allow: true } | { allow: false; reason: "read_only" | "expired" };

/**
 * Con la cookie puesta:
 *  - vista vigente: ninguna escritura en /api/* (salvo /api/v1/view-as/*). Los
 *    POST de server actions NO se bloquean aquí porque varias lecturas son
 *    server actions; los frena el cliente con candado y la base.
 *  - vista vencida y sin cerrar: ningún POST/PUT/PATCH/DELETE en ninguna ruta
 *    (tampoco server actions) hasta "Volver a mi vista" (stop).
 * Sin cookie: no hace nada (la app se comporta como siempre).
 */
export function decideViewAsRequest(input: {
  method: string;
  pathname: string;
  cookie: ViewAsCookie | null;
  now?: number;
}): ViewAsGuardDecision {
  const { method, pathname, cookie } = input;
  if (!cookie) return { allow: true };
  if (isReadMethod(method)) return { allow: true };
  if (isViewAsApiPath(pathname)) return { allow: true };
  if (isViewAsCookieExpired(cookie, input.now ?? Date.now())) return { allow: false, reason: "expired" };
  if (pathname.startsWith("/api/")) return { allow: false, reason: "read_only" };
  return { allow: true };
}

/** Rutas que el candado no toca: iniciar sesión y los enlaces de acceso (la persona aún no tiene vista). */
export function isViewAsGuardExemptPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/auth" || pathname.startsWith("/auth/");
}

/**
 * Una cookie de vista de OTRA persona (quedó de una sesión anterior) no debe
 * bloquear a quien inició sesión después: solo cuenta la del Dueño que mira.
 */
export function isStaleViewAsCookie(cookie: ViewAsCookie | null, userId: string | null | undefined): boolean {
  return !!cookie && !!userId && cookie.viewer !== userId.toLowerCase();
}

/**
 * Defensa contra peticiones desde otro sitio: el Origin de un POST debe ser el
 * de esta misma app. Sin Origin (no lo manda ningún navegador en un POST
 * normal) se rechaza.
 */
export function isSameOriginRequest(headers: { get(name: string): string | null }): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
