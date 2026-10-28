// Reglas puras de Configuración → Gestiones y Tipos de contacto
// (docs/PLAN-CRM.md 7.9, "Cambiar la configuración en cualquier momento").
//
// Sin dependencias de servidor ni de React: las usan las acciones de
// `lib/actions/case-config.ts` (que son la fuente de verdad: validan en el
// servidor), la interfaz (para avisar antes) y las pruebas de vitest.

import type {
  CaseRouting,
  CaseRuleAction,
  CaseRuleCondition,
  CaseRuleTrigger,
  OutcomeKind,
  StageKind,
} from "@/lib/types/database";

// ── Datos que viajan del servidor a la interfaz ────────────────────────────

export interface StageConfig {
  id: string;
  caseTypeId: string;
  name: string;
  color: string | null;
  position: number;
  kind: StageKind;
  archived: boolean;
  updatedAt: string;
}

export interface CategoryConfig {
  id: string;
  caseTypeId: string;
  name: string;
  position: number;
  isHighPriority: boolean;
  archived: boolean;
  updatedAt: string;
}

export interface ReasonConfig {
  id: string;
  caseTypeId: string;
  name: string;
  kind: OutcomeKind;
  position: number;
  archived: boolean;
  updatedAt: string;
}

export interface RuleConfig {
  id: string;
  caseTypeId: string;
  position: number;
  enabled: boolean;
  trigger: CaseRuleTrigger;
  triggerStageId: string | null;
  condition: CaseRuleCondition;
  action: CaseRuleAction;
  /** `set_contact_type`, `schedule_case` o `ask_key_date`: ver CaseRuleParams. */
  params: Record<string, unknown>;
  updatedAt: string;
}

export interface CaseTypeConfig {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  position: number;
  isProactive: boolean;
  suggestedForContactTypeIds: string[];
  routing: CaseRouting;
  fixedTeamId: string | null;
  slaFirstResponseMinutes: number | null;
  slaResolutionHours: number | null;
  requireCategory: boolean;
  requireOutcomeReason: boolean;
  /** Control de reclamos (00029). */
  protected: boolean;
  solutionDeadlineHours: number | null;
  reopenWindowDays: number | null;
  archived: boolean;
  updatedAt: string;
  stages: StageConfig[];
  categories: CategoryConfig[];
  reasons: ReasonConfig[];
  rules: RuleConfig[];
}

export interface ContactTypeConfig {
  id: string;
  name: string;
  color: string | null;
  position: number;
  isDefault: boolean;
  archived: boolean;
  updatedAt: string;
}

export interface TeamOption {
  id: string;
  name: string;
}

export interface CaseConfigData {
  /** `workspaces.settings.business_template`, si ya se eligió una. */
  businessTemplate: string | null;
  keyDateLabel: string;
  caseTypes: CaseTypeConfig[];
  contactTypes: ContactTypeConfig[];
  /** Equipos activos (para el destino fijo). */
  teams: TeamOption[];
}

// ── Textos y listas ────────────────────────────────────────────────────────

export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  open: "Abierta",
  won: "Ganada",
  lost: "Perdida",
  resolved: "Resuelta",
};
export const STAGE_KINDS: readonly StageKind[] = ["open", "won", "lost", "resolved"];

export const OUTCOME_KIND_LABELS: Record<OutcomeKind, string> = {
  won: "Ganada",
  lost: "Perdida",
  resolved: "Resuelta",
};
export const OUTCOME_KINDS: readonly OutcomeKind[] = ["won", "lost", "resolved"];

export const TRIGGER_LABELS: Record<CaseRuleTrigger, string> = {
  on_open: "Al abrir",
  on_stage: "Al cambiar a una etapa",
  on_won: "Al ganar",
  on_lost: "Al perder",
  on_resolved: "Al resolver",
};
export const RULE_TRIGGERS: readonly CaseRuleTrigger[] = ["on_open", "on_stage", "on_won", "on_lost", "on_resolved"];

