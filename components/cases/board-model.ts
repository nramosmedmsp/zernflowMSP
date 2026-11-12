// Lógica pura del "Tablero" de Gestiones: a qué columnas acepta soltarse cada
// tarjeta (permisos, orden estricto, lo que pide la etapa actual, cierre), cómo
// se agrupan por etapa, cómo se ordenan y qué tipo se muestra por defecto.
// Reutiliza las mismas reglas que la tarjeta del chat (step-bar-model.ts,
// case-card-model.ts, lib/cases/guide.ts); el servidor las vuelve a validar.
// Sin React ni E/S, para probarla con vitest.

import type { CaseTab } from "@/components/cases/case-filters";
import { closeMenuItems, closeOptions } from "@/components/inbox/case-card-model";
import {
  STRICT_LOCK_MESSAGE,
  blockedMoveText,
  requirementState,
  stepBarSteps,
  type BarStep,
} from "@/components/inbox/step-bar-model";
import { compareUrgency, caseUrgencyKey, type UrgencyCase } from "@/lib/cases/client-groups";
import type { GuideStage } from "@/lib/cases/guide";
import type { StageRequirement } from "@/lib/types/database";

/** Tarjetas que se muestran por columna como máximo (el resto se acota con los filtros). */
export const BOARD_COLUMN_LIMIT = 100;
/** Tarjetas visibles por columna antes de "Ver más". */
export const BOARD_PAGE_SIZE = 20;

export const BOARD_TABS: readonly CaseTab[] = ["open", "today"];

export function boardSupportsTab(tab: CaseTab): boolean {
  return BOARD_TABS.includes(tab);
}

// ---------------------------------------------------------------- Permisos

export interface BoardActor {
  userId: string;
  /** Dueño o administrador. */
  isAdmin: boolean;
  /** Equipos que supervisa. */
  supervisedTeamIds: readonly string[];
}

/** Lo mínimo de una tarjeta para decidir a dónde puede ir. */
export interface BoardCardState {
  status: string;
  stageId: string | null;
  categoryId: string | null;
  assigneeId: string | null;
  teamId: string | null;
  contactTeamId: string | null;
  solutionStatus: string | null;
  hasCloseRequest: boolean;
}

export interface BoardPermissions {
  canEdit: boolean;
  canSupervise: boolean;
}

/** Mismas reglas que `casePermissions` (lib/cases/access.ts) para una gestión abierta. */
export function boardPermissions(actor: BoardActor, card: Pick<BoardCardState, "status" | "assigneeId" | "teamId" | "contactTeamId">): BoardPermissions {
  const supervised = new Set(actor.supervisedTeamIds);
  const supervises =
    actor.isAdmin ||
    (card.teamId !== null && supervised.has(card.teamId)) ||
    (card.contactTeamId !== null && supervised.has(card.contactTeamId));
  const active = card.status === "open" || card.status === "scheduled";
  const mine = card.assigneeId !== null && card.assigneeId === actor.userId;
  return { canEdit: active && (supervises || mine), canSupervise: supervises };
}

// ---------------------------------------------------------------- Veredicto de soltar

export type DropBlock =
  /** "Ver como": solo lectura. */
  | "read_only"
  /** La persona no tiene la gestión. */
  | "no_edit"
  /** Orden estricto: no puede ir ahí. */
  | "locked"
  /** La etapa actual pide algo antes de avanzar. */
  | "requirement"
  /** Cierre ya pedido. */
  | "pending_request"
  /** Es la columna donde ya está. */
  | "current"
  | "unknown";

export type DropVerdict =
  | { ok: true; kind: "stage"; stageId: string; name: string; jump: boolean; delta: number }
  | { ok: true; kind: "close"; stageId: string | null; name: string; needsApproval: boolean }
  | { ok: false; reason: DropBlock; message: string; requirement?: StageRequirement };

export interface BoardTypeRules {
  strictOrder: boolean;
  isProtected: boolean;
  /** El tipo tiene categorías activas para elegir. */
  hasCategories: boolean;
  /** Etapas del tipo (con la guía). */
  stages: readonly GuideStage[];
}

