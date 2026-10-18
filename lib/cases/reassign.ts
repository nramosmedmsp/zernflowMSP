// Reasignación por espera (docs/FASE-2-TECNICO.md 3.3). La corre el cron.
//
// Si workspaces.settings.reassign_after_minutes está definido, una gestión
// abierta y asignada cuyo cliente espera (waiting_since) desde hace más de
// ese tiempo EN MINUTOS HÁBILES vuelve a la cola y se reparte a otra persona
// (excluyendo a la anterior): se registra `unassigned` + `assigned` con motivo
// "espera", sube reassigned_count y se avisa al supervisor y a la persona
// anterior. El reloj cuenta desde lo último entre waiting_since y
// assigned_at (así la persona nueva tiene su propio plazo).
//
// Si no hay otra persona elegible y disponible, no se la quita: se avisa una
// vez al supervisor (wait_alerted_at) hasta que cambie la espera o el
// responsable.

import { businessMinutesBetween, isWithinHours } from "@/lib/business-hours";
import { assignCase, loadAssignmentContext, type AssignmentContextCache } from "./assign";
import { scheduleForTeam } from "./hours";
import {
  caseLink,
  contactName,
  logActivity,
  notify,
  supervisorsOrAdmins,
  type Db,
  type NotificationInput,
} from "./io";
import { decideAssignment } from "./routing";

const BATCH = 50;
const MAX_SCAN = 1000;

export const WAIT_REASON = "espera";

