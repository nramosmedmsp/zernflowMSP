// Reparto con E/S (docs/FASE-1-TECNICO.md 3.3). La decisión es pura
// (routing.ts); la elección final y el sello de last_assigned_at los hace la
// RPC `assign_case_pick` de forma atómica.
//
// Fase 2 (docs/FASE-2-TECNICO.md 3.1): fuera del horario del equipo de
// destino no se reparte; la gestión queda sin asignar (sin avisos) y el cron
// la reparte al abrir.

import type { Json } from "@/lib/types/database";
import { buildHoursInfo, isOpenAt, loadHolidayRows, type HoursInfo } from "./hours";
import {
  assignmentModeFromSettings,
  decideAssignment,
  normalizeAssignmentMode,
  type RoutingMember,
  type RoutingTeam,
  type RoutingTeamMember,
} from "./routing";
import {
  caseLink,
  contactName,
  loadCase,
  logActivity,
  notify,
  teamSupervisorIds,
  workspaceAdminIds,
  type Db,
} from "./io";
import type { AssignmentMode } from "@/lib/types/database";

export interface AssignmentContext {
  teams: RoutingTeam[];
  teamMembers: RoutingTeamMember[];
  members: RoutingMember[];
  workspaceMode: AssignmentMode;
  /** Fase 2: horarios, feriados y configuración de atención del espacio. */
  hours: HoursInfo;
}

/** Memoria por espacio para no releer equipos y miembros en cada gestión (cron). */
export type AssignmentContextCache = Map<string, Promise<AssignmentContext>>;

export async function loadAssignmentContext(
  db: Db,
  workspaceId: string,
  cache?: AssignmentContextCache,
): Promise<AssignmentContext> {
  const cached = cache?.get(workspaceId);
  if (cached) return cached;
  const promise = (async () => {
    const [{ data: ws }, { data: teams }, { data: members }, holidays] = await Promise.all([
      db.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
      db
        .from("teams")
        .select("id, name, is_default, assignment_mode, business_hours")
        .eq("workspace_id", workspaceId)
        .is("archived_at", null),
      db
        .from("workspace_members")
        .select("user_id, role, availability, last_assigned_at")
        .eq("workspace_id", workspaceId),
      loadHolidayRows(db, workspaceId),
    ]);
    const teamIds = (teams ?? []).map((t) => t.id);
    const { data: teamMembers } = teamIds.length
      ? await db.from("team_members").select("team_id, user_id, role, case_type_ids").in("team_id", teamIds)
      : { data: [] as { team_id: string; user_id: string; role: "supervisor" | "agent"; case_type_ids: string[] | null }[] };

    return {
      workspaceMode: assignmentModeFromSettings(ws?.settings),
      teams: (teams ?? []).map((t) => ({
        id: t.id,
        isDefault: t.is_default,
        assignmentMode: normalizeAssignmentMode(t.assignment_mode),
      })),
      teamMembers: (teamMembers ?? []).map((m) => ({
        teamId: m.team_id,
        userId: m.user_id,
        role: m.role,
        caseTypeIds: m.case_type_ids,
      })),
      members: (members ?? []).map((m) => ({
        userId: m.user_id,
        role: m.role,
        availability: m.availability,
        lastAssignedAt: m.last_assigned_at,
      })),
      hours: buildHoursInfo({ workspace: ws ?? null, teams: teams ?? [], holidays }),
    };
  })();
  cache?.set(workspaceId, promise);
  return promise;
}

export interface AssignOptions {
  /** Quien provoca el reparto (null = sistema). */
  actorId?: string | null;
  /** Avisar a supervisores y administradores si queda sin asignar. Por defecto sí. */
  notifyIfUnassigned?: boolean;
  /** Avisar al asesor asignado. Por defecto sí. */
  notifyAssignee?: boolean;
  cache?: AssignmentContextCache;
  /** Instante del reparto (para el horario). Por defecto, ahora. */
  at?: Date;
  /** Personas que no pueden recibirla (reasignación por espera). */
  exclude?: readonly string[];
  /** Motivo que se guarda en el registro `assigned` (p. ej. "espera"). */
  reason?: string;
}

