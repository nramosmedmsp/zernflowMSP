// Tareas programadas de gestiones (docs/FASE-1-TECNICO.md 3.5 y
// FASE-2-TECNICO.md 3). Las llama /api/cron/jobs cada minuto. Todo es por
// lotes, con fecha límite y con actualizaciones condicionales: dos ejecuciones
// solapadas no duplican nada.

import type { CaseRouting } from "@/lib/types/database";
import { assignCase, loadAssignmentContext, type AssignmentContextCache } from "./assign";
import { sendAutoTemplate } from "./auto-template";
import { planActivation } from "./decisions";
import { businessMinutesBetween } from "@/lib/business-hours";
import { isOpenAt, nextOpeningFor, scheduleForTeam } from "./hours";
import {
  caseLink,
  contactName,
  logActivity,
  notify,
  supervisorsOrAdmins,
  workspaceAdminIds,
  type Db,
  type NotificationInput,
} from "./io";
import type { CaseMessenger } from "./messaging";
import { detectClientNoReply } from "./no-reply";
import { reassignWaitingCases } from "./reassign";
import { resolveTargetTeamId } from "./routing";
import { resumeIdlePausedBots } from "./bot-resume";
import { alertUnhandledComplaints } from "./complaint";
import { solutionDueAt } from "./protection";

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
  /** Fase 3: avisos de objetivo de tiempo superado (primera respuesta y resolución). */
  slaAlerts: number;
  /** Control de reclamos: plazo de solución vencido, compromisos vencidos y reclamos sin atender. */
  solutionAlerts: number;
  commitmentAlerts: number;
  complaintAlerts: number;
  /** Bots reanudados por llevar 24 h sin mensaje humano y sin gestión abierta. */
  botsResumed: number;
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
      const open = isOpenAt(ctx.hours, teamId, now);
      const plan = planActivation({
        isOpen: open,
        nextOpening: open ? null : nextOpeningFor(ctx.hours, teamId, now),
        now,
        scheduledFor: row.scheduled_for,
      });
      if (plan.action === "defer" && row.scheduled_for) {
        const { data: moved } = await db
          .from("cases")
          .update({ scheduled_for: plan.to.toISOString() })
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
            to_value: plan.to.toISOString(),
            meta: { rescheduled: true, reason: "off_hours" },
          });
        }
        continue;
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
      // Con una solución en proceso avisa "Compromiso vencido" (otra tarea): un solo aviso.
      .is("solution_status", null)
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
      .is("solution_status", null)
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


const SLA_MAX_SCAN = 1000;

type SlaKind = "first_response" | "resolution";

/**
 * Alertas por objetivo de tiempo (docs/FASE-3-TECNICO.md 2). Una sola vez por
 * gestión y tipo: sella cases.sla_*_breached_at, registra `sla_breached` y
 * avisa al responsable y a los supervisores del equipo (sin equipo o sin
 * supervisores, al dueño y administradores).
 *
 * - Primera respuesta: abierta, sin first_response_at, con espera del cliente
 *   y más minutos hábiles que sla_first_response_minutes desde waiting_since.
 * - Resolución: abierta, con más horas hábiles que sla_resolution_hours desde
 *   opened_at.
 * Los minutos hábiles nunca superan a los de reloj: la base filtra por reloj y
 * el horario efectivo de la gestión decide.
 */
