// Tareas programadas de gestiones (docs/FASE-1-TECNICO.md 3.5). Las llama
// /api/cron/jobs cada minuto. Todo es por lotes, con fecha límite y con
// actualizaciones condicionales: dos ejecuciones solapadas no duplican nada.

import { assignCase, loadAssignmentContext, type AssignmentContextCache } from "./assign";
import {
  caseLink,
  contactName,
  logActivity,
  notify,
  workspaceAdminIds,
  type Db,
  type NotificationInput,
} from "./io";

const BATCH = 50;

export interface CaseTaskStats {
  activated: number;
  retried: number;
  assigned: number;
  overdueNotified: number;
  stoppedEarly: boolean;
}

function timeLeft(deadline: number): boolean {
  return Date.now() < deadline;
}

async function names(db: Db, table: "contacts" | "case_types", ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  if (table === "contacts") {
    const { data } = await db.from("contacts").select("id, display_name").in("id", unique);
    return new Map((data ?? []).map((c) => [c.id, contactName(c)]));
  }
  const { data } = await db.from("case_types").select("id, name").in("id", unique);
  return new Map((data ?? []).map((t) => [t.id, t.name]));
}

/** Programadas con fecha cumplida → abiertas, reparto y aviso "Recompra para hoy: …". */
export async function activateScheduledCases(
  db: Db,
  opts: { deadline: number; now?: Date; cache?: AssignmentContextCache },
): Promise<{ activated: number; stoppedEarly: boolean }> {
  let activated = 0;
  while (timeLeft(opts.deadline)) {
    const nowIso = (opts.now ?? new Date()).toISOString();
    const { data: due, error } = await db
      .from("cases")
      .select("id, workspace_id, contact_id, case_type_id, assignee_id")
      .eq("status", "scheduled")
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(BATCH);
    if (error) {
      console.error("[cases cron] scheduled", error.message);
      break;
    }
    if (!due || due.length === 0) return { activated, stoppedEarly: false };

    const [contacts, types] = await Promise.all([
      names(db, "contacts", due.map((c) => c.contact_id)),
      names(db, "case_types", due.map((c) => c.case_type_id ?? "")),
    ]);

    for (const row of due) {
      if (!timeLeft(opts.deadline)) return { activated, stoppedEarly: true };
      const { data: claimed } = await db
        .from("cases")
        .update({ status: "open", opened_at: nowIso })
        .eq("id", row.id)
        .eq("status", "scheduled")
        .select("id");
      if (!claimed || claimed.length === 0) continue; // otra ejecución la activó
      activated++;

      await logActivity(db, {
        workspace_id: row.workspace_id,
        type: "case_activated",
        case_id: row.id,
        contact_id: row.contact_id,
        from_value: "scheduled",
        to_value: "open",
      });

      const typeName = (row.case_type_id && types.get(row.case_type_id)) || "Gestión";
      const name = contacts.get(row.contact_id) ?? "Contacto sin nombre";
      const title = `${typeName} para hoy: ${name}`;
      const link = caseLink(row.contact_id, row.id);

      let assigneeId = row.assignee_id;
      if (!assigneeId) {
        const outcome = await assignCase(db, row.id, { notifyAssignee: false, cache: opts.cache });
        if (outcome.status === "assigned" || outcome.status === "already_assigned") {
          assigneeId = outcome.assigneeId;
        }
      }
      if (assigneeId) {
        await notify(db, [{ workspace_id: row.workspace_id, user_id: assigneeId, type: "case_activated", title, link }]);
      }
    }
    if (due.length < BATCH) break;
  }
  return { activated, stoppedEarly: !timeLeft(opts.deadline) };
}

/**
 * Reintenta el reparto de las abiertas sin responsable (alguien volvió a
 * estar disponible, cambió el equipo...). No vuelve a avisar "sin asignar".
 * Recorre por id para no quedarse siempre con las mismas.
 */
export async function retryUnassignedCases(
  db: Db,
  opts: { deadline: number; cache?: AssignmentContextCache; maxCases?: number; workspaceId?: string },
): Promise<{ retried: number; assigned: number; stoppedEarly: boolean }> {
  const cache: AssignmentContextCache = opts.cache ?? new Map();
  const maxCases = opts.maxCases ?? 200;
  let retried = 0;
  let assigned = 0;
  let lastId: string | null = null;
  const workspacesWithoutAvailable = new Set<string>();

  while (timeLeft(opts.deadline) && retried < maxCases) {
    let query = db
      .from("cases")
      .select("id, workspace_id")
      .eq("status", "open")
      .is("assignee_id", null)
      .order("id", { ascending: true })
      .limit(BATCH);
    if (lastId) query = query.gt("id", lastId);
    if (opts.workspaceId) query = query.eq("workspace_id", opts.workspaceId);
    const { data: rows, error } = await query;
    if (error) {
      console.error("[cases cron] unassigned", error.message);
      break;
    }
    if (!rows || rows.length === 0) return { retried, assigned, stoppedEarly: false };
    lastId = rows[rows.length - 1].id;

    for (const row of rows) {
      if (!timeLeft(opts.deadline)) return { retried, assigned, stoppedEarly: true };
      if (workspacesWithoutAvailable.has(row.workspace_id)) continue;

      // Atajo: sin nadie disponible en el espacio no hay nada que intentar.
      const ctx = await loadAssignmentContext(db, row.workspace_id, cache);
      if (!ctx.members.some((m) => m.availability === "available")) {
        workspacesWithoutAvailable.add(row.workspace_id);
        continue;
      }

      retried++;
      const outcome = await assignCase(db, row.id, { notifyIfUnassigned: false, cache });
      if (outcome.status === "assigned") assigned++;
    }
    if (rows.length < BATCH) break;
  }
  return { retried, assigned, stoppedEarly: !timeLeft(opts.deadline) };
}

