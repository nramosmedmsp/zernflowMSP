// Tareas programadas de gestiones (docs/FASE-1-TECNICO.md 3.5 y
// FASE-2-TECNICO.md 3). Las llama /api/cron/jobs cada minuto. Todo es por
// lotes, con fecha límite y con actualizaciones condicionales: dos ejecuciones
// solapadas no duplican nada.

import type { CaseRouting } from "@/lib/types/database";
import { assignCase, loadAssignmentContext, type AssignmentContextCache } from "./assign";
import { sendAutoTemplate } from "./auto-template";
import { isOpenAt, nextOpeningFor } from "./hours";
import {
  caseLink,
  contactName,
  logActivity,
  notify,
  workspaceAdminIds,
  type Db,
  type NotificationInput,
} from "./io";
import type { CaseMessenger } from "./messaging";
import { detectClientNoReply } from "./no-reply";
import { reassignWaitingCases } from "./reassign";
import { resolveTargetTeamId } from "./routing";

const BATCH = 50;

export interface CaseTaskStats {
  activated: number;
  /** Programadas que se movieron a la próxima apertura (fuera de horario). */
  deferred: number;
  autoTemplates: { sent: number; failed: number };
  retried: number;
  assigned: number;
  reassigned: number;
  waitAlerts: number;
  overdueNotified: number;
  noReplyEvents: number;
  stoppedEarly: boolean;
}

function timeLeft(deadline: number): boolean {
  return Date.now() < deadline;
}

async function names(db: Db, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await db.from("contacts").select("id, display_name").in("id", unique);
  return new Map((data ?? []).map((c) => [c.id, contactName(c)]));
}

interface DueType {
  id: string;
  name: string;
  routing: CaseRouting;
  fixed_team_id: string | null;
  auto_template: unknown;
}

/**
 * Programadas con fecha cumplida → abiertas, reparto, plantilla automática
 * (si el tipo la tiene) y aviso "Recompra para hoy: …". Fase 2: si el equipo
 * de destino está fuera de horario, la gestión no se activa: su
 * scheduled_for pasa a la próxima apertura (las proactivas esperan igual que
 * el reparto y la plantilla no sale de madrugada).
 */
export async function activateScheduledCases(
  db: Db,
  opts: { deadline: number; now?: Date; cache?: AssignmentContextCache; messenger?: CaseMessenger },
): Promise<{ activated: number; deferred: number; autoTemplates: { sent: number; failed: number }; stoppedEarly: boolean }> {
  const cache: AssignmentContextCache = opts.cache ?? new Map();
  let activated = 0;
  let deferred = 0;
  const autoTemplates = { sent: 0, failed: 0 };
  const result = (stoppedEarly: boolean) => ({ activated, deferred, autoTemplates, stoppedEarly });

  while (timeLeft(opts.deadline)) {
    const now = opts.now ?? new Date();
    const nowIso = now.toISOString();
    const { data: due, error } = await db
      .from("cases")
      .select("id, workspace_id, contact_id, case_type_id, assignee_id, team_id, scheduled_for")
      .eq("status", "scheduled")
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(BATCH);
    if (error) {
      console.error("[cases cron] scheduled", error.message);
      break;
    }
    if (!due || due.length === 0) return result(false);

    const contactIds = [...new Set(due.map((c) => c.contact_id))];
    const typeIds = [...new Set(due.map((c) => c.case_type_id).filter((v): v is string => !!v))];
    const [{ data: contacts }, { data: types }] = await Promise.all([
      db.from("contacts").select("id, display_name, owner_id, team_id").in("id", contactIds),
      typeIds.length
        ? db.from("case_types").select("id, name, routing, fixed_team_id, auto_template").in("id", typeIds)
        : Promise.resolve({ data: [] as DueType[] }),
    ]);
    const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));
    const typeById = new Map<string, DueType>((types ?? []).map((t) => [t.id, t]));

    for (const row of due) {
      if (!timeLeft(opts.deadline)) return result(true);
      const contact = contactById.get(row.contact_id);
      const type = row.case_type_id ? typeById.get(row.case_type_id) : undefined;

      // ¿El equipo de destino atiende ahora?
      const ctx = await loadAssignmentContext(db, row.workspace_id, cache);
      const teamId = resolveTargetTeamId({
        caseTypeId: type?.id ?? null,
        routing: type?.routing ?? "contact_owner",
        fixedTeamId: type?.fixed_team_id ?? null,
        currentTeamId: row.team_id,
        contactOwnerId: contact?.owner_id ?? null,
        contactTeamId: contact?.team_id ?? null,
        teams: ctx.teams,
        teamMembers: ctx.teamMembers,
        members: ctx.members,
        workspaceMode: ctx.workspaceMode,
      });
      if (!isOpenAt(ctx.hours, teamId, now)) {
        const opening = nextOpeningFor(ctx.hours, teamId, now);
        if (opening && opening.getTime() > now.getTime() && row.scheduled_for) {
          const { data: moved } = await db
            .from("cases")
            .update({ scheduled_for: opening.toISOString() })
            .eq("id", row.id)
            .eq("status", "scheduled")
            .eq("scheduled_for", row.scheduled_for)
            .select("id");
          if (moved && moved.length > 0) {
            deferred++;
            await logActivity(db, {
              workspace_id: row.workspace_id,
              type: "case_scheduled",
              case_id: row.id,
              contact_id: row.contact_id,
              from_value: row.scheduled_for,
              to_value: opening.toISOString(),
              meta: { rescheduled: true, reason: "off_hours" },
            });
          }
          continue;
        }
      }

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

      const typeName = type?.name || "Gestión";
      const name = contact ? contactName(contact) : "Contacto sin nombre";
      const title = `${typeName} para hoy: ${name}`;
      const link = caseLink(row.contact_id, row.id);

      let assigneeId = row.assignee_id;
      if (!assigneeId) {
        const outcome = await assignCase(db, row.id, { notifyAssignee: false, cache, at: now });
        if (outcome.status === "assigned" || outcome.status === "already_assigned") {
          assigneeId = outcome.assigneeId;
        }
      }

      if (type?.auto_template) {
        try {
          const sent = await sendAutoTemplate(db, { caseId: row.id, at: nowIso, messenger: opts.messenger, cache });
          if (sent.status === "sent") autoTemplates.sent++;
          else if (sent.status === "failed") autoTemplates.failed++;
        } catch (err) {
          autoTemplates.failed++;
          console.error("[cases cron] auto template", err);
        }
      }

      if (assigneeId) {
        await notify(db, [{ workspace_id: row.workspace_id, user_id: assigneeId, type: "case_activated", title, link }]);
      }
    }
    if (due.length < BATCH) break;
  }
  return result(!timeLeft(opts.deadline));
}

