// Mensajes de error en español para las llamadas a Zernio.
//
// Ojo: cuando Zernio responde con un error (4xx o 5xx), el SDK lanza un
// ZernioApiError en lugar de devolver { error, response }. `zernioThrown`
// convierte esa excepción al mismo formato, para dar el mismo mensaje.

interface ZernioResultLike {
  error?: unknown;
  response?: { status?: number } | null;
}

function detailOf(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error.trim() || null;
  if (typeof error === "object") {
    const e = error as Record<string, unknown>;
    for (const key of ["error", "message", "detail"]) {
      const v = e[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

/**
 * El error que lanzó el SDK, en el formato { error, response }; null si no es
 * un rechazo de Zernio (por ejemplo, sin conexión o un error de programación).
 */
export function zernioThrown(err: unknown): ZernioResultLike | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { name?: unknown; statusCode?: unknown; body?: unknown; message?: unknown };
  if (e.name !== "ZernioApiError" || typeof e.statusCode !== "number") return null;
  return { error: e.body ?? e.message ?? null, response: { status: e.statusCode } };
}

/** ¿La respuesta de Zernio trae un error? */
export function zernioFailed(res: ZernioResultLike): boolean {
  return !!res.error || (typeof res.response?.status === "number" && res.response.status >= 400);
}

/**
 * Mensaje para el usuario: el texto propio en español y, si Zernio o Meta
 * explicaron el motivo, se agrega entre paréntesis para poder corregirlo.
 */
export function zernioErrorMessage(res: ZernioResultLike, fallback: string): string {
  const status = res.response?.status;
  if (status === 401 || status === 403) {
    return "Zernio rechazó la clave de API o no tiene permiso para esta cuenta. Revisa la clave en Configuración.";
  }
  if (status === 429) return "Zernio recibió demasiadas solicitudes. Espera un momento e inténtalo de nuevo.";
  const detail = detailOf(res.error);
  return detail ? `${fallback} (${detail})` : fallback;
}
