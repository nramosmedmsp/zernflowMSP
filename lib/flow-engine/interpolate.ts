// Variables {{nombre}} de los flujos. Lo comparten el motor y el simulador para
// que la vista previa de la prueba coincida con lo que se envía en producción.

import { EMPTY, tidyEmptyMarks } from "@/lib/saved-replies";

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
 * la respuesta JSON de una solicitud HTTP). Lo que no se resuelve queda tal cual,
 * salvo con `blankUnknown` (texto que se envía al cliente: nunca debe llegarle
 * una llave sin reemplazar, así que la variable desconocida queda vacía, y el
 * texto se limpia: "Hola {{nombre}}, ..." sin nombre queda "Hola, ...").
 * Con `encode` cada valor se codifica para ir dentro de una dirección web
 * ("url") o de un texto JSON ("json"): el texto del cliente no puede romper la
 * dirección ni el cuerpo de la solicitud.
 */
export function interpolateVariables(
  text: string,
  variables: Record<string, unknown>,
  options: { blankUnknown?: boolean; encode?: "url" | "json" } = {},
): string {
  const result = text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (token, path: string) => {
    const value = resolveVariablePath(variables, path);
    if (value === null || value === undefined) return options.blankUnknown ? EMPTY : token;
    const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (raw === "" && options.blankUnknown) return EMPTY;
    if (options.encode === "url") return encodeURIComponent(raw);
    // JSON.stringify(...) trae las comillas de los extremos: dentro de "..." sobran.
    if (options.encode === "json") return JSON.stringify(raw).slice(1, -1);
    return raw;
  });
  return options.blankUnknown ? tidyEmptyMarks(result) : result;
}