export const ACTION_LABELS: Record<CaseRuleAction, string> = {
  set_contact_type: "Cambiar el tipo de contacto",
  schedule_case: "Programar otra gestión",
  ask_key_date: "Pedir la fecha clave",
};
export const RULE_ACTIONS: readonly CaseRuleAction[] = ["set_contact_type", "schedule_case", "ask_key_date"];

export const ROUTING_LABELS: Record<CaseRouting, string> = {
  contact_owner: "Al responsable del contacto",
  contact_team: "A la cola del equipo del contacto",
  fixed_team: "A un equipo fijo",
};
export const ROUTING_HINTS: Record<CaseRouting, string> = {
  contact_owner: "Si el contacto no tiene responsable, la gestión queda en la cola general.",
  contact_team: "Se reparte entre quienes atienden este tipo en el equipo del contacto.",
  fixed_team: "Siempre va al mismo equipo, sin importar quién sea el contacto.",
};
export const ROUTINGS: readonly CaseRouting[] = ["contact_owner", "contact_team", "fixed_team"];

/** Íconos de lucide que se pueden elegir para un tipo de gestión (nombre en kebab-case). */
export const CASE_TYPE_ICONS: readonly string[] = [
  "shopping-cart",
  "badge-dollar-sign",
  "credit-card",
  "package",
  "truck",
  "message-circle",
  "message-square",
  "headphones",
  "life-buoy",
  "repeat",
  "refresh-cw",
  "calendar",
  "dumbbell",
  "star",
  "heart",
  "gift",
  "handshake",
  "users",
  "phone",
  "file-text",
  "receipt",
  "megaphone",
  "shield-alert",
  "wrench",
  "tag",
];

export const COLOR_SWATCHES: readonly string[] = [
  "#3b82f6",
  "#0ea5e9",
  "#22c55e",
  "#84cc16",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#6366f1",
  "#14b8a6",
  "#6b7280",
];

export const KEY_DATE_LABEL_SUGGESTIONS: readonly string[] = ["Última compra", "Vencimiento de membresía"];

export const MAX_NAME_LENGTH = 100;
export const MAX_SLA_MINUTES = 525_600; // un año
export const MAX_SLA_HOURS = 8_760; // un año
export const MAX_SOLUTION_HOURS = 720; // control de reclamos: 30 días
export const MAX_REOPEN_DAYS = 365;
export const MAX_RULE_DAYS = 3_650;
export const MAX_NTH_WIN = 1_000;

export const NAME_ERROR = `Escribe un nombre de hasta ${MAX_NAME_LENGTH} caracteres.`;
export const LAST_OPEN_STAGE_ERROR = "Debe quedar al menos una etapa abierta activa en cada tipo de gestión.";
export const STAGE_KIND_CHANGE_NOTICE =
  "Cambiar la clase de una etapa cambia cómo se cuentan las métricas desde este momento. El historial anterior no se recalcula.";

// ── Nombres y colores ──────────────────────────────────────────────────────

