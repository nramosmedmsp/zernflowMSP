// Recorrido de un flujo: salida que se sigue desde un nodo, reparto A/B y
// duración de las esperas. Puro: lo usan el motor y el laboratorio de
// conversaciones.

export interface GraphEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

/** El lienzo dibuja las salidas de la condición como "yes"/"no" y las plantillas como "true"/"false": se aceptan ambas. */
export function conditionHandleAliases(handle: string): string[] {
  if (handle === "true" || handle === "yes") return ["true", "yes"];
  if (handle === "false" || handle === "no") return ["false", "no"];
  return [handle];
}

/**
 * Arista que sigue el motor desde un nodo. Con una salida elegida (condición,
 * A/B) solo vale la que lleva ese nombre: si no está conectada, el flujo
 * termina ahí. Sin salida elegida, la primera arista del nodo.
 */
export function selectNextEdge<E extends GraphEdge>(
  edges: readonly E[],
  nodeId: string,
  handle?: string,
): E | undefined {
  if (handle !== undefined) {
    const accepted = conditionHandleAliases(handle);
    return edges.find((e) => e.source === nodeId && !!e.sourceHandle && accepted.includes(e.sourceHandle));
  }
  return edges.find((e) => e.source === nodeId);
}

/** Camino de una prueba A/B: `random` es un número entre 0 y 1 (por defecto Math.random()). */
export function chooseABPath<P extends { name: string; weight: number }>(
  paths: readonly P[],
  random: number = Math.random(),
): P {
  const totalWeight = paths.reduce((sum, p) => sum + p.weight, 0);
  const point = random * totalWeight;

  let cumulative = 0;
  for (const path of paths) {
    cumulative += path.weight;
    if (point <= cumulative) return path;
  }
  return paths[0];
}

const DELAY_UNIT_MS: Record<string, number> = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

/** Milisegundos del nodo Espera (unidad desconocida = segundos). */
export function delayDurationMs(duration: number, unit: string): number {
  return duration * (DELAY_UNIT_MS[unit] || 1000);
}