/**
 * Reintenta el reparto de las abiertas sin responsable (alguien volvió a
 * estar disponible, cambió el equipo, abrió el horario...). No vuelve a avisar
 * "sin asignar". Recorre por id para no quedarse siempre con las mismas. Fase
 * 2: salta las de equipos fuera de horario (se reparten al abrir).
 */
export async function retryUnassignedCases(
  db: Db,
  opts: { deadline: number; cache?: AssignmentContextCache; maxCases?: number; workspaceId?: string; now?: Date },
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
      .select("id, workspace_id, team_id")
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
      // Atajo: con el equipo (o la empresa sin equipos) cerrado no se reparte.
      const now = opts.now ?? new Date();
      if ((row.team_id || ctx.teams.length === 0) && !isOpenAt(ctx.hours, row.team_id, now)) continue;

      retried++;
      const outcome = await assignCase(db, row.id, { notifyIfUnassigned: false, cache, at: now });
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
    const contacts = await names(db, rows.map((r) => r.contact_id));

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


/** Todas las tareas en orden, compartiendo la memoria de reparto y la fecha límite. */
export async function runCaseTasks(
  db: Db,
  opts: { deadline: number; messenger?: CaseMessenger; now?: Date },
): Promise<CaseTaskStats> {
  const cache: AssignmentContextCache = new Map();
  const stats: CaseTaskStats = {
    activated: 0,
    deferred: 0,
    autoTemplates: { sent: 0, failed: 0 },
    retried: 0,
    assigned: 0,
    reassigned: 0,
    waitAlerts: 0,
    overdueNotified: 0,
    noReplyEvents: 0,
    stoppedEarly: false,
  };

  const tasks: [string, () => Promise<void>][] = [
    [
      "activate",
      async () => {
        const r = await activateScheduledCases(db, {
          deadline: opts.deadline,
          cache,
          messenger: opts.messenger,
          now: opts.now,
        });
        stats.activated = r.activated;
        stats.deferred = r.deferred;
        stats.autoTemplates = r.autoTemplates;
        stats.stoppedEarly ||= r.stoppedEarly;
      },
    ],
    [
      "overdue",
      async () => {
        const r = await notifyOverdueNextActions(db, { deadline: opts.deadline, now: opts.now });
        stats.overdueNotified = r.notified;
        stats.stoppedEarly ||= r.stoppedEarly;
      },
    ],
    [
      "reassign",
      async () => {
        const r = await reassignWaitingCases(db, { deadline: opts.deadline, cache, now: opts.now });
        stats.reassigned = r.reassigned;
        stats.waitAlerts = r.alerted;
        stats.stoppedEarly ||= r.stoppedEarly;
      },
    ],
    [
      "retry",
      async () => {
        const r = await retryUnassignedCases(db, { deadline: opts.deadline, cache, now: opts.now });
        stats.retried = r.retried;
        stats.assigned = r.assigned;
        stats.stoppedEarly ||= r.stoppedEarly;
      },
    ],
    [
      "no_reply",
      async () => {
        const r = await detectClientNoReply(db, { deadline: opts.deadline, now: opts.now });
        stats.noReplyEvents = r.emitted;
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