export type AssignOutcome =
  | { status: "assigned"; assigneeId: string; teamId: string | null; via: "owner" | "round_robin" | "least_load" }
  | { status: "already_assigned"; assigneeId: string }
  | { status: "unassigned"; reason: "manual" | "no_eligible" | "off_hours"; teamId: string | null }
  | { status: "skipped"; reason: "not_found" | "not_open" };

function rpcStatus(data: Json | null): { status: string; assigneeId: string | null } {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const status = typeof data.status === "string" ? data.status : "error";
    const assigneeId = typeof data.assignee_id === "string" ? data.assignee_id : null;
    return { status, assigneeId };
  }
  return { status: "error", assigneeId: null };
}

/** Cuánto tiempo no se le devuelve la gestión a quien la devolvió a la cola a mano. */
export const RETURNED_TO_QUEUE_HOURS = 12;

/** Quien devolvió la gestión a la cola a mano en las últimas horas (null si nadie). */
async function recentlyReturnedBy(db: Db, caseId: string, at: Date): Promise<string | null> {
  const since = new Date(at.getTime() - RETURNED_TO_QUEUE_HOURS * 3_600_000).toISOString();
  const { data } = await db
    .from("activity")
    .select("from_value, meta, created_at")
    .eq("case_id", caseId)
    .eq("type", "unassigned")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  // Solo las devoluciones a mano (no un cambio de equipo ni un reparto nuevo).
  const manual = (data ?? []).find((r) => {
    const meta = r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? (r.meta as Record<string, unknown>) : {};
    return meta.via === "manual";
  });
  return manual?.from_value ?? null;
}

/**
 * Aplica el reparto a una gestión abierta sin responsable. Guarda el equipo
 * de destino en `cases.team_id`, asigna (responsable fijo o modo del equipo),
 * sella `last_assigned_at`, notifica y fija el responsable del contacto si no
 * tenía (solo en destino "al responsable del contacto").
 */