export async function notifySlaBreaches(
  db: Db,
  opts: { deadline: number; now?: Date; cache?: AssignmentContextCache },
): Promise<{ alerted: number; stoppedEarly: boolean }> {
  const cache: AssignmentContextCache = opts.cache ?? new Map();
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  let alerted = 0;
  let scanned = 0;

  const { data: types, error } = await db
    .from("case_types")
    .select("id, name, workspace_id, sla_first_response_minutes, sla_resolution_hours");
  if (error) {
    console.error("[cases cron] sla types", error.message);
    return { alerted, stoppedEarly: false };
  }

  const jobs: { kind: SlaKind; type: NonNullable<typeof types>[number]; limitMinutes: number }[] = [];
  for (const t of types ?? []) {
    if (t.sla_first_response_minutes && t.sla_first_response_minutes > 0) {
      jobs.push({ kind: "first_response", type: t, limitMinutes: t.sla_first_response_minutes });
    }
    if (t.sla_resolution_hours && t.sla_resolution_hours > 0) {
      jobs.push({ kind: "resolution", type: t, limitMinutes: t.sla_resolution_hours * 60 });
    }
  }

  for (const job of jobs) {
    const cutoff = new Date(now.getTime() - job.limitMinutes * 60_000).toISOString();
    const stampColumn = job.kind === "first_response" ? "sla_first_response_breached_at" : "sla_resolution_breached_at";
    const sinceColumn = job.kind === "first_response" ? "waiting_since" : "opened_at";
    let lastId: string | null = null;

    while (scanned < SLA_MAX_SCAN) {
      if (!timeLeft(opts.deadline)) return { alerted, stoppedEarly: true };
      let query = db
        .from("cases")
        .select("id, workspace_id, contact_id, team_id, assignee_id, waiting_since, opened_at")
        .eq("status", "open")
        .eq("case_type_id", job.type.id)
        .is(stampColumn, null)
        .not(sinceColumn, "is", null)
        .lte(sinceColumn, cutoff)
        .order("id", { ascending: true })
        .limit(BATCH);
      if (job.kind === "first_response") query = query.is("first_response_at", null);
      if (lastId) query = query.gt("id", lastId);
      const { data: rows, error: rowsError } = await query;
      if (rowsError) {
        console.error("[cases cron] sla cases", rowsError.message);
        break;
      }
      if (!rows || rows.length === 0) break;
      lastId = rows[rows.length - 1].id;

      for (const row of rows) {
        if (!timeLeft(opts.deadline)) return { alerted, stoppedEarly: true };
        scanned++;
        const since = job.kind === "first_response" ? row.waiting_since : row.opened_at;
        if (!since) continue;
        const ctx = await loadAssignmentContext(db, row.workspace_id, cache);
        const schedule = scheduleForTeam(ctx.hours, row.team_id);
        const minutes = businessMinutesBetween(since, now, schedule.hours, schedule.holidays);
        if (minutes <= job.limitMinutes) continue;

        // Reclamo condicional: solo avisa quien selló la fila.
        const { data: claimed } = await db
          .from("cases")
          .update({ [stampColumn]: nowIso })
          .eq("id", row.id)
          .eq("status", "open")
          .is(stampColumn, null)
          .select("id");
        if (!claimed || claimed.length === 0) continue;
        alerted++;

        await logActivity(db, {
          workspace_id: row.workspace_id,
          type: "sla_breached",
          case_id: row.id,
          contact_id: row.contact_id,
          meta: { kind: job.kind },
        });

        const contacts = await names(db, [row.contact_id]);
        const recipients = new Set<string>(await supervisorsOrAdmins(db, row.workspace_id, row.team_id));
        if (row.assignee_id) recipients.add(row.assignee_id);
        const objective = job.kind === "first_response" ? "primera respuesta" : "resolución";
        await notify(
          db,
          [...recipients].map((userId) => ({
            workspace_id: row.workspace_id,
            user_id: userId,
            type: "sla_breached" as const,
            title: "Gestión fuera de tiempo",
            body: `${contacts.get(row.contact_id) ?? "Contacto sin nombre"} · ${job.type.name}: se superó el objetivo de ${objective}.`,
            link: caseLink(row.contact_id, row.id),
          })),
        );
      }
      if (rows.length < BATCH) break;
    }
  }
  return { alerted, stoppedEarly: false };
}

const SOLUTION_MAX_SCAN = 1000;

/**
 * Control de reclamos, plazo de la solución: las gestiones abiertas de un tipo
 * con `solution_deadline_hours` que pasaron el plazo sin cerrarse ni registrar
 * una solución en proceso avisan una sola vez a los supervisores
 * (`deadline_alerted_at`).
 */
export async function notifySolutionDeadlines(
  db: Db,
  opts: { deadline: number; now?: Date },
): Promise<{ alerted: number; stoppedEarly: boolean }> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  let alerted = 0;
  let scanned = 0;

  const { data: types, error } = await db
    .from("case_types")
    .select("id, name, solution_deadline_hours")
    .not("solution_deadline_hours", "is", null);
  if (error) {
    console.error("[cases cron] solution types", error.message);
    return { alerted, stoppedEarly: false };
  }

  for (const type of types ?? []) {
    const hours = type.solution_deadline_hours;
    if (!hours || hours <= 0) continue;
    const cutoff = new Date(now.getTime() - hours * 3_600_000).toISOString();
    let lastId: string | null = null;

    while (scanned < SOLUTION_MAX_SCAN) {
      if (!timeLeft(opts.deadline)) return { alerted, stoppedEarly: true };
      let query = db
        .from("cases")
        .select("id, workspace_id, contact_id, team_id, opened_at, solution_clock_at")
        .eq("status", "open")
        .eq("case_type_id", type.id)
        .is("solution_status", null)
        .is("deadline_alerted_at", null)
        .not("opened_at", "is", null)
        .lte("opened_at", cutoff)
        .order("id", { ascending: true })
        .limit(BATCH);
      if (lastId) query = query.gt("id", lastId);
      const { data: rows, error: rowsError } = await query;
      if (rowsError) {
        console.error("[cases cron] solution cases", rowsError.message);
        break;
      }
      if (!rows || rows.length === 0) break;
      lastId = rows[rows.length - 1].id;

      for (const row of rows) {
        scanned++;
        // La reapertura reinicia el reloj: la base filtra por opened_at, aquí se afina.
        const due = solutionDueAt({ openedAt: row.opened_at, solutionClockAt: row.solution_clock_at }, hours);
        if (!due || due.getTime() > now.getTime()) continue;

        // Reclamo condicional: solo avisa quien selló la fila.
        const { data: claimed } = await db
          .from("cases")
          .update({ deadline_alerted_at: nowIso })
          .eq("id", row.id)
          .eq("status", "open")
          .is("solution_status", null)
          .is("deadline_alerted_at", null)
          .select("id");
        if (!claimed || claimed.length === 0) continue;
        alerted++;

        await logActivity(db, {
          workspace_id: row.workspace_id,
          type: "solution_overdue",
          case_id: row.id,
          contact_id: row.contact_id,
          meta: { kind: "deadline", hours },
        });
        const contacts = await names(db, [row.contact_id]);
        const recipients = await supervisorsOrAdmins(db, row.workspace_id, row.team_id);
        await notify(
          db,
          recipients.map((userId) => ({
            workspace_id: row.workspace_id,
            user_id: userId,
            type: "solution_overdue" as const,
            title: `${type.name} sin solución registrada: ${contacts.get(row.contact_id) ?? "Contacto sin nombre"}`,
            body: `Pasaron más de ${hours} h y nadie registró la solución ni la cerró.`,
            link: caseLink(row.contact_id, row.id),
          })),
        );
      }
      if (rows.length < BATCH) break;
    }
  }
  return { alerted, stoppedEarly: false };
}

