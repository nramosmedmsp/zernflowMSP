import { Suspense } from "react";
import { getWorkspace } from "@/lib/workspace";
import { listCaseMembers } from "@/lib/actions/cases";
import { loadSolutionSchedules } from "@/lib/cases/hours";
import { createServiceClient } from "@/lib/supabase/server";
import { isDemoChannel } from "@/lib/demo";
import { agentVisibilityFromSettings, isAdminRole } from "@/lib/permissions";
import type { InboxCase, InboxConversation, InboxMeta } from "@/components/inbox/inbox-model";
import { InboxView } from "./inbox-view";

const RECENT_CONVERSATIONS = 200;
const MAX_ACTIVE_CASES = 1000;
const IN_CHUNK = 150;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Todo con el cliente del usuario: la RLS (can_see_contact) decide qué chats y
// gestiones recibe. La vista y los filtros se aplican en el cliente.
export default async function InboxPage() {
  const { user, workspace, role, supabase } = await getWorkspace();

  const [{ data: recent }, { data: activeCases }, { data: types }, { data: teams }, membersResult, { data: channels }, { data: stages }] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("*, contacts(*)")
        .eq("workspace_id", workspace.id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(RECENT_CONVERSATIONS),
      supabase
        .from("cases")
        .select("*")
        .eq("workspace_id", workspace.id)
        .in("status", ["open", "scheduled"])
        .order("waiting_since", { ascending: true, nullsFirst: false })
        .limit(MAX_ACTIVE_CASES),
      supabase
        .from("case_types")
        .select("id, name, color, archived_at, protected, solution_deadline_hours")
        .eq("workspace_id", workspace.id)
        .order("position", { ascending: true }),
      supabase
        .from("teams")
        .select("id, name")
        .eq("workspace_id", workspace.id)
        .is("archived_at", null)
        .order("name", { ascending: true }),
      listCaseMembers(),
      supabase.from("channels").select("id, late_account_id").eq("workspace_id", workspace.id),
      // Etapas por join con el tipo: sin esperar a la lista de tipos.
      supabase
        .from("case_stages")
        .select("id, case_type_id, name, color, kind, archived_at, case_types!inner(workspace_id)")
        .eq("case_types.workspace_id", workspace.id)
        .order("position", { ascending: true }),
    ]);

  // Chats de contactos con gestiones activas que no están entre los recientes.
  const conversations: InboxConversation[] = [...((recent ?? []) as InboxConversation[])];
  const loadedContacts = new Set(conversations.map((c) => c.contact_id));
  const missing = [...new Set((activeCases ?? []).map((c) => c.contact_id))].filter((id) => !loadedContacts.has(id));
  if (missing.length) {
    const extra = await Promise.all(
      chunks(missing, IN_CHUNK).map((ids) =>
        supabase.from("conversations").select("*, contacts(*)").eq("workspace_id", workspace.id).in("contact_id", ids),
      ),
    );
    for (const { data } of extra) conversations.push(...((data ?? []) as InboxConversation[]));
  }

  // R2-10: horarios (equipo y empresa) para contar el plazo de la solución en horas hábiles.
  const solutionSchedules = (types ?? []).some((t) => t.solution_deadline_hours)
    ? await loadSolutionSchedules(await createServiceClient(), workspace.id)
    : null;

  const members = "error" in membersResult ? [] : membersResult.members;
  const me = members.find((m) => m.userId === user.id);
  const meta: InboxMeta = {
    userId: user.id,
    isAdmin: isAdminRole(role),
    agentSeesQueue: agentVisibilityFromSettings(workspace.settings) !== "own",
    supervisedTeamIds: (me?.teams ?? []).filter((t) => t.role === "supervisor").map((t) => t.teamId),
    myTeamIds: (me?.teams ?? []).map((t) => t.teamId),
    workspaceHasTeams: (teams ?? []).length > 0,
    workspaceName: workspace.name,
    solutionSchedules,
    caseTypes: (types ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      archived: t.archived_at !== null,
      protected: t.protected ?? false,
      solutionDeadlineHours: t.solution_deadline_hours ?? null,
      stages: (stages ?? [])
        .filter((s) => s.case_type_id === t.id)
        .map((s) => ({ id: s.id, name: s.name, color: s.color, kind: s.kind, archived: s.archived_at !== null })),
    })),
    teams: teams ?? [],
    demoChannelIds: (channels ?? []).filter((c) => isDemoChannel(c)).map((c) => c.id),
    members: members.map((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email,
      availability: m.availability,
      teams: m.teams.map((t) => ({ teamId: t.teamId, role: t.role })),
    })),
  };

  return (
    <Suspense>
      <InboxView
        conversations={conversations}
        cases={(activeCases ?? []) as InboxCase[]}
        workspaceId={workspace.id}
        meta={meta}
      />
    </Suspense>
  );
}