export const READ_ONLY_MESSAGE = "Estás viendo la cuenta de otra persona: no se puede cambiar nada.";
export const NO_EDIT_MESSAGE = "Solo quien tiene la gestión puede moverla";

/** ¿Puede esta tarjeta soltarse en la etapa abierta `targetStageId`? */
export function stageDropVerdict(
  card: BoardCardState,
  targetStageId: string,
  perms: BoardPermissions,
  rules: BoardTypeRules,
  opts: { readOnly?: boolean } = {},
): DropVerdict {
  if (opts.readOnly) return { ok: false, reason: "read_only", message: READ_ONLY_MESSAGE };
  if (!perms.canEdit) return { ok: false, reason: "no_edit", message: NO_EDIT_MESSAGE };
  if (targetStageId === card.stageId) return { ok: false, reason: "current", message: "" };
  const steps = stepBarSteps(rules.stages, card.stageId, { strictOrder: rules.strictOrder, canSupervise: perms.canSupervise });
  const step: BarStep | undefined = steps.find((s) => s.id === targetStageId);
  if (!step) return { ok: false, reason: "unknown", message: "Esa etapa ya no está disponible." };
  if (step.locked) return { ok: false, reason: "locked", message: STRICT_LOCK_MESSAGE };
  const current = rules.stages.find((s) => s.id === card.stageId);
  const req = requirementState({
    requires: current?.requires ?? null,
    hasCategory: !!card.categoryId,
    hasCategories: rules.hasCategories,
    // La nota solo se sabe en el chat (donde se escribe): aquí no se puede dar por hecha.
    noteDone: false,
    solutionDone: card.solutionStatus === "in_progress",
    canSupervise: perms.canSupervise,
  });
  if (step.delta > 0 && req?.blocking) {
    return { ok: false, reason: "requirement", message: blockedMoveText(step.name, req), requirement: req.kind };
  }
  return { ok: true, kind: "stage", stageId: step.id, name: step.name, jump: step.isJump, delta: step.delta };
}

/** ¿Puede esta tarjeta soltarse en la zona de cierre `finalStageId`? */
export function closeDropVerdict(
  card: BoardCardState,
  finalStageId: string | null,
  perms: BoardPermissions,
  rules: Pick<BoardTypeRules, "isProtected" | "stages">,
  opts: { readOnly?: boolean } = {},
): DropVerdict {
  if (opts.readOnly) return { ok: false, reason: "read_only", message: READ_ONLY_MESSAGE };
  if (!perms.canEdit || card.status !== "open") return { ok: false, reason: "no_edit", message: NO_EDIT_MESSAGE };
  const items = closeMenuItems(closeOptions(rules.stages), {
    isProtected: rules.isProtected,
    canSupervise: perms.canSupervise,
    hasPendingRequest: card.hasCloseRequest,
  });
  const item = items.find((i) => i.option.stageId === finalStageId);
  if (!item) return { ok: false, reason: "unknown", message: "Ese resultado ya no está disponible." };
  if (item.disabledReason) return { ok: false, reason: "pending_request", message: item.disabledReason };
  return { ok: true, kind: "close", stageId: item.option.stageId, name: item.option.name, needsApproval: item.needsApproval };
}

// ---------------------------------------------------------------- Destinos

export interface BoardTarget {
  /** Id de la etapa (null = resolver sin etapa final). */
  stageId: string | null;
  name: string;
  group: "stage" | "close";
  /** Número de la columna (solo etapas abiertas). */
  number: number | null;
  tone: "positive" | "negative" | null;
  verdict: DropVerdict;
}

/** Columnas abiertas (en orden) del tipo. */
export function boardOpenStages(stages: readonly GuideStage[]): GuideStage[] {
  return stages
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.archived && s.kind === "open")
    .sort((a, b) => (a.s.position ?? a.i) - (b.s.position ?? b.i) || a.i - b.i)
    .map(({ s }) => s);
}

