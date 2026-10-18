import { getWorkspace } from "@/lib/workspace";
import { listCaseMembers } from "@/lib/actions/cases";
import { isAdminRole } from "@/lib/permissions";
import { parseCaseListParams } from "@/components/cases/case-filters";
import { CasesView } from "@/components/cases/cases-view";
import { loadCases } from "./load-cases";

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseCaseListParams(await searchParams);
  const { user, workspace, role, supabase } = await getWorkspace();
  const isAdmin = isAdminRole(role);
  const now = new Date();

  const [typesRes, teamsRes, membersRes] = await Promise.all([
    supabase
      .from("case_types")
      .select("id, name, color, archived_at")
      .eq("workspace_id", workspace.id)
      .order("position", { ascending: true }),
    supabase
      .from("teams")
      .select("id, name")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("name", { ascending: true }),
    listCaseMembers(),
  ]);

  const caseTypes = typesRes.data ?? [];
  const teams = teamsRes.data ?? [];
  const members = "members" in membersRes ? membersRes.members : [];

  const typeIds = caseTypes.map((t) => t.id);
  const [stagesRes, myTeamsRes] = await Promise.all([
    typeIds.length
      ? supabase
          .from("case_stages")
          .select("id, case_type_id, name, color, archived_at, position")
          .in("case_type_id", typeIds)
          .order("position", { ascending: true })
      : Promise.resolve({ data: [] as { id: string; case_type_id: string; name: string; color: string | null; archived_at: string | null; position: number }[] }),
    teams.length
      ? supabase
          .from("team_members")
          .select("team_id, role")
          .eq("user_id", user.id)
          .in("team_id", teams.map((t) => t.id))
      : Promise.resolve({ data: [] as { team_id: string; role: string }[] }),
  ]);

  const supervisedTeamIds = (myTeamsRes.data ?? []).filter((m) => m.role === "supervisor").map((m) => m.team_id);
  const isSupervisor = supervisedTeamIds.length > 0;
  const canSeeOthers = isAdmin || isSupervisor;

  const result = await loadCases(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    canSeeOthers,
    params,
    now,
  });

  // A quién puede asignar al crear una gestión: administrador, a cualquiera;
  // supervisor, a su equipo; asesor, solo a sí mismo.
  const assignable = isAdmin
    ? members
    : isSupervisor
      ? members.filter((m) => m.userId === user.id || m.teams.some((t) => supervisedTeamIds.includes(t.teamId)))
      : [];

  return (
    <CasesView
      rows={result.rows}
      total={result.total}
      page={result.page}
      params={{ ...params, page: result.page }}
      nowIso={now.toISOString()}
      caseTypes={caseTypes.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        archived: t.archived_at !== null,
      }))}
      stages={(stagesRes.data ?? []).map((s) => ({
        id: s.id,
        caseTypeId: s.case_type_id,
        name: s.name,
        color: s.color,
      }))}
      teams={teams}
      members={members.map((m) => ({ userId: m.userId, name: m.name }))}
      assignableMembers={assignable.map((m) => ({ userId: m.userId, name: m.name }))}
      me={{ userId: user.id, canSeeOthers }}
    />
  );
}