function timeLeft(deadline: number): boolean {
  return Date.now() < deadline;
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

export interface ReassignStats {
  scanned: number;
  reassigned: number;
  alerted: number;
  stoppedEarly: boolean;
}

export async function reassignWaitingCases(
  db: Db,
  opts: { deadline: number; now?: Date; cache?: AssignmentContextCache },
): Promise<ReassignStats> {
  const cache: AssignmentContextCache = opts.cache ?? new Map();
  const stats: ReassignStats = { scanned: 0, reassigned: 0, alerted: 0, stoppedEarly: false };
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  const { data: workspaces, error } = await db.from("workspaces").select("id, settings");
  if (error) {
    console.error("[cases cron] reassign workspaces", error.message);
    return stats;
  }

  for (const ws of workspaces ?? []) {
    const ctx = await loadAssignmentContext(db, ws.id, cache);
    const limit = ctx.hours.reassignAfterMinutes;
    if (!limit) continue;
    // Los minutos hábiles nunca superan a los de reloj: primer filtro en la base.
    const cutoff = new Date(now.getTime() - limit * 60_000).toISOString();
    let lastId: string | null = null;

    while (stats.scanned < MAX_SCAN) {
      if (!timeLeft(opts.deadline)) {
        stats.stoppedEarly = true;
        return stats;
      }
      let query = db
        .from("cases")
        .select("id, workspace_id, contact_id, case_type_id, team_id, assignee_id, waiting_since, assigned_at, wait_alerted_at, reassigned_count")
        .eq("workspace_id", ws.id)
        .eq("status", "open")
        .not("assignee_id", "is", null)
        .lte("waiting_since", cutoff)
        .order("id", { ascending: true })
        .limit(BATCH);
      if (lastId) query = query.gt("id", lastId);
      const { data: rows, error: rowsError } = await query;
      if (rowsError) {
        console.error("[cases cron] reassign", rowsError.message);
        break;
      }
      if (!rows || rows.length === 0) break;
      lastId = rows[rows.length - 1].id;

      for (const row of rows) {
        if (!timeLeft(opts.deadline)) {
          stats.stoppedEarly = true;
          return stats;
        }
        stats.scanned++;
        const previous = row.assignee_id;
        const since = laterOf(row.waiting_since, row.assigned_at);
        if (!previous || !since) continue;
        const schedule = scheduleForTeam(ctx.hours, row.team_id);
        // Solo se reasigna con el equipo atendiendo (la persona nueva tiene que estar).
        if (!isWithinHours(now, schedule.hours, schedule.holidays)) continue;
        const minutes = businessMinutesBetween(since, now, schedule.hours, schedule.holidays);
        if (minutes < limit) continue;

        const [{ data: caseType }, { data: contact }] = await Promise.all([
          row.case_type_id
            ? db.from("case_types").select("id, name, routing, fixed_team_id").eq("id", row.case_type_id).maybeSingle()
            : Promise.resolve({ data: null }),
          db.from("contacts").select("id, display_name, owner_id, team_id").eq("id", row.contact_id).maybeSingle(),
        ]);
        if (!contact) continue;
        const name = contactName(contact);
        const typeName = caseType?.name ?? "Sin clasificar";
        const link = caseLink(row.contact_id, row.id);
        const waited = Math.floor(minutes);

        const decision = decideAssignment({
          caseTypeId: caseType?.id ?? null,
          routing: caseType?.routing ?? "contact_owner",
          fixedTeamId: caseType?.fixed_team_id ?? null,
          currentTeamId: row.team_id,
          contactOwnerId: contact.owner_id,
          contactTeamId: contact.team_id,
          teams: ctx.teams,
          teamMembers: ctx.teamMembers,
          members: ctx.members,
          workspaceMode: ctx.workspaceMode,
          excludeUserIds: [previous],
        });

        if (decision.kind !== "owner" && decision.kind !== "pick") {
          // Nadie más: se queda con la persona actual y se avisa una vez.
          if (row.wait_alerted_at && new Date(row.wait_alerted_at).getTime() >= new Date(since).getTime()) continue;
          let claim = db.from("cases").update({ wait_alerted_at: nowIso }).eq("id", row.id);
          claim = row.wait_alerted_at ? claim.eq("wait_alerted_at", row.wait_alerted_at) : claim.is("wait_alerted_at", null);
          const { data: claimed } = await claim.select("id");
          if (!claimed || claimed.length === 0) continue;
          const recipients = await supervisorsOrAdmins(db, row.workspace_id, row.team_id);
          await notify(
            db,
            recipients.map((userId) => ({
              workspace_id: row.workspace_id,
              user_id: userId,
              type: "wait_exceeded" as const,
              title: `Cliente esperando sin respuesta: ${name}`,
              body: `${typeName}. Espera ${waited} min hábiles y no hay otra persona disponible para reasignarla.`,
              link,
            })),
          );
          stats.alerted++;
          continue;
        }

        // Vuelve a la cola (condicional: nadie la tomó o respondió entretanto).
        const { data: released } = await db
          .from("cases")
          .update({ assignee_id: null, reassigned_count: (row.reassigned_count ?? 0) + 1 })
          .eq("id", row.id)
          .eq("status", "open")
          .eq("assignee_id", previous)
          .not("waiting_since", "is", null)
          .select("id");
        if (!released || released.length === 0) continue;
        await logActivity(db, {
          workspace_id: row.workspace_id,
          type: "unassigned",
          case_id: row.id,
          contact_id: row.contact_id,
          from_value: previous,
          to_value: null,
          meta: { reason: WAIT_REASON, minutes: waited },
        });

        const outcome = await assignCase(db, row.id, {
          exclude: [previous],
          reason: WAIT_REASON,
          notifyIfUnassigned: false,
          cache,
          at: now,
        });
        const assigned = outcome.status === "assigned" ? outcome.assigneeId : null;
        if (assigned) stats.reassigned++;

        const supervisors = await supervisorsOrAdmins(db, row.workspace_id, row.team_id);
        const notifications: NotificationInput[] = [
          {
            workspace_id: row.workspace_id,
            user_id: previous,
            type: "case_reassigned",
            title: `Se reasignó por espera: ${name}`,
            body: `${typeName}. El cliente esperó ${waited} min hábiles sin respuesta.`,
            link,
          },
          ...supervisors
            .filter((id) => id !== previous && id !== assigned)
            .map((userId) => ({
              workspace_id: row.workspace_id,
              user_id: userId,
              type: "case_reassigned" as const,
              title: assigned ? `Gestión reasignada por espera: ${name}` : `Gestión sin responsable por espera: ${name}`,
              body: assigned
                ? `${typeName}. Esperó ${waited} min hábiles; se repartió a otra persona.`
                : `${typeName}. Esperó ${waited} min hábiles; quedó en la cola sin responsable.`,
              link,
            })),
        ];
        await notify(db, notifications);
      }
      if (rows.length < BATCH) break;
    }
  }
  return stats;
}
