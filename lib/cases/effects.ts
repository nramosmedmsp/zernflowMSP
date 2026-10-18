// Ejecución de reglas de gestión y efectos sobre el contacto y el bot.

import { firstOpenStageId, logActivity, type CaseRow, type ContactRow, type Db } from "./io";
import { parseRule, planRules, type ParsedRule, type RuleEventContext, type RulePlan } from "./rules";

/** Reglas activas de un tipo, en orden. */
export async function loadRules(db: Db, caseTypeId: string | null): Promise<ParsedRule[]> {
  if (!caseTypeId) return [];
  const { data, error } = await db
    .from("case_rules")
    .select("id, position, enabled, trigger, trigger_stage_id, condition, action, params")
    .eq("case_type_id", caseTypeId)
    .eq("enabled", true)
    .order("position", { ascending: true });
  if (error) console.error("[cases] load rules", error.message);
  return (data ?? []).map(parseRule).filter((r): r is ParsedRule => r !== null);
}

/** Gestiones ganadas del contacto, sin contar `excludeCaseId`. */
export async function countWins(db: Db, contactId: string, excludeCaseId: string): Promise<number> {
  const { count } = await db
    .from("cases")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .eq("status", "won")
    .neq("id", excludeCaseId);
  return count ?? 0;
}

export interface RuleEffects {
  contactType?: { from: string | null; to: string };
  keyDate?: { from: string | null; to: string };
  scheduled: { caseId: string; caseTypeId: string; scheduledFor: string; rescheduled: boolean }[];
  skipped: { ruleId: string; reason: "missing_key_date" | "invalid_case_type" | "invalid_contact_type" | "error" }[];
}

/**
 * Crea la gestión programada, o mueve la fecha de una programada del mismo
 * tipo que ya tenga el contacto (dos ventas seguidas no dejan dos recompras).
 */
