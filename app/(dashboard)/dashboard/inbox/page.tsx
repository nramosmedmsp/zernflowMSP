import { Suspense } from "react";
import { getWorkspace } from "@/lib/workspace";
import { listCaseMembers } from "@/lib/actions/cases";
import { loadSolutionSchedules } from "@/lib/cases/hours";
import { createServiceClient } from "@/lib/supabase/server";
import { isDemoChannel } from "@/lib/demo";
import { agentVisibilityFromSettings, isAdminRole } from "@/lib/permissions";
import type { InboxCase, InboxConversation, InboxMeta } from "@/components/inbox/inbox-model";
import { InboxView } from "./inbox-view";

import { FETCH_IN_CHUNK, INBOX_PAGE_SIZE, chunkList, loadActiveCases, oldestMessageAt } from "@/components/inbox/inbox-paging";

/** Consultas de chats en paralelo al traer los de las gestiones activas. */
const PARALLEL_CHUNKS = 6;

// Todo con el cliente del usuario: la RLS (can_see_contact) decide qué chats y
// gestiones recibe. La vista y los filtros se aplican en el cliente.
//
// Sin recortes silenciosos (Tanda 4): las gestiones activas se leen TODAS por
// páginas (con aviso si se pasa el tope) y de ellas salen los contadores; los
// chats sin gestión activa (solo en "Todos / Todo") llegan de INBOX_PAGE_SIZE en
// INBOX_PAGE_SIZE con "Cargar más"; la búsqueda la hace el servidor sobre todos.
export default async function InboxPage() {
  const { user, workspace, role, supabase } = await getWorkspace();

  const [{ data: recent }, activeResult, { data: types }, { data: teams }, membersResult, { data: channels }, { data: stages }, { data: contactTypes }] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("*, contacts(*)")
        .eq("workspace_id", workspace.id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(INBOX_PAGE_SIZE),
      loadActiveCases(supabase, workspace.id),
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
      // Tipos de contacto de una vez para el chip de la lista y del chat (select * tolera que falte 00036).
      supabase.from("contact_types").select("*").eq("workspace_id", workspace.id).order("position", { ascending: true }),
    ]);

  const activeCases = activeResult.cases;
  // Total de chats solo para administradores (ven "Todos"): el aviso "Mostrando X de Y".
  const admin = isAdminRole(role);
  const totalConversations = admin
    ? ((await supabase.from("conversations").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id)).count ?? null)
    : null;
  const recentList = (recent ?? []) as InboxConversation[];
  const hasMoreRecent = recentList.length >= INBOX_PAGE_SIZE;

  // Chats de contactos con gestiones activas que no están entre los recientes.
  const conversations: InboxConversation[] = [...((recent ?? []) as InboxConversation[])];
  const loadedContacts = new Set(conversations.map((c) => c.contact_id));
  const missing = [...new Set(activeCases.map((c) => c.contact_id))].filter((id) => !loadedContacts.has(id));
  if (missing.length) {
    const groups = chunkList(chunkList(missing, FETCH_IN_CHUNK), PARALLEL_CHUNKS);
    for (const group of groups) {
      const extra = await Promise.all(
        group.map((ids) =>
          supabase.from("conversations").select("*, contacts(*)").eq("workspace_id", workspace.id).in("contact_id", ids),
        ),
      );
      for (const { data, error } of extra) {
        if (error) throw new Error(`No se pudieron leer los chats: ${error.message}`);
        conversations.push(...((data ?? []) as InboxConversation[]));
      }
    }
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
    contactTypes: (contactTypes ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      description: t.description ?? null,
      isDefault: t.is_default,
      archived: t.archived_at !== null,
    })),
    demoChannelIds: (channels ?? []).filter((c) => isDemoChannel(c)).map((c) => c.id),
    members: members.map((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email,
      availability: m.availability,
      teams: m.teams.map((t) => ({ teamId: t.teamId, role: t.role })),
      ...(m.sample ? { sample: true } : {}),
    })),
  };

  return (
    <Suspense>
      <InboxView
        conversations={conversations}
        cases={activeCases as InboxCase[]}
        casesTruncated={activeResult.truncated}
        recentPage={{ hasMore: hasMoreRecent, cursor: oldestMessageAt(recentList) }}
        totalConversations={totalConversations}
        workspaceId={workspace.id}
        meta={meta}
      />
    </Suspense>
  );
}
