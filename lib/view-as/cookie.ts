// Cookie `crm_view_as` de "Ver como". Sin dependencias de servidor.
//
// NO es una credencial ni lleva firma: es solo un CANDADO que le dice a la app
// "esta navegación está en vista". La identidad que se aplica la decide siempre
// la base de datos (pre-request, atado al session_id del JWT del Dueño). Si
// alguien la falsifica o la edita, solo consigue quedar en solo lectura.
//
// Formato: <sid>.<viewer>.<exp>   (uuid de la vista . uuid del Dueño . ms epoch)

/** Cookie httpOnly con el candado de la vista. */
export const VIEW_AS_COOKIE = "crm_view_as";
/**
 * Cookie corta NO httpOnly que deja el candado del servidor cuando bloqueó una
 * escritura: la franja de la interfaz la lee para avisar "No se guardó nada".
 */
export const VIEW_AS_HIT_COOKIE = "crm_ro_hit";

/** Duración de una vista. */
export const VIEW_AS_DURATION_MS = 30 * 60 * 1000;
/** Margen tras caducar en que la base sigue en solo lectura hasta "Volver a mi vista" (igual que en 00040). */
export const VIEW_AS_GRACE_MS = 5 * 60 * 1000;

export interface ViewAsCookie {
  sid: string;
  viewer: string;
  /** Caducidad en ms desde epoch. */
  exp: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatViewAsCookie(value: ViewAsCookie): string {
  return `${value.sid}.${value.viewer}.${Math.trunc(value.exp)}`;
}

/** Valor de la cookie → partes, o null si no tiene el formato exacto. */
export function parseViewAsCookie(raw: string | null | undefined): ViewAsCookie | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [sid, viewer, expRaw] = parts;
  if (!UUID_RE.test(sid) || !UUID_RE.test(viewer) || !/^\d{1,15}$/.test(expRaw)) return null;
  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp)) return null;
  return { sid: sid.toLowerCase(), viewer: viewer.toLowerCase(), exp };
}

/** ¿Ya pasó la caducidad que dice la cookie? */
export function isViewAsCookieExpired(cookie: ViewAsCookie, now: number = Date.now()): boolean {
  return now >= cookie.exp;
}

export interface ViewAsCookieOptions {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
}

/**
 * Opciones de la cookie: dura hasta la caducidad más el margen de la base, para
 * que el candado siga puesto mientras la base mantiene el solo lectura.
 */
export function viewAsCookieOptions(exp: number, now: number = Date.now(), secure = false): ViewAsCookieOptions {
  return {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: Math.max(1, Math.ceil((exp + VIEW_AS_GRACE_MS - now) / 1000)),
  };
}