/** Nombre sin espacios de más, o null si está vacío o es demasiado largo. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= MAX_NAME_LENGTH ? name : null;
}

/** Comparación por nombre: sin mayúsculas, tildes ni espacios de más. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** ¿Ya hay otro elemento con ese nombre? (`scope` incluye a los archivados). */
export function hasDuplicateName(
  scope: readonly { id: string; name: string }[],
  name: string,
  exceptId?: string,
): boolean {
  const key = nameKey(name);
  return scope.some((item) => item.id !== exceptId && nameKey(item.name) === key);
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** `#RRGGBB` en minúsculas, null si viene vacío; undefined si no es un color válido. */
export function normalizeColor(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  return isHexColor(value) ? value.toLowerCase() : undefined;
}

// ── Orden ──────────────────────────────────────────────────────────────────

/**
 * Orden final de una lista tras reordenar las activas: las activas en el orden
 * pedido y los archivados al final, en su orden actual. Devuelve null si
 * `orderedActiveIds` no es exactamente el conjunto de activas (sin repetir).
 */
export function planReorder(
  rows: readonly { id: string; position: number; archived: boolean }[],
  orderedActiveIds: readonly string[],
): string[] | null {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const active = sorted.filter((r) => !r.archived).map((r) => r.id);
  if (orderedActiveIds.length !== active.length) return null;
  const wanted = new Set(orderedActiveIds);
  if (wanted.size !== orderedActiveIds.length) return null;
  if (!active.every((id) => wanted.has(id))) return null;
  const archived = sorted.filter((r) => r.archived).map((r) => r.id);
  return [...orderedActiveIds, ...archived];
}

/** Posiciones (0..n-1) que cambian para llegar a `order`. */
export function positionChanges(
  rows: readonly { id: string; position: number }[],
  order: readonly string[],
): { id: string; position: number }[] {
  const current = new Map(rows.map((r) => [r.id, r.position]));
  return order.flatMap((id, index) => (current.get(id) === index ? [] : [{ id, position: index }]));
}

/** Mueve un elemento una posición ("up" = hacia arriba). Devuelve la misma lista si no se puede. */
export function moveId(ids: readonly string[], id: string, direction: "up" | "down"): string[] {
  const index = ids.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Dónde entra una etapa nueva entre las activas (en orden): una abierta va
 * después de la última abierta, para quedar antes de las de cierre; las de
 * cierre van al final.
 */
export function newStageIndex(active: readonly { kind: StageKind }[], kind: StageKind): number {
  if (kind !== "open") return active.length;
  let last = -1;
  active.forEach((s, i) => {
    if (s.kind === "open") last = i;
  });
  return last + 1;
}

// ── Cambio seguro de etapas ────────────────────────────────────────────────

type StageLite = { id: string; caseTypeId: string; kind: StageKind; archived: boolean };

function otherActiveOpen(stages: readonly StageLite[], stageId: string): boolean {
  return stages.some((s) => s.id !== stageId && !s.archived && s.kind === "open");
}

export type StageRemovalPlan = { ok: true; move: boolean } | { error: string };

/**
 * Quitar (archivar o borrar) una etapa: deja al menos una abierta activa y,
 * si hay gestiones abiertas o programadas en ella, exige una etapa abierta
 * activa del mismo tipo a la que moverlas.
 */
export function planStageRemoval(input: {
  stages: readonly StageLite[];
  stageId: string;
  /** Gestiones abiertas o programadas que están hoy en la etapa. */
  openCases: number;
  moveToStageId?: string | null;
}): StageRemovalPlan {
  const stage = input.stages.find((s) => s.id === input.stageId);
  if (!stage) return { error: "No se encontró la etapa." };
  if (!stage.archived && stage.kind === "open" && !otherActiveOpen(input.stages, stage.id)) {
    return { error: LAST_OPEN_STAGE_ERROR };
  }
  if (input.openCases <= 0) return { ok: true, move: false };
  if (!input.moveToStageId) {
    return {
      error: `Hay ${input.openCases} ${input.openCases === 1 ? "gestión abierta o programada" : "gestiones abiertas o programadas"} en esta etapa. Elige a qué etapa moverlas.`,
    };
  }
  const target = input.stages.find((s) => s.id === input.moveToStageId);
  if (
    !target ||
    target.id === stage.id ||
    target.caseTypeId !== stage.caseTypeId ||
    target.archived ||
    target.kind !== "open"
  ) {
    return { error: "Elige una etapa abierta y activa del mismo tipo de gestión." };
  }
  return { ok: true, move: true };
}

/** Cambiar la clase de una etapa no puede dejar al tipo sin etapa abierta activa. */
export function checkStageKindChange(input: {
  stages: readonly StageLite[];
  stageId: string;
  newKind: StageKind;
}): string | null {
  const stage = input.stages.find((s) => s.id === input.stageId);
  if (!stage) return "No se encontró la etapa.";
  if (stage.kind === input.newKind) return null;
  if (!stage.archived && stage.kind === "open" && !otherActiveOpen(input.stages, stage.id)) {
    return LAST_OPEN_STAGE_ERROR;
  }
  return null;
}

/** Texto del aviso al cambiar la clase de una etapa. */
export function stageKindChangeMessage(input: {
  name: string;
  from: StageKind;
  to: StageKind;
  openCases?: number;
}): string {
  const base = `«${input.name}» pasará de ${STAGE_KIND_LABELS[input.from].toLowerCase()} a ${STAGE_KIND_LABELS[input.to].toLowerCase()}. ${STAGE_KIND_CHANGE_NOTICE}`;
  if (input.to !== "open" && input.from === "open" && (input.openCases ?? 0) > 0) {
    return `${base} Además, ${input.openCases} ${input.openCases === 1 ? "gestión abierta está" : "gestiones abiertas están"} en esta etapa y se ${input.openCases === 1 ? "mantendrá" : "mantendrán"} abierta${input.openCases === 1 ? "" : "s"} hasta que alguien la${input.openCases === 1 ? "" : "s"} cierre.`;
  }
  return base;
}

// ── Archivar o borrar ──────────────────────────────────────────────────────

/** Con historial se archiva; sin uso se borra de verdad. */
export type RemovalOutcome = "delete" | "archive";

export function decideRemoval(usage: { historyCount: number; configRefs: number }): RemovalOutcome {
  return usage.historyCount > 0 || usage.configRefs > 0 ? "archive" : "delete";
}

/** Texto del resultado, en español, para el aviso en pantalla. */
export function removalMessage(
  outcome: RemovalOutcome,
  what: string,
  reason: "history" | "config" | "explicit" | "none" = "none",
): string {
  if (outcome === "delete") return `${what} se borró.`;
  if (reason === "history") return `${what} tiene historial, así que se archivó en lugar de borrarse. Puedes reactivarla cuando quieras.`;
  if (reason === "config") return `${what} se usa en otra parte de la configuración, así que se archivó en lugar de borrarse. Puedes reactivarla cuando quieras.`;
  return `${what} se archivó. Puedes reactivarla cuando quieras.`;
}

// ── Referencias en reglas ──────────────────────────────────────────────────

export interface RuleRefTarget {
  stageId?: string;
  categoryId?: string;
  outcomeReasonId?: string;
  contactTypeId?: string;
  caseTypeId?: string;
}

type RuleLike = {
  triggerStageId: string | null;
  condition: CaseRuleCondition;
  action: CaseRuleAction;
  params: Record<string, unknown>;
};

/** ¿La regla menciona alguno de los elementos indicados? */
export function ruleReferences(rule: RuleLike, target: RuleRefTarget): boolean {
  if (target.stageId && rule.triggerStageId === target.stageId) return true;
  if (target.categoryId && rule.condition.category_id === target.categoryId) return true;
  if (target.outcomeReasonId && rule.condition.outcome_reason_id === target.outcomeReasonId) return true;
  if (target.contactTypeId) {
    if (rule.condition.contact_type_id === target.contactTypeId) return true;
    if (rule.action === "set_contact_type" && rule.params.contact_type_id === target.contactTypeId) return true;
  }
  if (target.caseTypeId && rule.action === "schedule_case" && rule.params.case_type_id === target.caseTypeId) {
    return true;
  }
  return false;
}

// ── Tiempos ────────────────────────────────────────────────────────────────

/** Entero positivo opcional: vacío o null = sin objetivo; undefined si no es válido. */
export function parseOptionalPositiveInt(value: unknown, max: number): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim().replace(",", ".")) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > max) return undefined;
  return n;
}

