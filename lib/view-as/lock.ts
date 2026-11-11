// ¿Esta petición lleva el candado de "Ver como"? Solo mira que exista la cookie
// `crm_view_as` (cualquier valor: una cookie falsa también deja en solo lectura).
// Es seguro fuera de una petición (cron, webhooks, cachés): ahí devuelve false.

import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { VIEW_AS_COOKIE, VIEW_AS_HIT_COOKIE } from "./cookie";

export async function isViewAsLocked(): Promise<boolean> {
  try {
    const store = await cookies();
    return !!store.get(VIEW_AS_COOKIE)?.value;
  } catch (error) {
    // Los avisos internos de Next (render dinámico) deben seguir su camino.
    unstable_rethrow(error);
    return false;
  }
}

/** Deja la cookie corta que la franja lee para avisar "No se guardó nada". Solo funciona en acciones y rutas. */
export async function markReadOnlyHit(): Promise<void> {
  try {
    const store = await cookies();
    store.set(VIEW_AS_HIT_COOKIE, String(Date.now()), { path: "/", httpOnly: false, sameSite: "lax", maxAge: 60 });
  } catch {
    // en un Server Component no se pueden fijar cookies
  }
}

export const VIEW_AS_LOCKED_MESSAGE =
  "Estás viendo como otra persona (solo lectura): esta acción no se ejecutó.";

/**
 * Para efectos externos (correo, envío de mensajes, subidas): lanza si hay una
 * vista activa. Debe llamarse antes de salir a la red.
 */
export async function assertNotViewAs(): Promise<void> {
  if (await isViewAsLocked()) {
    await markReadOnlyHit();
    throw new Error(VIEW_AS_LOCKED_MESSAGE);
  }
}
