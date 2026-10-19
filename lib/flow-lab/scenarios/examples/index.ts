// Escenarios de ejemplo por plantilla de negocio.

import type { BusinessTemplate } from "@/lib/types/database";
import type { NamedScenario } from "../types";
import { ECOMMERCE_EXAMPLES } from "./ecommerce";
import { GYM_EXAMPLES } from "./gym";

export { ECOMMERCE_EXAMPLES, GYM_EXAMPLES };

/** Los de la plantilla del negocio (settings.business_template); vacío si no hay para ese negocio. */
export function exampleScenariosFor(business: BusinessTemplate | null | undefined): NamedScenario[] {
  if (business === "ecommerce") return ECOMMERCE_EXAMPLES;
  if (business === "gym") return GYM_EXAMPLES;
  return [];
}