export async function assignCase(db: Db, caseId: string, opts: AssignOptions = {}): Promise<AssignOutcome> {
  const row = await loadCase(db, caseId);
  if (!row) return { status: "skipped", reason: "not_found" };
  if (row.status !== "open") return { status: "skipped", reason: "not_open" };
  if (row.assignee_id) return { status: "already_assigned", assigneeId: row.assignee_id };

  const [{ data: caseType }, { data: contact }, ctx] = await Promise.all([
    row.case_type_id
      ? db
          .from("case_types")
          .select("id, name, routing, fixed_team_id")
          .eq("id", row.case_type_id)
          .eq("workspace_id", row.workspace_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from("contacts")
      .select("id, display_name, owner_id, team_id")
      .eq("id", row.contact_id)
      .eq("workspace_id", row.workspace_id)
      .maybeSingle(),
    loadAssignmentContext(db, row.workspace_id, opts.cache),
  ]);
  if (!contact) return { status: "skipped", reason: "not_found" };

  // M-5: quien devolvió la gestión a la cola a mano no la recibe de vuelta enseguida.
  const exclude = [...(opts.exclude ?? [])];
  const returnedBy = await recentlyReturnedBy(db, row.id, opts.at ?? new Date());
  if (returnedBy && !exclude.includes(returnedBy)) exclude.push(returnedBy);

  const routing = caseType?.routing ?? "contact_owner";
  const decision = decideAssignment({
    caseTypeId: caseType?.id ?? null,
    routing,
    fixedTeamId: caseType?.fixed_team_id ?? null,
    currentTeamId: row.team_id,
    contactOwnerId: contact.owner_id,
    contactTeamId: contact.team_id,
    teams: ctx.teams,
    teamMembers: ctx.teamMembers,
    members: ctx.members,
    workspaceMode: ctx.workspaceMode,
    excludeUserIds: exclude.length > 0 ? exclude : undefined,
  });

  if (decision.teamId !== row.team_id) {
    const { error } = await db.from("cases").update({ team_id: decision.teamId }).eq("id", row.id);
    if (error) console.error("[cases] set team", error.message);
    else if (row.team_id !== null) {
      await logActivity(db, {
        workspace_id: row.workspace_id,
        type: "team_changed",
        case_id: row.id,
        contact_id: row.contact_id,
        actor_id: opts.actorId ?? null,
        from_value: row.team_id,
        to_value: decision.teamId,
        meta: { reason: "routing" },
      });
    }
  }

  const name = contactName(contact);
  const typeName = caseType?.name ?? "Sin clasificar";
  const link = caseLink(row.contact_id, row.id);

  // Fuera de horario no se reparte (ni se avisa): el cron lo hace al abrir.
  // El modo manual y "sin elegibles" siguen su curso: no dependen de la hora.
  if (
    (decision.kind === "owner" || decision.kind === "pick") &&
    !isOpenAt(ctx.hours, decision.teamId, opts.at ?? new Date())
  ) {
    return { status: "unassigned", reason: "off_hours", teamId: decision.teamId };
  }

  let assigned: { assigneeId: string; via: "owner" | "round_robin" | "least_load" } | null = null;
  if (decision.kind === "owner" || decision.kind === "pick") {
    const candidates = decision.kind === "owner" ? [decision.userId] : decision.candidates;
    const mode = decision.kind === "owner" ? "round_robin" : decision.mode;
    const { data, error } = await db.rpc("assign_case_pick", {
      p_case_id: row.id,
      p_candidates: candidates,
      p_mode: mode,
    });
    if (error) {
      console.error("[cases] assign_case_pick", error.message);
    } else {
      const result = rpcStatus(data);
      if (result.status === "assigned" && result.assigneeId) {
        assigned = { assigneeId: result.assigneeId, via: decision.kind === "owner" ? "owner" : mode };
      } else if (result.status === "already_assigned" && result.assigneeId) {
        return { status: "already_assigned", assigneeId: result.assigneeId };
      } else if (result.status === "not_assignable") {
        return { status: "skipped", reason: "not_open" };
      }
    }
  }

  if (assigned) {
    await logActivity(db, {
      workspace_id: row.workspace_id,
      type: "assigned",
      case_id: row.id,
      contact_id: row.contact_id,
      actor_id: opts.actorId ?? null,
      from_value: null,
      to_value: assigned.assigneeId,
      meta: { via: assigned.via, team_id: decision.teamId, ...(opts.reason ? { reason: opts.reason } : {}) },
    });
    if (opts.notifyAssignee !== false) {
      await notify(db, [
        {
          workspace_id: row.workspace_id,
          user_id: assigned.assigneeId,
          type: "case_assigned",
          title: `Nueva gestión asignada: ${name}`,
          body: typeName,
          link,
        },
      ]);
    }
    // El responsable del contacto se fija con el primer reparto "al responsable".
    if (!contact.owner_id && routing === "contact_owner") {
      const { data: updated } = await db
        .from("contacts")
        .update({ owner_id: assigned.assigneeId })
        .eq("id", contact.id)
        .is("owner_id", null)
        .select("id");
      if (updated && updated.length > 0) {
        await logActivity(db, {
          workspace_id: row.workspace_id,
          type: "owner_changed",
          contact_id: contact.id,
          case_id: row.id,
          actor_id: null,
          from_value: null,
          to_value: assigned.assigneeId,
          meta: { reason: "first_assignment" },
        });
      }
    }
    return { status: "assigned", assigneeId: assigned.assigneeId, teamId: decision.teamId, via: assigned.via };
  }

  const reason = decision.kind === "manual" ? "manual" : "no_eligible";
  if (opts.notifyIfUnassigned !== false) {
    const [admins, supervisors] = await Promise.all([
      workspaceAdminIds(db, row.workspace_id),
      decision.teamId ? teamSupervisorIds(db, decision.teamId) : Promise.resolve([] as string[]),
    ]);
    const recipients = [...new Set([...supervisors, ...admins])];
    await notify(
      db,
      recipients.map((userId) => ({
        workspace_id: row.workspace_id,
        user_id: userId,
        type: "case_unassigned" as const,
        title:
          reason === "manual" ? `Gestión por asignar: ${name}` : `Gestión sin asignar: ${name}`,
        body:
          reason === "manual"
            ? `${typeName}. El reparto de este equipo es manual.`
            : `${typeName}. No hay asesores disponibles que atiendan este tipo de gestión.`,
        link,
      })),
    );
  }
  return { status: "unassigned", reason, teamId: decision.teamId };
}