/** Todos los destinos posibles de una tarjeta (menú «Mover a…» y columnas al arrastrar), con su veredicto. */
export function moveTargets(
  card: BoardCardState,
  perms: BoardPermissions,
  rules: BoardTypeRules,
  opts: { readOnly?: boolean } = {},
): BoardTarget[] {
  const targets: BoardTarget[] = boardOpenStages(rules.stages).map((s, i) => ({
    stageId: s.id,
    name: s.name,
    group: "stage" as const,
    number: i + 1,
    tone: null,
    verdict: stageDropVerdict(card, s.id, perms, rules, opts),
  }));
  for (const option of closeOptions(rules.stages)) {
    targets.push({
      stageId: option.stageId,
      name: option.name,
      group: "close",
      number: null,
      tone: option.tone,
      verdict: closeDropVerdict(card, option.stageId, perms, rules, opts),
    });
  }
  return targets;
}

// ---------------------------------------------------------------- Agrupar y ordenar

/** Una tarjeta ordenable: lo que pide la urgencia más la etapa. */
export interface BoardSortable extends UrgencyCase {
  stageId: string | null;
}

/** Más urgente primero (misma urgencia que "Por cliente"); desempata por id. */
export function sortByUrgency<T extends UrgencyCase>(cards: readonly T[], tab: CaseTab, now: Date): T[] {
  return cards
    .map((c) => ({ c, key: caseUrgencyKey(c, tab, now) }))
    .sort((a, b) => compareUrgency(a.key, b.key) || (a.c.id < b.c.id ? -1 : 1))
    .map((x) => x.c);
}

/**
 * Agrupa por etapa. Una gestión sin etapa (o en una etapa que ya no es columna,
 * p. ej. archivada) se muestra en la primera columna. Cada columna sale ordenada
 * por urgencia. Devuelve una entrada por cada columna, aunque esté vacía.
 */
export function groupByStage<T extends BoardSortable>(
  cards: readonly T[],
  columnIds: readonly string[],
  tab: CaseTab,
  now: Date,
): Map<string, T[]> {
  const out = new Map<string, T[]>(columnIds.map((id) => [id, []]));
  if (columnIds.length === 0) return out;
  const known = new Set(columnIds);
  for (const c of cards) {
    const id = c.stageId && known.has(c.stageId) ? c.stageId : columnIds[0];
    out.get(id)!.push(c);
  }
  for (const [id, list] of out) out.set(id, sortByUrgency(list, tab, now));
  return out;
}

// ---------------------------------------------------------------- Tipo elegido

export interface BoardTypeChip {
  id: string;
  name: string;
  color: string | null;
  /** Gestiones abiertas que la persona ve (con los filtros de la pestaña). */
  count: number;
}

/**
 * Tipo que muestra el tablero: el pedido en la URL si sigue siendo uno de los
 * activos; si no, el primero (en el orden de Configuración) que tiene gestiones
 * y, si ninguno tiene, el primero.
 */
export function resolveBoardType(chips: readonly BoardTypeChip[], requested: string): string | null {
  if (chips.length === 0) return null;
  if (requested && chips.some((c) => c.id === requested)) return requested;
  return (chips.find((c) => c.count > 0) ?? chips[0]).id;
}

/** Chips a mostrar: los tipos con gestiones y, siempre, el elegido. */
export function visibleTypeChips(chips: readonly BoardTypeChip[], selectedId: string | null): BoardTypeChip[] {
  return chips.filter((c) => c.count > 0 || c.id === selectedId);
}

/** Encabezado: «7 gestiones abiertas de Venta». */
export function boardHeadline(total: number, typeName: string | null, tab: CaseTab): string {
  if (!typeName) return "Sin gestiones";
  const noun = total === 1 ? "gestión" : "gestiones";
  const open = total === 1 ? "abierta" : "abiertas";
  return tab === "today" ? `${total} ${noun} de ${typeName} para hoy` : `${total} ${noun} ${open} de ${typeName}`;
}
