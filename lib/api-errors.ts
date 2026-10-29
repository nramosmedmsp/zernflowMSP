// Texto en español para mostrar cuando una llamada a la API falla. Un 403 es
// falta de permiso, no un fallo pasajero: no se le dice a la persona que
// "lo intente de nuevo".

export async function apiErrorMessage(res: Pick<Response, "status" | "json">, action: string): Promise<string> {
  if (res.status === 403) return `No tienes permiso para ${action}.`;
  if (res.status === 401) return "Tu sesión venció. Vuelve a iniciar sesión.";
  if (res.status === 404) return "No se encontró. Puede que ya no exista: recarga la página.";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Sin cuerpo JSON: se usa el texto genérico.
  }
  return `No se pudo ${action}. Inténtalo de nuevo.`;
}
