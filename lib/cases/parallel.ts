// Reglas puras de las gestiones paralelas (sin base de datos: las usan también los diálogos).

/** Aviso (y pregunta) cuando el tipo admite dos gestiones iguales a la vez. */
export function sameTypeConfirmMessage(typeName: string): string {
  return `Este cliente ya tiene una ${typeName.trim().toLowerCase()} abierta. ¿Abrir otra?`;
}

/**
 * ¿Un contacto puede tener dos gestiones abiertas de este tipo (con confirmación)?
 * Regla genérica, sin mirar nombres: sí si el tipo NO es protegido (Postventa) y
 * tiene al menos una etapa final de «ganada» o «perdida» (es un proceso comercial:
 * Venta, Recompra). Los tipos que solo se «resuelven» (Consulta) o no tienen etapas
 * finales siguen siendo de una sola gestión abierta por contacto.
 */
export function allowsSameTypeParallel(type: {
  protected: boolean;
  stages: readonly { kind: string; archived?: boolean }[];
}): boolean {
  if (type.protected) return false;
  return type.stages.some((s) => !s.archived && (s.kind === "won" || s.kind === "lost"));
}
