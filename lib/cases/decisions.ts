// Decisiones puras del motor de gestiones que antes vivían mezcladas con las
// consultas a la base. Las usan inbound.ts, auto-template.ts y cron.ts, y el
// laboratorio de conversaciones (lib/flow-lab).

/** Tipo de gestión sugerido para un tipo de contacto: el primero por posición entre los no archivados. */
export function pickSuggestedCaseTypeId(
  caseTypes: readonly {
    id: string;
    position: number;
    archived_at?: string | null;
    suggested_for_contact_type_ids: readonly string[] | null;
  }[],
  contactTypeId: string | null,
): string | null {
  if (!contactTypeId) return null;
  const sorted = caseTypes
    .filter((t) => !t.archived_at && (t.suggested_for_contact_type_ids ?? []).includes(contactTypeId))
    .sort((a, b) => a.position - b.position);
  return sorted[0]?.id ?? null;
}

/**
 * Etapa a la que vuelve una gestión reabierta: la que tenía antes de cerrar
 * (`fromStageId`) si sigue siendo una etapa abierta activa del tipo; si no, la
 * primera etapa abierta. `openStages` son las etapas abiertas activas del tipo.
 */
export function resolveReopenStageId(
  fromStageId: string | null | undefined,
  openStages: readonly { id: string; position: number }[],
): string | null {
  if (fromStageId && openStages.some((s) => s.id === fromStageId)) return fromStageId;
  return [...openStages].sort((a, b) => a.position - b.position)[0]?.id ?? null;
}

/**
 * Etapa a la que pasa la gestión al enviarse la plantilla automática: la
 * segunda etapa abierta, si la gestión está sin etapa o en la primera.
 */
export function nextAutoTemplateStageId(
  openStages: readonly { id: string; position: number }[],
  currentStageId: string | null,
): string | null {
  const open = [...openStages].sort((a, b) => a.position - b.position);
  if (open.length >= 2 && (currentStageId === null || currentStageId === open[0].id)) return open[1].id;
  return null;
}

export type ActivationPlan = { action: "activate" } | { action: "defer"; to: Date };

/**
 * Qué hace el cron con una gestión programada cuya fecha se cumplió: si el
 * equipo de destino está fuera de horario y abre más adelante, la fecha pasa a
 * esa apertura; si no, se activa.
 */
export function planActivation(params: {
  isOpen: boolean;
  nextOpening: Date | null;
  now: Date;
  scheduledFor: string | null;
}): ActivationPlan {
  if (!params.isOpen && params.nextOpening && params.nextOpening.getTime() > params.now.getTime() && params.scheduledFor) {
    return { action: "defer", to: params.nextOpening };
  }
  return { action: "activate" };
}
