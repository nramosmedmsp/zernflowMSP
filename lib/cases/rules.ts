// Decisiones puras del motor de gestiones (docs/FASE-1-TECNICO.md 3.1, 3.2 y
// 3.4): sellos de tiempo, reapertura, validación del cierre y reglas.

import type {
  CaseRuleAction,
  CaseRuleTrigger,
  CaseStatus,
  Json,
  OutcomeKind,
  StageKind,
} from "@/lib/types/database";
import { REOPEN_WINDOW_MS, addDays, isDateString, limaDateOf, parseScheduleAt, scheduleInstant } from "./dates";

export const CLOSED_OUTCOMES: readonly OutcomeKind[] = ["won", "lost", "resolved"];

export const OUTCOME_LABELS: Record<OutcomeKind, string> = {
  won: "Ganada",
  lost: "Perdida",
  resolved: "Resuelta",
};

export function isOutcomeKind(value: unknown): value is OutcomeKind {
  return typeof value === "string" && (CLOSED_OUTCOMES as readonly string[]).includes(value);
}

export const CLOSE_TRIGGER: Record<OutcomeKind, CaseRuleTrigger> = {
  won: "on_won",
  lost: "on_lost",
  resolved: "on_resolved",
};

// ── Sellos de tiempo ───────────────────────────────────────────────────────

export interface CaseTimestamps {
  waiting_since: string | null;
  first_response_at: string | null;
}

/** 3.1 paso 2: sella la entrada del cliente; la espera empieza si no había. */
export function inboundPatch(current: Pick<CaseTimestamps, "waiting_since">, at: string) {
  return { last_inbound_at: at, waiting_since: current.waiting_since ?? at };
}

/**
 * 3.2: respuesta de una persona. Sella la salida, limpia la espera y, si es la
 * primera respuesta humana y había espera, fija first_response_at y devuelve
 * la duración en segundos para el registro.
 */
export function humanOutboundPatch(current: CaseTimestamps, at: string) {
  const patch: {
    last_outbound_at: string;
    waiting_since: null;
    first_response_at?: string;
  } = { last_outbound_at: at, waiting_since: null };

  let firstResponseSeconds: number | null = null;
  // Fase 3: segundos de cada espera del cliente que esta respuesta cierra (la
  // primera incluida); es lo que registra la actividad human_reply.
  let replySeconds: number | null = null;
  if (current.waiting_since !== null) {
    replySeconds = Math.max(
      0,
      Math.round((new Date(at).getTime() - new Date(current.waiting_since).getTime()) / 1000),
    );
  }
  if (current.first_response_at === null && current.waiting_since !== null) {
    patch.first_response_at = at;
    firstResponseSeconds = replySeconds;
  }
  return { patch, firstResponseSeconds, replySeconds };
}

/** 3.2: el bot solo sella la salida (no cuenta como respuesta ni corta la espera). */
export function botOutboundPatch(at: string) {
  return { last_outbound_at: at };
}

/**
 * 3.4: ¿se reabre esta gestión cerrada en vez de abrir otra? Dentro de la
 * ventana del tipo (`case_types.reopen_window_days`) o, por defecto, 24 h.
 */
export function shouldReopen(
  closed: { status: CaseStatus; closed_at: string | null },
  at: string,
  windowMs: number = REOPEN_WINDOW_MS,
): boolean {
  if (!isOutcomeKind(closed.status) || !closed.closed_at) return false;
  const elapsed = new Date(at).getTime() - new Date(closed.closed_at).getTime();
  return elapsed >= 0 && elapsed < windowMs;
}

// ── Validación del cierre ──────────────────────────────────────────────────

export interface CloseStage {
  id: string;
  name: string;
  kind: StageKind;
  position: number;
  archived_at: string | null;
}

export interface CloseReason {
  id: string;
  name: string;
  kind: OutcomeKind;
  archived_at: string | null;
}

export interface CloseCategory {
  id: string;
  archived_at: string | null;
}