// ── Reglas de gestión ──────────────────────────────────────────────────────

export interface RuleInput {
  trigger: CaseRuleTrigger;
  triggerStageId?: string | null;
  condition?: {
    categoryId?: string | null;
    outcomeReasonId?: string | null;
    contactTypeId?: string | null;
  };
  action: CaseRuleAction;
  /** set_contact_type */
  contactTypeId?: string | null;
  fromNthWin?: number | null;
  /** schedule_case */
  scheduleCaseTypeId?: string | null;
  scheduleMode?: "days_after" | "days_before_key_date";
  days?: number | null;
  /** ask_key_date */
  label?: string | null;
}

export interface RuleContext {
  caseTypeId: string;
  stages: readonly { id: string; caseTypeId: string; archived: boolean }[];
  categories: readonly { id: string; caseTypeId: string }[];
  reasons: readonly { id: string; caseTypeId: string; kind: OutcomeKind }[];
  /** Tipos de contacto del espacio. */
  contactTypes: readonly { id: string; archived: boolean }[];
  /** Tipos de gestión del espacio. */
  caseTypes: readonly { id: string; archived: boolean }[];
  keyDateLabel: string;
}

export interface ValidRule {
  trigger: CaseRuleTrigger;
  triggerStageId: string | null;
  condition: CaseRuleCondition;
  action: CaseRuleAction;
  params: Record<string, unknown>;
}

