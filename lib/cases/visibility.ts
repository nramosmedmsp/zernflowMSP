// Carga lo necesario para evaluar en código la visibilidad de un contacto
// (réplica de can_see_contact_row) y los permisos sobre sus gestiones, con el
// cliente de servicio.

import { agentVisibilityFromSettings, contactVisibilityReason } from "@/lib/permissions";
import type { CaseStatus, TeamRole, WorkspaceRole } from "@/lib/types/database";
import type { ActorInfo } from "./access";
import type { Db } from "./io";

export interface WorkspaceActor extends ActorInfo {
  workspaceId: string;
  role: WorkspaceRole | null;
  /** Equipos activos del espacio (id y nombre). */
  teams: { id: string; name: string; isDefault: boolean }[];
}

function settingsFlag(settings: unknown, key: string): boolean {
  return (
    !!settings &&
    typeof settings === "object" &&
    !Array.isArray(settings) &&
    (settings as Record<string, unknown>)[key] === true
  );
}

/** Rol, equipos y configuración de visibilidad de un usuario en un espacio. */
export async function loadWorkspaceActor(db: Db, workspaceId: string, userId: string): Promise<WorkspaceActor> {
  const [{ data: member }, { data: ws }, { data: teams }] = await Promise.all([
    db
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle(),
    db.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle(),
    db
      .from("teams")
      .select("id, name, is_default")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .order("name", { ascending: true }),
  ]);
  const teamIds = (teams ?? []).map((t) => t.id);
  const { data: memberships } = teamIds.length
    ? await db.from("team_members").select("team_id, role").eq("user_id", userId).in("team_id", teamIds)
    : { data: [] as { team_id: string; role: TeamRole }[] };

  return {
    workspaceId,
    userId,
    role: member?.role ?? null,
    memberships: (memberships ?? []).map((m) => ({ teamId: m.team_id, role: m.role })),
    agentVisibility: agentVisibilityFromSettings(ws?.settings),
    agentCanReturnToQueue: settingsFlag(ws?.settings, "agent_can_return_to_queue"),
    workspaceHasTeams: teamIds.length > 0,
    teams: (teams ?? []).map((t) => ({ id: t.id, name: t.name, isDefault: t.is_default })),
  };
}

export interface ContactCaseSummary {
  status: CaseStatus;
  assignee_id: string | null;
  team_id: string | null;
}

/** Gestiones del contacto (para la regla de visibilidad). */
export async function loadContactCaseSummaries(db: Db, contactId: string): Promise<ContactCaseSummary[]> {
  const { data } = await db
    .from("cases")
    .select("status, assignee_id, team_id")
    .eq("contact_id", contactId)
    .in("status", ["scheduled", "open"]);
  return data ?? [];
}

/** ¿El actor ve el contacto? (regla 2.1 en código) */
export function actorSeesContact(
  actor: WorkspaceActor,
  contact: { owner_id: string | null; team_id: string | null },
  cases: readonly ContactCaseSummary[],
): boolean {
  return (
    contactVisibilityReason({
      userId: actor.userId,
      role: actor.role,
      agentVisibility: actor.agentVisibility,
      workspaceHasTeams: actor.workspaceHasTeams,
      memberships: actor.memberships,
      contact: { ownerId: contact.owner_id, teamId: contact.team_id },
      cases: cases.map((c) => ({ status: c.status, assigneeId: c.assignee_id, teamId: c.team_id })),
    }) !== null
  );
}