export async function scheduleCase(
  db: Db,
  params: {
    workspaceId: string;
    contactId: string;
    caseTypeId: string;
    scheduledFor: string;
    actorId: string | null;
    fromCaseId?: string | null;
    ruleId?: string | null;
    origin?: "proactive" | "manual";
  },
): Promise<{ caseId: string; rescheduled: boolean } | null> {
  const { data: existing } = await db
    .from("cases")
    .select("id, scheduled_for")
    .eq("contact_id", params.contactId)
    .eq("case_type_id", params.caseTypeId)
    .eq("status", "scheduled")
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();

  const meta = { from_case_id: params.fromCaseId ?? null, rule_id: params.ruleId ?? null };

  if (existing) {
    const { error } = await db
      .from("cases")
      .update({ scheduled_for: params.scheduledFor })
      .eq("id", existing.id)
      .eq("status", "scheduled");
    if (error) {
      console.error("[cases] reschedule", error.message);
      return null;
    }
    await logActivity(db, {
      workspace_id: params.workspaceId,
      type: "case_scheduled",
      case_id: existing.id,
      contact_id: params.contactId,
      actor_id: params.actorId,
      from_value: existing.scheduled_for,
      to_value: params.scheduledFor,
      meta: { ...meta, rescheduled: true },
    });
    return { caseId: existing.id, rescheduled: true };
  }

  const stageId = await firstOpenStageId(db, params.caseTypeId);
  const { data: created, error } = await db
    .from("cases")
    .insert({
      workspace_id: params.workspaceId,
      contact_id: params.contactId,
      case_type_id: params.caseTypeId,
      stage_id: stageId,
      status: "scheduled",
      origin: params.origin ?? "proactive",
      scheduled_for: params.scheduledFor,
      created_by: params.actorId,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[cases] schedule", error?.message);
    return null;
  }
  await logActivity(db, {
    workspace_id: params.workspaceId,
    type: "case_scheduled",
    case_id: created.id,
    contact_id: params.contactId,
    actor_id: params.actorId,
    to_value: params.scheduledFor,
    meta,
  });
  return { caseId: created.id, rescheduled: false };
}

/** Aplica el plan de reglas: tipo de contacto, fecha clave y gestiones programadas. */
export async function applyRulePlan(
  db: Db,
  params: {
    plan: RulePlan;
    caseRow: CaseRow;
    contact: ContactRow;
    actorId: string | null;
    /** Fecha clave pedida al cerrar (ya validada), si una regla la pidió. */
    keyDate?: string | null;
  },
): Promise<RuleEffects> {
  const { plan, caseRow, contact, actorId } = params;
  const ws = caseRow.workspace_id;
  const effects: RuleEffects = { scheduled: [], skipped: [] };

  if (plan.askKeyDate && params.keyDate && params.keyDate !== contact.key_date) {
    const { error } = await db.from("contacts").update({ key_date: params.keyDate }).eq("id", contact.id);
    if (error) console.error("[cases] key_date", error.message);
    else effects.keyDate = { from: contact.key_date, to: params.keyDate };
  }

  if (plan.contactTypeId) {
    const { data: type } = await db
      .from("contact_types")
      .select("id")
      .eq("id", plan.contactTypeId)
      .eq("workspace_id", ws)
      .is("archived_at", null)
      .maybeSingle();
    if (!type) {
      effects.skipped.push({ ruleId: plan.matchedRuleIds[0] ?? "", reason: "invalid_contact_type" });
    } else {
      const { error } = await db.from("contacts").update({ contact_type_id: type.id }).eq("id", contact.id);
      if (error) {
        console.error("[cases] contact type", error.message);
      } else {
        effects.contactType = { from: contact.contact_type_id, to: type.id };
        await logActivity(db, {
          workspace_id: ws,
          type: "contact_type_changed",
          contact_id: contact.id,
          case_id: caseRow.id,
          actor_id: actorId,
          from_value: contact.contact_type_id,
          to_value: type.id,
          meta: { reason: "rule" },
        });
      }
    }
  }

  for (const s of plan.schedules) {
    if (!s.scheduledFor) {
      effects.skipped.push({ ruleId: s.ruleId, reason: "missing_key_date" });
      continue;
    }
    const { data: target } = await db
      .from("case_types")
      .select("id")
      .eq("id", s.caseTypeId)
      .eq("workspace_id", ws)
      .is("archived_at", null)
      .maybeSingle();
    if (!target) {
      effects.skipped.push({ ruleId: s.ruleId, reason: "invalid_case_type" });
      continue;
    }
    const result = await scheduleCase(db, {
      workspaceId: ws,
      contactId: contact.id,
      caseTypeId: target.id,
      scheduledFor: s.scheduledFor,
      actorId,
      fromCaseId: caseRow.id,
      ruleId: s.ruleId,
    });
    if (result) effects.scheduled.push({ ...result, caseTypeId: target.id, scheduledFor: s.scheduledFor });
    else effects.skipped.push({ ruleId: s.ruleId, reason: "error" });
  }

  return effects;
}

/**
 * Reglas de apertura o de cambio de etapa (no piden la fecha clave: eso solo
 * se puede al cerrar, con la interfaz).
 */
export async function runEventRules(
  db: Db,
  params: { caseRow: CaseRow; ctx: Omit<RuleEventContext, "contactTypeId">; actorId: string | null; now?: Date },
): Promise<RuleEffects | null> {
  const rules = (await loadRules(db, params.caseRow.case_type_id)).filter((r) => r.action !== "ask_key_date");
  if (rules.length === 0) return null;
  const { data: contact } = await db
    .from("contacts")
    .select("*")
    .eq("id", params.caseRow.contact_id)
    .eq("workspace_id", params.caseRow.workspace_id)
    .maybeSingle();
  if (!contact) return null;
  const wins = await countWins(db, contact.id, params.caseRow.id);
  const plan = planRules({
    rules,
    ctx: { ...params.ctx, contactTypeId: contact.contact_type_id },
    wonCount: wins + (params.caseRow.status === "won" ? 1 : 0),
    now: params.now ?? new Date(),
    keyDate: contact.key_date,
  });
  if (plan.matchedRuleIds.length === 0) return null;
  return applyRulePlan(db, { plan, caseRow: params.caseRow, contact, actorId: params.actorId });
}

/**
 * Reanuda el bot en los chats del contacto si ya no le queda ninguna gestión
 * abierta (el humano lo había pausado al responder).
 */
export async function resumeAutomationIfIdle(db: Db, workspaceId: string, contactId: string): Promise<void> {
  const { count } = await db
    .from("cases")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .eq("status", "open");
  if ((count ?? 0) > 0) return;
  const { error } = await db
    .from("conversations")
    .update({ is_automation_paused: false })
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("is_automation_paused", true);
  if (error) console.error("[cases] resume automation", error.message);
}