const TRIGGER_KIND: Partial<Record<CaseRuleTrigger, OutcomeKind>> = {
  on_won: "won",
  on_lost: "lost",
  on_resolved: "resolved",
};

function intInRange(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Valida una regla y arma lo que se guarda en `case_rules`. */
export function validateRuleInput(input: RuleInput, ctx: RuleContext): { ok: true; rule: ValidRule } | { error: string } {
  if (!(RULE_TRIGGERS as readonly string[]).includes(input.trigger)) return { error: "Elige el momento de la regla." };
  if (!(RULE_ACTIONS as readonly string[]).includes(input.action)) return { error: "Elige la acción de la regla." };

  let triggerStageId: string | null = null;
  if (input.trigger === "on_stage") {
    const stage = ctx.stages.find((s) => s.id === input.triggerStageId);
    if (!stage || stage.caseTypeId !== ctx.caseTypeId || stage.archived) {
      return { error: "Elige una etapa activa de este tipo de gestión." };
    }
    triggerStageId = stage.id;
  }

  const condition: CaseRuleCondition = {};
  const cond = input.condition ?? {};
  if (cond.categoryId) {
    if (!ctx.categories.some((c) => c.id === cond.categoryId && c.caseTypeId === ctx.caseTypeId)) {
      return { error: "La categoría de la condición no es de este tipo de gestión." };
    }
    condition.category_id = cond.categoryId;
  }
  if (cond.outcomeReasonId) {
    const reason = ctx.reasons.find((r) => r.id === cond.outcomeReasonId && r.caseTypeId === ctx.caseTypeId);
    if (!reason) return { error: "El motivo de la condición no es de este tipo de gestión." };
    const expected = TRIGGER_KIND[input.trigger];
    if (!expected) return { error: "La condición de motivo solo aplica al ganar, perder o resolver." };
    if (reason.kind !== expected) return { error: "El motivo no corresponde al momento elegido." };
    condition.outcome_reason_id = reason.id;
  }
  if (cond.contactTypeId) {
    if (!ctx.contactTypes.some((c) => c.id === cond.contactTypeId)) {
      return { error: "El tipo de contacto de la condición no existe." };
    }
    condition.contact_type_id = cond.contactTypeId;
  }

  let params: Record<string, unknown>;
  if (input.action === "set_contact_type") {
    const target = ctx.contactTypes.find((c) => c.id === input.contactTypeId);
    if (!target || target.archived) return { error: "Elige el tipo de contacto al que pasará el contacto." };
    params = { contact_type_id: target.id };
    if (input.fromNthWin !== null && input.fromNthWin !== undefined) {
      const nth = intInRange(input.fromNthWin, 1, MAX_NTH_WIN);
      if (nth === null) return { error: `"Desde la vez número" debe ser un entero entre 1 y ${MAX_NTH_WIN}.` };
      if (nth >= 2) params.from_nth_win = nth;
    }
  } else if (input.action === "schedule_case") {
    const target = ctx.caseTypes.find((c) => c.id === input.scheduleCaseTypeId);
    if (!target || target.archived) return { error: "Elige el tipo de gestión que se programará." };
    const mode = input.scheduleMode === "days_before_key_date" ? "days_before_key_date" : "days_after";
    const days = intInRange(input.days, 0, MAX_RULE_DAYS);
    if (days === null) return { error: `Los días deben ser un entero entre 0 y ${MAX_RULE_DAYS}.` };
    params = { case_type_id: target.id, [mode]: days };
  } else {
    const label = cleanName(input.label) ?? cleanName(ctx.keyDateLabel) ?? "Fecha clave";
    params = { label };
  }

  return { ok: true, rule: { trigger: input.trigger, triggerStageId, condition, action: input.action, params } };
}

export interface RuleLookup {
  stages: readonly { id: string; name: string }[];
  categories: readonly { id: string; name: string }[];
  reasons: readonly { id: string; name: string }[];
  contactTypes: readonly { id: string; name: string }[];
  caseTypes: readonly { id: string; name: string }[];
}

const MISSING = "(eliminado)";

function lookupName(list: readonly { id: string; name: string }[], id: unknown): string {
  return list.find((x) => x.id === id)?.name ?? MISSING;
}

/** Frase corta que describe una regla, para la lista. */
export function describeRule(
  rule: Pick<RuleConfig, "trigger" | "triggerStageId" | "condition" | "action" | "params">,
  lookup: RuleLookup,
): {
  when: string;
  condition: string | null;
  what: string;
} {
  const when =
    rule.trigger === "on_stage"
      ? `${TRIGGER_LABELS.on_stage}: ${lookupName(lookup.stages, rule.triggerStageId)}`
      : TRIGGER_LABELS[rule.trigger];

  const parts: string[] = [];
  if (rule.condition.category_id) parts.push(`categoría ${lookupName(lookup.categories, rule.condition.category_id)}`);
  if (rule.condition.outcome_reason_id) parts.push(`motivo ${lookupName(lookup.reasons, rule.condition.outcome_reason_id)}`);
  if (rule.condition.contact_type_id) parts.push(`contacto ${lookupName(lookup.contactTypes, rule.condition.contact_type_id)}`);

  let what: string;
  const p = rule.params;
  if (rule.action === "set_contact_type") {
    const nth = typeof p.from_nth_win === "number" ? p.from_nth_win : null;
    what = `Cambiar el tipo de contacto a ${lookupName(lookup.contactTypes, p.contact_type_id)}${nth ? ` desde la vez número ${nth}` : ""}`;
  } else if (rule.action === "schedule_case") {
    const type = lookupName(lookup.caseTypes, p.case_type_id);
    if (typeof p.days_before_key_date === "number") {
      what = `Programar ${type} ${p.days_before_key_date} ${p.days_before_key_date === 1 ? "día" : "días"} antes de la fecha clave`;
    } else {
      const d = typeof p.days_after === "number" ? p.days_after : 0;
      what = `Programar ${type} ${d} ${d === 1 ? "día" : "días"} después`;
    }
  } else {
    what = `Pedir la fecha clave (${typeof p.label === "string" && p.label ? p.label : "Fecha clave"})`;
  }
  return { when, condition: parts.length ? `Si ${parts.join(" y ")}` : null, what };
}

// ── Cambios en el registro ─────────────────────────────────────────────────

/** Campos que cambiaron, para `activity.meta.changes`. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
      changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
    }
  }
  return changes;
}

// ── Tipos de contacto ──────────────────────────────────────────────────────

/** Un solo tipo por defecto activo: el elegido queda como tal y el resto no. */
export function planDefaultContactType(
  types: readonly { id: string; isDefault: boolean; archived: boolean }[],
  id: string | null,
): { error: string } | { clear: string[]; set: string | null } {
  if (id === null) return { clear: types.filter((t) => t.isDefault).map((t) => t.id), set: null };
  const target = types.find((t) => t.id === id);
  if (!target) return { error: "No se encontró el tipo de contacto." };
  if (target.archived) return { error: "Reactiva el tipo de contacto antes de dejarlo por defecto." };
  return { clear: types.filter((t) => t.isDefault && t.id !== id).map((t) => t.id), set: id };
}

/** Etiqueta de la fecha clave: vacía se quita, si no hasta 100 caracteres. */
export function cleanKeyDateLabel(raw: unknown): string | null | undefined {
  if (typeof raw !== "string") return undefined;
  const label = raw.trim().replace(/\s+/g, " ");
  if (label === "") return null;
  return label.length <= MAX_NAME_LENGTH ? label : undefined;
}