/**
 * Próximos contactos vencidos: avisa una sola vez por fecha (al responsable;
 * sin responsable, a los administradores). setNextAction vuelve a dejar
 * next_action_notified_at en null cuando cambia la fecha.
 */
export async function notifyOverdueNextActions(
  db: Db,
  opts: { deadline: number; now?: Date },
): Promise<{ notified: number; stoppedEarly: boolean }> {
  let notified = 0;
  const adminsByWorkspace = new Map<string, string[]>();

  while (timeLeft(opts.deadline)) {
    const nowIso = (opts.now ?? new Date()).toISOString();
    const { data: due, error } = await db
      .from("cases")
      .select("id")
      .eq("status", "open")
      .is("next_action_notified_at", null)
      .lte("next_action_at", nowIso)
      .order("next_action_at", { ascending: true })
      .limit(BATCH);
    if (error) {
      console.error("[cases cron] next actions", error.message);
      break;
    }
    if (!due || due.length === 0) return { notified, stoppedEarly: false };

    // Reclamo condicional: solo avisa las filas que esta ejecución marcó.
    const { data: claimed, error: claimError } = await db
      .from("cases")
      .update({ next_action_notified_at: nowIso })
      .in("id", due.map((r) => r.id))
      .is("next_action_notified_at", null)
      .select("id, workspace_id, contact_id, assignee_id, next_action_note");
    if (claimError) {
      console.error("[cases cron] claim next actions", claimError.message);
      break;
    }
    const rows = claimed ?? [];
    const contacts = await names(db, "contacts", rows.map((r) => r.contact_id));

    const notifications: NotificationInput[] = [];
    for (const row of rows) {
      let recipients: string[];
      if (row.assignee_id) {
        recipients = [row.assignee_id];
      } else {
        if (!adminsByWorkspace.has(row.workspace_id)) {
          adminsByWorkspace.set(row.workspace_id, await workspaceAdminIds(db, row.workspace_id));
        }
        recipients = adminsByWorkspace.get(row.workspace_id) ?? [];
      }
      for (const userId of recipients) {
        notifications.push({
          workspace_id: row.workspace_id,
          user_id: userId,
          type: "next_action_due",
          title: `Próximo contacto vencido: ${contacts.get(row.contact_id) ?? "Contacto sin nombre"}`,
          body: row.next_action_note,
          link: caseLink(row.contact_id, row.id),
        });
      }
    }
    await notify(db, notifications);
    notified += rows.length;
    if (due.length < BATCH) break;
  }
  return { notified, stoppedEarly: !timeLeft(opts.deadline) };
}

/** Las tres tareas en orden, compartiendo la memoria de reparto y la fecha límite. */
export async function runCaseTasks(db: Db, opts: { deadline: number }): Promise<CaseTaskStats> {
  const cache: AssignmentContextCache = new Map();
  const stats: CaseTaskStats = { activated: 0, retried: 0, assigned: 0, overdueNotified: 0, stoppedEarly: false };

  const tasks: [string, () => Promise<void>][] = [
    [
      "activate",
      async () => {
        const r = await activateScheduledCases(db, { deadline: opts.deadline, cache });
        stats.activated = r.activated;
        stats.stoppedEarly ||= r.stoppedEarly;
      },
    ],
    [
      "overdue",
      async () => {
        const r = await notifyOverdueNextActions(db, { deadline: opts.deadline });
        stats.overdueNotified = r.notified;
        stats.stoppedEarly ||= r.stoppedEarly;
      },
    ],
    [
      "retry",
      async () => {
        const r = await retryUnassignedCases(db, { deadline: opts.deadline, cache });
        stats.retried = r.retried;
        stats.assigned = r.assigned;
        stats.stoppedEarly ||= r.stoppedEarly;
      },
    ],
  ];

  for (const [name, task] of tasks) {
    if (!timeLeft(opts.deadline)) {
      stats.stoppedEarly = true;
      break;
    }
    try {
      await task();
    } catch (err) {
      console.error(`[cases cron] ${name}`, err);
    }
  }
  return stats;
}
