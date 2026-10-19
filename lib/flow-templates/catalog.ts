// Tipos y constantes de la pantalla de plantillas que el navegador necesita.
// Sin dependencias del servidor: la lista completa y los grafos viven en ./index.

import { BUSINESS_LABELS, type FlowTemplateBusiness } from "./types";

export { BUSINESS_LABELS };
export type { FlowTemplateBusiness };

/** Filtro de negocio de la pantalla: un negocio concreto o todos. */
export type BusinessFilter = FlowTemplateBusiness | "all";

export const BUSINESS_FILTERS: readonly BusinessFilter[] = ["all", "ecommerce", "gym", "general"];

/** Lo que la pantalla necesita de una plantilla (serializable, sin el grafo). */
export interface FlowTemplateSummary {
  id: string;
  name: string;
  description: string;
  business: FlowTemplateBusiness;
  category: string;
  trigger: string;
  steps: string[];
  adjust: string[];
  requires: Array<{ id: string; name: string }>;
  nodeCount: number;
}

/**
 * Plantillas del filtro. Las de un negocio incluyen las generales (sirven para
 * cualquiera); "General" muestra solo las generales y "Todas", todas.
 */
export function templatesForBusiness<T extends { business: FlowTemplateBusiness }>(
  filter: BusinessFilter,
  list: readonly T[],
): T[] {
  if (filter === "all") return [...list];
  return list.filter((t) => t.business === filter || t.business === "general");
}

/** Categorías presentes en una lista de plantillas, en orden de aparición. */
export function categoriesOf(list: readonly { category: string }[]): string[] {
  return [...new Set(list.map((t) => t.category))];
}