export interface CloseValidationInput {
  /** null = gestión sin clasificar. */
  caseType: { require_category: boolean; require_outcome_reason: boolean } | null;
  stages: readonly CloseStage[];
  reasons: readonly CloseReason[];
  categories: readonly CloseCategory[];
  currentCategoryId: string | null;
  request: {
    stageId?: string | null;
    kind?: string | null;
    outcomeReasonId?: string | null;
    /** undefined = conservar la actual */
    categoryId?: string | null;
  };
}

export type CloseValidation =
  | { ok: true; kind: OutcomeKind; stageId: string | null; outcomeReasonId: string | null; categoryId: string | null }
  | { ok: false; error: string };

/**
 * Valida el cierre: etapa final del tipo (o la primera de la clase pedida),
 * motivo del mismo tipo y clase, y categoría o motivo si el tipo los exige.
 * El motivo solo se exige si el tipo tiene motivos activos de esa clase.
 * Una gestión sin clasificar solo se puede cerrar como resuelta.
 */
export function validateClose(input: CloseValidationInput): CloseValidation {
  const { request } = input;
  const categoryId = request.categoryId === undefined ? input.currentCategoryId : request.categoryId;

  if (!input.caseType) {
    const kind = request.kind ?? "resolved";
    if (request.stageId) return { ok: false, error: "La etapa no pertenece a esta gestión." };
    if (kind !== "resolved") {
      return { ok: false, error: "Clasifica la gestión antes de cerrarla como ganada o perdida." };
    }
    if (request.outcomeReasonId) return { ok: false, error: "El motivo no pertenece a esta gestión." };
    return { ok: true, kind: "resolved", stageId: null, outcomeReasonId: null, categoryId: null };
  }

  const activeStages = input.stages
    .filter((s) => s.archived_at === null)
    .sort((a, b) => a.position - b.position);

  let stage: CloseStage | undefined;
  if (request.stageId) {
    stage = activeStages.find((s) => s.id === request.stageId);
    if (!stage) return { ok: false, error: "La etapa no pertenece a este tipo de gestión." };
    if (stage.kind === "open") {
      return { ok: false, error: "Elige una etapa de cierre: ganada, perdida o resuelta." };
    }
    if (request.kind && request.kind !== stage.kind) {
      return { ok: false, error: "La etapa no corresponde al resultado elegido." };
    }
  } else {
    if (!isOutcomeKind(request.kind)) return { ok: false, error: "Elige el resultado de la gestión." };
    stage = activeStages.find((s) => s.kind === request.kind);
    if (!stage) {
      return {
        ok: false,
        error: `Este tipo de gestión no tiene una etapa "${OUTCOME_LABELS[request.kind].toLowerCase()}".`,
      };
    }
  }
  const kind = stage.kind as OutcomeKind;

  if (categoryId) {
    const category = input.categories.find((c) => c.id === categoryId);
    if (!category) return { ok: false, error: "La categoría no pertenece a este tipo de gestión." };
    if (category.archived_at !== null && categoryId !== input.currentCategoryId) {
      return { ok: false, error: "Esa categoría está archivada." };
    }
  } else if (input.caseType.require_category && input.categories.some((c) => c.archived_at === null)) {
    // R2-6: sin categorías activas no hay qué elegir, así que no se exige (no bloquea los cierres).
    return { ok: false, error: "Elige una categoría antes de cerrar." };
  }

  let outcomeReasonId: string | null = null;
  if (request.outcomeReasonId) {
    const reason = input.reasons.find((r) => r.id === request.outcomeReasonId);
    if (!reason || reason.archived_at !== null) {
      return { ok: false, error: "El motivo no pertenece a este tipo de gestión." };
    }
    if (reason.kind !== kind) return { ok: false, error: "El motivo no corresponde al resultado elegido." };
    outcomeReasonId = reason.id;
  } else if (
    input.caseType.require_outcome_reason &&
    input.reasons.some((r) => r.kind === kind && r.archived_at === null)
  ) {
    return { ok: false, error: "Elige el motivo del resultado." };
  }

  return { ok: true, kind, stageId: stage.id, outcomeReasonId, categoryId: categoryId ?? null };
}

// ── Reglas ─────────────────────────────────────────────────────────────────

