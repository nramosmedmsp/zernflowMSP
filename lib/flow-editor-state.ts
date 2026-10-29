// Estado del editor de flujos: ¿hay cambios sin guardar? Se compara una
// "firma" de lo que se guarda (nombre, nodos y conexiones) con la de la última
// vez que se guardó o cargó. Ignora lo que solo es del lienzo (selección,
// medidas, arrastre), que cambia sin que la persona edite nada.

interface SignatureNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data?: unknown;
}

interface SignatureEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export function flowSignature(
  name: string,
  nodes: readonly SignatureNode[],
  edges: readonly SignatureEdge[],
): string {
  return JSON.stringify({
    name,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type ?? null,
      x: Math.round(n.position?.x ?? 0),
      y: Math.round(n.position?.y ?? 0),
      data: n.data ?? null,
    })),
    edges: edges.map((e) => [e.source, e.sourceHandle ?? null, e.target, e.targetHandle ?? null]),
  });
}

export const UNSAVED_CHANGES_MESSAGE = "Tienes cambios sin guardar en este flujo. Si sales ahora, se perderán.";
