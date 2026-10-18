// Gestiones programadas según la fecha clave (docs/FASE-2-TECNICO.md 3.7).
// La usa la importación de contactos: aplica las reglas schedule_case con
// days_before_key_date de todos los tipos activos del espacio (sin importar
// su disparador ni su condición) y crea o mueve la gestión programada.

import { addDays, isDateString, limaDateOf, scheduleInstant } from "./dates";
import { scheduleCase } from "./effects";
import { loadContact, type Db } from "./io";
import { parseRule } from "./rules";

export interface KeyDateScheduleResult {
  scheduled: { caseId: string; caseTypeId: string; scheduledFor: string; rescheduled: boolean }[];
  skipped: { caseTypeId: string | null; reason: "no_key_date" | "key_date_passed" | "open_case_exists" | "error" }[];
}

/**
 * - Sin fecha clave, o con la fecha clave ya pasada (p. ej. membresía vencida
 *   hace meses), no programa nada.
 * - Si la fecha calculada ya pasó pero la clave no (dentro de la ventana de
 *   aviso), se activa en la siguiente vuelta del cron.
 * - Varias reglas del mismo tipo: gana la que avisa con más anticipación.
 * - Si el contacto ya tiene una gestión abierta de ese tipo, no se duplica.
 */
export async function scheduleCasesForKeyDate(
  service: Db,
  workspaceId: string,
  contactId: string,
  opts: { actorId?: string | null; now?: Date } = {},
): Promise<KeyDateScheduleResult> {
  const result: KeyDateScheduleResult = { scheduled: [], skipped: [] };
  const now = opts.now ?? new Date();
  const contact = await loadContact(service, workspaceId, contactId);
  if (!contact || !isDateString(contact.key_date)) {
    result.skipped.push({ caseTypeId: null, reason: "no_key_date" });
    return result;
  }
  const keyDate = contact.key_date;
  if (keyDate < limaDateOf(now)) {
    result.skipped.push({ caseTypeId: null, reason: "key_date_passed" });
    return result;
  }

  const { data: types } = await service
    .from("case_types")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  const typeIds = (types ?? []).map((t) => t.id);
  if (typeIds.length === 0) return result;

  const { data: rows } = await service
    .from("case_rules")
    .select("id, position, enabled, trigger, trigger_stage_id, condition, action, params")
    .in("case_type_id", typeIds)
    .eq("enabled", true)
    .eq("action", "schedule_case");

  // Tipo destino → días de anticipación (el mayor).
  const daysByType = new Map<string, number>();
  const active = new Set(typeIds);
  for (const raw of rows ?? []) {
    const rule = parseRule(raw);
    if (!rule || rule.action !== "schedule_case") continue;
    const days = rule.params.days_before_key_date;
    if (days === undefined || !active.has(rule.params.case_type_id)) continue;
    daysByType.set(rule.params.case_type_id, Math.max(days, daysByType.get(rule.params.case_type_id) ?? 0));
  }

  for (const [caseTypeId, days] of daysByType) {
    const { count } = await service
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contactId)
      .eq("case_type_id", caseTypeId)
      .eq("status", "open");
    if ((count ?? 0) > 0) {
      result.skipped.push({ caseTypeId, reason: "open_case_exists" });
      continue;
    }
    const scheduledFor = scheduleInstant(addDays(keyDate, -days), now);
    const created = await scheduleCase(service, {
      workspaceId,
      contactId,
      caseTypeId,
      scheduledFor,
      actorId: opts.actorId ?? null,
    });
    if (created) result.scheduled.push({ ...created, caseTypeId, scheduledFor });
    else result.skipped.push({ caseTypeId, reason: "error" });
  }
  return result;
}
