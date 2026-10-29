// Avisos del cierre de una gestión: qué efecto de las reglas no se pudo aplicar
// y qué hacer. Puro: lo usan el diálogo de cierre y las pruebas.

import type { RuleEffects } from "./effects";

/**
 * Una frase en español por cada efecto omitido. `names` da el nombre de la
 * gestión que la regla quería programar (por id de regla), si se conoce.
 */
export function describeSkippedEffects(skipped: RuleEffects["skipped"], names: ReadonlyMap<string, string | null>): string[] {
  const out: string[] = [];
  for (const s of skipped) {
    const name = names.get(s.ruleId) || "la gestión siguiente";
    switch (s.reason) {
      case "missing_key_date":
        out.push(`No se programó ${name} porque falta la fecha clave del contacto; prográmala a mano.`);
        break;
      case "invalid_case_type":
        out.push(`No se programó ${name} porque ese tipo de gestión está archivado o ya no existe; prográmala a mano.`);
        break;
      case "invalid_contact_type":
        out.push("No se cambió el tipo del contacto porque el tipo elegido por la regla está archivado; cámbialo a mano.");
        break;
      default:
        out.push(`No se pudo programar ${name}; prográmala a mano.`);
    }
  }
  return out;
}
