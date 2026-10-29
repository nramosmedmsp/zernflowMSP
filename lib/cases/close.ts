// Cierre de una gestión y vista previa de sus reglas (docs/FASE-1-TECNICO.md 3.4).

import { CASE_NOT_FOUND } from "./access";
import { isDateString, parseScheduleAt } from "./dates";
import { applyRulePlan, countWins, loadRules, resumeAutomationIfIdle, type RuleEffects } from "./effects";
import { emitCaseClosed, emitStageChanged } from "./events";
import {
  GENERIC_ERROR,
  caseLink,
  contactName,
  loadCase,
  loadCaseType,
  logActivity,
  userDisplayName,
  type CaseRow,
  type CaseTypeRow,
  type ContactRow,
  type Db,
  type EngineResult,
} from "./io";
import { notifySupervisors } from "./supervisors";
import {
  CLOSE_TRIGGER,
  OUTCOME_LABELS,
  needsKeyDate,
  planRules,
  validateClose,
  type ParsedRule,
  type PlannedSchedule,
  type RuleEventContext,
} from "./rules";
import type { OutcomeKind } from "@/lib/types/database";

export interface CloseCaseInput {
  caseId: string;
  /** Etapa final elegida, o `kind` para usar la primera etapa de esa clase. */
  stageId?: string | null;
  kind?: OutcomeKind | null;
  outcomeReasonId?: string | null;
  /** undefined = conservar la categoría actual. */
  categoryId?: string | null;
  note?: string | null;
  /** Fecha clave ("YYYY-MM-DD") si una regla la pide (ask_key_date). */
  keyDate?: string | null;
  overrides?: {
    /** Fecha de la gestión programada elegida por el asesor ("YYYY-MM-DD" o ISO). */
    schedule_at?: string | null;
    /** No programar nada esta vez. */
    skip_schedule?: boolean;
  };
}

export const MAX_OUTCOME_NOTE_LENGTH = 2000;
export const CLOSE_REQUEST_RESOLVED = "El pedido de cierre ya fue resuelto.";

interface Prepared {
  row: CaseRow;
  contact: ContactRow;
  type: CaseTypeRow | null;
  /** Nombre de la etapa final elegida (null si el tipo no define etapas finales). */
  stageName: string | null;
  kind: OutcomeKind;
  stageId: string | null;
  outcomeReasonId: string | null;
  categoryId: string | null;
  rules: ParsedRule[];
  ctx: RuleEventContext;
  wonCount: number;
  askKeyDate: { label: string } | null;
  requires: { category: boolean; outcomeReason: boolean };
}