export interface RuleCondition {
  category_id?: string;
  outcome_reason_id?: string;
  contact_type_id?: string;
}

export type ParsedRule =
  | (RuleBase & { action: "set_contact_type"; params: { contact_type_id: string; from_nth_win?: number } })
  | (RuleBase & {
      action: "schedule_case";
      params: { case_type_id: string; days_after?: number; days_before_key_date?: number };
    })
  | (RuleBase & { action: "ask_key_date"; params: { label: string } });

interface RuleBase {
  id: string;
  position: number;
  trigger: CaseRuleTrigger;
  trigger_stage_id: string | null;
  condition: RuleCondition;
}

export interface RuleRow {
  id: string;
  position: number;
  enabled: boolean;
  trigger: CaseRuleTrigger;
  trigger_stage_id: string | null;
  condition: Json;
  action: CaseRuleAction;
  params: Json;
}

function asObject(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function str(value: Json | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function nonNegativeInt(value: Json | undefined): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Convierte una fila de case_rules; null si está apagada o sus parámetros no sirven. */
export function parseRule(row: RuleRow): ParsedRule | null {
  if (!row.enabled) return null;
  const cond = asObject(row.condition);
  const condition: RuleCondition = {};
  if (str(cond.category_id)) condition.category_id = str(cond.category_id);
  if (str(cond.outcome_reason_id)) condition.outcome_reason_id = str(cond.outcome_reason_id);
  if (str(cond.contact_type_id)) condition.contact_type_id = str(cond.contact_type_id);
  const base: RuleBase = {
    id: row.id,
    position: row.position,
    trigger: row.trigger,
    trigger_stage_id: row.trigger_stage_id,
    condition,
  };
  const p = asObject(row.params);

  switch (row.action) {
    case "set_contact_type": {
      const contactTypeId = str(p.contact_type_id);
      if (!contactTypeId) return null;
      const nth = nonNegativeInt(p.from_nth_win);
      return {
        ...base,
        action: "set_contact_type",
        params: { contact_type_id: contactTypeId, ...(nth && nth > 1 ? { from_nth_win: nth } : {}) },
      };
    }
    case "schedule_case": {
      const caseTypeId = str(p.case_type_id);
      if (!caseTypeId) return null;
      const before = nonNegativeInt(p.days_before_key_date);
      const after = nonNegativeInt(p.days_after);
      if (before !== undefined) {
        return { ...base, action: "schedule_case", params: { case_type_id: caseTypeId, days_before_key_date: before } };
      }
      return { ...base, action: "schedule_case", params: { case_type_id: caseTypeId, days_after: after ?? 0 } };
    }
    case "ask_key_date": {
      const label = str(p.label);
      return { ...base, action: "ask_key_date", params: { label: label ?? "Fecha clave" } };
    }
    default:
      return null;
  }
}

export interface RuleEventContext {
  trigger: CaseRuleTrigger;
  /** Etapa nueva (on_stage) o etapa final (cierre). */
  stageId: string | null;
  categoryId: string | null;
  outcomeReasonId: string | null;
  /** Tipo del contacto antes de aplicar las reglas. */
  contactTypeId: string | null;
}

export function ruleMatches(rule: ParsedRule, ctx: RuleEventContext): boolean {
  if (rule.trigger !== ctx.trigger) return false;
  if (rule.trigger === "on_stage" && rule.trigger_stage_id !== ctx.stageId) return false;
  const c = rule.condition;
  if (c.category_id && c.category_id !== ctx.categoryId) return false;
  if (c.outcome_reason_id && c.outcome_reason_id !== ctx.outcomeReasonId) return false;
  if (c.contact_type_id && c.contact_type_id !== ctx.contactTypeId) return false;
  return true;
}

export interface PlannedSchedule {
  ruleId: string;
  caseTypeId: string;
  /** Instante ISO; null si falta la fecha clave. */
  scheduledFor: string | null;
  basis: "days_after" | "days_before_key_date" | "override";
  days: number;
  missingKeyDate: boolean;
}

export interface RulePlan {
  matchedRuleIds: string[];
  /** Tipo de contacto final (undefined = no cambia). */
  contactTypeId?: string;
  schedules: PlannedSchedule[];
  /** Hay que pedir la fecha clave al cerrar. */
  askKeyDate: { ruleId: string; label: string } | null;
}

export interface PlanRulesInput {
  rules: readonly ParsedRule[];
  ctx: RuleEventContext;
  /** Gestiones ganadas del contacto, contando la que se cierra si es ganada. */
  wonCount: number;
  now: Date;
  /** Fecha clave vigente (la que se pide al cerrar, o la del contacto). */
  keyDate: string | null;
  overrides?: { scheduleAt?: string | null; skipSchedule?: boolean };
}

/**
 * Aplica las reglas que coinciden, en orden de `position`:
 * - set_contact_type: gana la regla MÁS ESPECÍFICA (la de mayor "desde la N.ª
 *   ganada"); a igual especificidad, la última por posición. Así "Cliente" y
 *   "Cliente frecuente desde la 2.ª" dejan uno solo, sin importar el orden
 *   en que se escribieron (R2-15);
 * - schedule_case: hoy + N días, o N días antes de la fecha clave, a las 09:00
 *   de Lima; `overrides.scheduleAt` reemplaza la fecha calculada;
 * - ask_key_date: avisa que hay que pedir la fecha clave.
 */
export function planRules(input: PlanRulesInput): RulePlan {
  const plan: RulePlan = { matchedRuleIds: [], schedules: [], askKeyDate: null };
  const ordered = [...input.rules].sort((a, b) => a.position - b.position);
  const override = input.overrides?.scheduleAt ? parseScheduleAt(input.overrides.scheduleAt, input.now) : null;
  let typeSpecificity = -1;

  for (const rule of ordered) {
    if (!ruleMatches(rule, input.ctx)) continue;

    if (rule.action === "set_contact_type") {
      const nth = rule.params.from_nth_win;
      if (nth && input.wonCount < nth) continue;
      plan.matchedRuleIds.push(rule.id);
      const specificity = nth ?? 1;
      if (specificity >= typeSpecificity) {
        typeSpecificity = specificity;
        plan.contactTypeId = rule.params.contact_type_id;
      }
      continue;
    }

    if (rule.action === "ask_key_date") {
      plan.matchedRuleIds.push(rule.id);
      if (!plan.askKeyDate) plan.askKeyDate = { ruleId: rule.id, label: rule.params.label };
      continue;
    }

    // schedule_case
    if (input.overrides?.skipSchedule) continue;
    plan.matchedRuleIds.push(rule.id);
    const today = limaDateOf(input.now);
    if (rule.params.days_before_key_date !== undefined) {
      const days = rule.params.days_before_key_date;
      const keyDate = isDateString(input.keyDate) ? input.keyDate : null;
      plan.schedules.push({
        ruleId: rule.id,
        caseTypeId: rule.params.case_type_id,
        scheduledFor: override ?? (keyDate ? scheduleInstant(addDays(keyDate, -days), input.now) : null),
        basis: override ? "override" : "days_before_key_date",
        days,
        missingKeyDate: !override && !keyDate,
      });
    } else {
      const days = rule.params.days_after ?? 0;
      plan.schedules.push({
        ruleId: rule.id,
        caseTypeId: rule.params.case_type_id,
        scheduledFor: override ?? scheduleInstant(addDays(today, days), input.now),
        basis: override ? "override" : "days_after",
        days,
        missingKeyDate: false,
      });
    }
  }

  // El mismo cambio de tipo que ya tiene el contacto no es un cambio.
  if (plan.contactTypeId !== undefined && plan.contactTypeId === input.ctx.contactTypeId) {
    delete plan.contactTypeId;
  }
  return plan;
}

/** ¿Alguna regla de este evento pide la fecha clave? (para saber si exigirla). */
export function needsKeyDate(rules: readonly ParsedRule[], ctx: RuleEventContext): { label: string } | null {
  const rule = [...rules]
    .sort((a, b) => a.position - b.position)
    .find((r) => r.action === "ask_key_date" && ruleMatches(r, ctx));
  return rule && rule.action === "ask_key_date" ? { label: rule.params.label } : null;
}
