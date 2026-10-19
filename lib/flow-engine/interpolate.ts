// Variables {{nombre}} de los flujos. Lo comparten el motor y el simulador para
// que la vista previa de la prueba coincida con lo que se envía en producción.

/** Valor de una ruta con puntos ("respuesta.datos.nombre") dentro de un objeto. */
export function resolveVariablePath(variables: Record<string, unknown>, path: string): unknown {
  let value: unknown = variables;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * Reemplaza {{variable}} (admite rutas con puntos hacia objetos, por ejemplo
 * la respuesta JSON de una solicitud HTTP). Lo que no se resuelve queda tal cual.
 */
export function interpolateVariables(text: string, variables: Record<string, unknown>): string {
  return text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (token, path: string) => {
    const value = resolveVariablePath(variables, path);
    if (value === null || value === undefined) return token;
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}
