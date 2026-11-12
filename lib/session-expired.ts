// Sesión vencida a mitad de trabajo (PAN-08): antes solo decía "No autorizado".
// El mensaje que se escribió no se pierde (queda en la burbuja con «Reintentar»),
// así que el camino para volver a entrar abre el inicio de sesión en OTRA pestaña.

export const SESSION_EXPIRED_MESSAGE = "Tu sesión venció. Inicia sesión de nuevo y vuelve a intentarlo; lo que escribiste no se pierde.";

/** ¿El error es el de sesión vencida? */
export function isSessionExpired(message: string | null | undefined): boolean {
  return message === SESSION_EXPIRED_MESSAGE;
}

/** Enlace de inicio de sesión que regresa a la pantalla actual (solo rutas internas). */
export function loginHref(returnTo: string): string {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.startsWith("/\\") ? returnTo : "/dashboard/inbox";
  return `/login?next=${encodeURIComponent(safe)}`;
}

/** Mensaje de error de una respuesta del servidor; la 401 se traduce a la sesión vencida. */
export function errorFromResponse(status: number, serverMessage: string | undefined, fallback: string): string {
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  return serverMessage || fallback;
}
