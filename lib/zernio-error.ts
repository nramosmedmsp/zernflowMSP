// Mensajes de error en español para las llamadas a Zernio de las plantillas.
// El SDK no lanza excepciones: devuelve { data, error, response }.

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