/**
 * Control de reclamos, fecha compromiso: una solución en proceso cuya fecha
 * compromiso (next_action_at) ya pasó y la gestión sigue abierta avisa una
 * sola vez por compromiso al responsable y a los supervisores
 * (`commitment_alerted_at`; cambiar la fecha lo vuelve a null).
 */
export async function notifyCommitmentsOverdue(
  db: Db,
  opts: { deadline: number; now?: Date },
): Promise<{ alerted: number; stoppedEarly: boolean }> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  let alerted = 0;

  while (timeLeft(opts.deadline)) {
    const { data: due, error } = await db
      .from("cases")
      .select("id")
      .eq("status", "open")
      .eq("solution_status", "in_progress")
      .is("commitment_alerted_at", null)
      .not("next_action_at", "is", null)
      .lte("next_action_at", nowIso)
      .order("next_action_at", { ascending: true })
      .limit(BATCH);
    if (error) {
      console.error("[cases cron] commitments", error.message);
      break;
    }
    if (!due || due.length === 0) return { alerted, stoppedEarly: false };

    const { data: claimed, error: claimError } = await db
      .from("cases")
      .update({ commitment_alerted_at: nowIso })
      .in("id", due.map((r) => r.id))
      .is("commitment_alerted_at", null)
      .select("id, workspace_id, contact_id, team_id, assignee_id, case_type_id, solution_note");
    if (claimError) {
      console.error("[cases cron] claim commitments", claimError.message);
      break;
    }
    const rows = claimed ?? [];
    const contacts = await names(db, rows.map((r) => r.contact_id));

    const notifications: NotificationInput[] = [];
    for (const row of rows) {
      await logActivity(db, {
        workspace_id: row.workspace_id,
        type: "solution_overdue",
        case_id: row.id,
        contact_id: row.contact_id,
        meta: { kind: "commitment" },
      });
      const recipients = new Set(await supervisorsOrAdmins(db, row.workspace_id, row.team_id));
      if (row.assignee_id) recipients.add(row.assignee_id);
      for (const userId of recipients) {
        notifications.push({
          workspace_id: row.workspace_id,
          user_id: userId,
          type: "commitment_overdue",
          title: `Compromiso vencido: ${contacts.get(row.contact_id) ?? "Contacto sin nombre"}`,
          body: row.solution_note ? `La solución en proceso: ${row.solution_note}` : "La fecha compromiso de la solución ya pasó.",
          link: caseLink(row.contact_id, row.id),
        });
      }
      alerted++;
    }
    await notify(db, notifications);
    if (due.length < BATCH) break;
  }
  return { alerted, stoppedEarly: !timeLeft(opts.deadline) };
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
    slaAlerts: 0,
    solutionAlerts: 0,
    commitmentAlerts: 0,
    complaintAlerts: 0,
    botsResumed: 0,
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
    [
      "sla",
      async () => {
        const r = await notifySlaBreaches(db, { deadline: opts.deadline, cache, now: opts.now });
        stats.slaAlerts = r.alerted;
        stats.stoppedEarly ||= r.stoppedEarly;
      },
    ],
    [
      "solution_deadline",
      async () => {
        const r = await notifySolutionDeadlines(db, { deadline: opts.deadline, now: opts.now });
        stats.solutionAlerts = r.alerted;
        stats.stoppedEarly ||= r.stoppedEarly;
      },
    ],
    [
      "commitments",
      async () => {
        const r = await notifyCommitmentsOverdue(db, { deadline: opts.deadline, now: opts.now });
        stats.commitmentAlerts = r.alerted;
        stats.stoppedEarly ||= r.stoppedEarly;
      },
    ],
    [
      "complaints",
      async () => {
        const r = await alertUnhandledComplaints(db, { deadline: opts.deadline, now: opts.now });
        stats.complaintAlerts = r.alerted;
        stats.stoppedEarly ||= r.stoppedEarly;
      },
    ],
    [
      "bot_resume",
      async () => {
        const r = await resumeIdlePausedBots(db, { deadline: opts.deadline, now: opts.now });
        stats.botsResumed = r.resumed;
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
