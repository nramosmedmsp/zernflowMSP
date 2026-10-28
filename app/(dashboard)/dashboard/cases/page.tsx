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

  // Etapas por join con el tipo (sin esperar a la lista de tipos) y el resto en paralelo.
  const [typesRes, teamsRes, membersRes, stagesRes] = await Promise.all([
    supabase
      .from("case_types")
      .select("id, name, color, archived_at, solution_deadline_hours")
      .eq("workspace_id", workspace.id)
      .order("position", { ascending: true }),
    supabase
      .from("teams")
      .select("id, name")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("name", { ascending: true }),
    listCaseMembers(),
    supabase
      .from("case_stages")
      .select("id, case_type_id, name, color, archived_at, position, case_types!inner(workspace_id)")
      .eq("case_types.workspace_id", workspace.id)
      .order("position", { ascending: true }),
  ]);

  const caseTypes = typesRes.data ?? [];
  const teams = teamsRes.data ?? [];
  const members = "members" in membersRes ? membersRes.members : [];

  // Equipos que superviso: ya vienen en la lista de miembros (equipos activos).
  const supervisedTeamIds = (members.find((m) => m.userId === user.id)?.teams ?? [])
    .filter((t) => t.role === "supervisor")
    .map((t) => t.teamId);
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
        solutionDeadlineHours: t.solution_deadline_hours ?? null,
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