async function prepareClose(
  db: Db,
  input: CloseCaseInput,
  options: { preview: boolean },
): Promise<Prepared | { error: string }> {
  const row = await loadCase(db, input.caseId);
  if (!row) return { error: CASE_NOT_FOUND };
  if (row.status !== "open") {
    return { error: row.status === "scheduled" ? "La gestión está programada; todavía no se puede cerrar." : "La gestión ya está cerrada." };
  }

  const [type, { data: contact }] = await Promise.all([
    row.case_type_id ? loadCaseType(db, row.workspace_id, row.case_type_id) : Promise.resolve(null),
    db.from("contacts").select("*").eq("id", row.contact_id).eq("workspace_id", row.workspace_id).maybeSingle(),
  ]);
  if (!contact) return { error: CASE_NOT_FOUND };
  if (row.case_type_id && !type) return { error: "El tipo de la gestión no pertenece a este espacio." };

  const [stages, reasons, categories] = type
    ? await Promise.all([
        db.from("case_stages").select("id, name, kind, position, archived_at").eq("case_type_id", type.id),
        db.from("case_outcome_reasons").select("id, name, kind, archived_at").eq("case_type_id", type.id),
        db.from("case_categories").select("id, archived_at").eq("case_type_id", type.id),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const caseType = type
    ? {
        require_category: options.preview ? false : type.require_category,
        require_outcome_reason: options.preview ? false : type.require_outcome_reason,
      }
    : null;

  const validation = validateClose({
    caseType,
    stages: stages.data ?? [],
    reasons: reasons.data ?? [],
    categories: categories.data ?? [],
    currentCategoryId: row.category_id,
    request: {
      stageId: input.stageId,
      kind: input.kind,
      outcomeReasonId: input.outcomeReasonId,
      categoryId: input.categoryId,
    },
  });
  if (!validation.ok) return { error: validation.error };

  const rules = await loadRules(db, row.case_type_id);
  const ctx: RuleEventContext = {
    trigger: CLOSE_TRIGGER[validation.kind],
    stageId: validation.stageId,
    categoryId: validation.categoryId,
    outcomeReasonId: validation.outcomeReasonId,
    contactTypeId: contact.contact_type_id,
  };
  const wins = rules.length > 0 ? await countWins(db, contact.id, row.id) : 0;

  return {
    row,
    contact,
    type,
    stageName: (stages.data ?? []).find((st) => st.id === validation.stageId)?.name ?? null,
    kind: validation.kind,
    stageId: validation.stageId,
    outcomeReasonId: validation.outcomeReasonId,
    categoryId: validation.categoryId,
    rules,
    ctx,
    wonCount: wins + (validation.kind === "won" ? 1 : 0),
    askKeyDate: needsKeyDate(rules, ctx),
    requires: {
      category: !!type?.require_category,
      outcomeReason:
        !!type?.require_outcome_reason &&
        (reasons.data ?? []).some((r) => r.kind === validation.kind && r.archived_at === null),
    },
  };
}

export interface CheckedClose {
  kind: OutcomeKind;
  stageId: string | null;
  stageName: string | null;
  outcomeReasonId: string | null;
  categoryId: string | null;
  type: CaseTypeRow | null;
  row: CaseRow;
}

/**
 * Valida un cierre (etapa, categoría y motivo obligatorios) sin escribir nada.
 * Lo usa el pedido de cierre para no guardar un pedido que luego no se pueda
 * aprobar.
 */
export async function checkClose(db: Db, input: CloseCaseInput): Promise<CheckedClose | { error: string }> {
  const prepared = await prepareClose(db, input, { preview: false });
  if ("error" in prepared) return prepared;
  return {
    kind: prepared.kind,
    stageId: prepared.stageId,
    stageName: prepared.stageName,
    outcomeReasonId: prepared.outcomeReasonId,
    categoryId: prepared.categoryId,
    type: prepared.type,
    row: prepared.row,
  };
}

export interface ClosePreview {
  kind: OutcomeKind;
  stageId: string | null;
  /** El tipo exige categoría / motivo para este resultado. */
  requires: { category: boolean; outcomeReason: boolean };
  /** Hay que pedir la fecha clave (con la actual del contacto para precargar). */
  askKeyDate: { label: string; current: string | null } | null;
  contactType: { from: string | null; to: string } | null;
  /** Gestiones que se programarán, con la fecha calculada. */
  schedules: (PlannedSchedule & { caseTypeName: string | null })[];
  /** Gestiones que una regla pediría pero no se pueden programar (el tipo está archivado). */
  blocked: { ruleId: string; caseTypeName: string | null }[];
}

/**
 * Vista previa del cierre para el diálogo: resultado, si hay que pedir la
 * fecha clave, el cambio de tipo de contacto y la fecha calculada de cada
 * gestión programada (p. ej. la Recompra en 25 días). No escribe nada.
 */
export async function previewClose(
  db: Db,
  input: CloseCaseInput,
  now: Date = new Date(),
): Promise<EngineResult<{ preview: ClosePreview }>> {
  const prepared = await prepareClose(db, input, { preview: true });
  if ("error" in prepared) return prepared;
  const keyDate =
    prepared.askKeyDate && isDateString(input.keyDate) ? input.keyDate : prepared.contact.key_date;
  const plan = planRules({
    rules: prepared.rules,
    ctx: prepared.ctx,
    wonCount: prepared.wonCount,
    now,
    keyDate,
    overrides: { scheduleAt: input.overrides?.schedule_at, skipSchedule: input.overrides?.skip_schedule },
  });

  const typeIds = [...new Set(plan.schedules.map((s) => s.caseTypeId))];
  const { data: types } = typeIds.length
    ? await db.from("case_types").select("id, name, archived_at").eq("workspace_id", prepared.row.workspace_id).in("id", typeIds)
    : { data: [] as { id: string; name: string; archived_at: string | null }[] };
  const names = new Map((types ?? []).map((t) => [t.id, t.name]));
  // Igual que al cerrar (applyRulePlan): un tipo archivado o borrado no se programa.
  const usable = new Set((types ?? []).filter((t) => !t.archived_at).map((t) => t.id));

  return {
    ok: true,
    preview: {
      kind: prepared.kind,
      stageId: prepared.stageId,
      requires: prepared.requires,
      askKeyDate: prepared.askKeyDate
        ? { label: prepared.askKeyDate.label, current: prepared.contact.key_date }
        : null,
      contactType:
        plan.contactTypeId !== undefined
          ? { from: prepared.contact.contact_type_id, to: plan.contactTypeId }
          : null,
      schedules: plan.schedules
        .filter((s) => usable.has(s.caseTypeId))
        .map((s) => ({ ...s, caseTypeName: names.get(s.caseTypeId) ?? null })),
      blocked: plan.schedules
        .filter((s) => !usable.has(s.caseTypeId))
        .map((s) => ({ ruleId: s.ruleId, caseTypeName: names.get(s.caseTypeId) ?? null })),
    },
  };
}

/**
 * Cierra la gestión: valida etapa, categoría y motivo; fija status según la
 * clase de la etapa final, closed_at y closed_by; reanuda el bot si el
 * contacto no tiene otra gestión abierta; y ejecuta las reglas del tipo.
 */
export async function closeCase(
  db: Db,
  input: CloseCaseInput & {
    actorId: string | null;
    /** Datos extra para el registro de actividad (por ejemplo quién pidió el cierre). */
    activityMeta?: Record<string, unknown>;
    /**
     * Cierra solo si el pedido de cierre sigue pendiente (aprobación de un
     * supervisor): si otro supervisor lo rechazó o aprobó antes, no cierra.
     */
    requireCloseRequest?: boolean;
  },
  now: Date = new Date(),
): Promise<EngineResult<{ status: OutcomeKind; effects: RuleEffects }>> {
  const prepared = await prepareClose(db, input, { preview: false });
  if ("error" in prepared) return prepared;
  const { row, contact } = prepared;

  const note = input.note?.trim() || null;
  if (note && note.length > MAX_OUTCOME_NOTE_LENGTH) {
    return { error: `La nota de cierre admite hasta ${MAX_OUTCOME_NOTE_LENGTH} caracteres.` };
  }

  let keyDate: string | null = null;
  if (prepared.askKeyDate) {
    if (!isDateString(input.keyDate)) return { error: `Indica la fecha: ${prepared.askKeyDate.label}.` };
    keyDate = input.keyDate;
  }
  if (input.overrides?.schedule_at && !parseScheduleAt(input.overrides.schedule_at, now)) {
    return { error: "La fecha de la gestión programada no es válida." };
  }

  const closedAt = now.toISOString();
  let closeQuery = db
    .from("cases")
    .update({
      status: prepared.kind,
      stage_id: prepared.stageId,
      category_id: prepared.categoryId,
      outcome_reason_id: prepared.outcomeReasonId,
      outcome_note: note,
      closed_at: closedAt,
      closed_by: input.actorId,
      waiting_since: null,
      next_action_at: null,
      next_action_note: null,
      next_action_notified_at: null,
      // Cerrar deja sin efecto cualquier pedido de cierre pendiente.
      close_request: null,
    })
    .eq("id", row.id)
    .eq("status", "open");
  if (input.requireCloseRequest) closeQuery = closeQuery.not("close_request", "is", null);
  const { data: updated, error } = await closeQuery.select("*");
  if (error) return { error: GENERIC_ERROR };
  if (!updated || updated.length === 0) {
    return { error: input.requireCloseRequest ? CLOSE_REQUEST_RESOLVED : "La gestión ya está cerrada." };
  }
  const closed = updated[0];

  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: "case_closed",
    case_id: row.id,
    contact_id: row.contact_id,
    actor_id: input.actorId,
    // from_value: etapa previa (la reapertura vuelve a ella); to_value: resultado.
    from_value: row.stage_id,
    to_value: prepared.kind,
    meta: {
      stage_id: prepared.stageId,
      outcome_reason_id: prepared.outcomeReasonId,
      category_id: prepared.categoryId,
      ...(note ? { note } : {}),
      ...(keyDate ? { key_date: keyDate } : {}),
      ...(input.activityMeta ?? {}),
    },
  });
  emitStageChanged(db, closed, row.stage_id, prepared.stageId);
  emitCaseClosed(db, closed, prepared.stageId, prepared.kind);

  const plan = planRules({
    rules: prepared.rules,
    ctx: prepared.ctx,
    wonCount: prepared.wonCount,
    now,
    keyDate: keyDate ?? contact.key_date,
    overrides: { scheduleAt: input.overrides?.schedule_at, skipSchedule: input.overrides?.skip_schedule },
  });
  const effects = await applyRulePlan(db, { plan, caseRow: closed, contact, actorId: input.actorId, keyDate });

  await resumeAutomationIfIdle(db, row.workspace_id, row.contact_id);

  // Tipo protegido: se avisa a los supervisores del cierre, sea cual sea el resultado.
  if (prepared.type?.protected) {
    try {
      const actor = await userDisplayName(db, input.actorId);
      const outcome = prepared.stageName ?? OUTCOME_LABELS[prepared.kind];
      await notifySupervisors(
        db,
        closed,
        {
          type: "protected_closed",
          title: `${prepared.type.name} cerrada como «${outcome}»: ${contactName(contact)}`,
          body: `${actor}${note ? `: ${note}` : ""}`,
          link: caseLink(row.contact_id, row.id),
        },
        { exclude: [input.actorId] },
      );
    } catch (err) {
      console.error("[cases] notify protected close", err);
    }
  }
  return { ok: true, status: prepared.kind, effects };
}
