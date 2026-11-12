import { getWorkspace } from "@/lib/workspace";
import { listCaseMembers } from "@/lib/actions/cases";
import { loadSolutionSchedules } from "@/lib/cases/hours";
import { createServiceClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/permissions";
import { parseCaseListParams } from "@/components/cases/case-filters";
import { CasesView } from "@/components/cases/cases-view";
import { withoutSample } from "@/lib/view-as/ui-rules";
import { loadBoard, loadCases, loadCasesByClient } from "./load-cases";

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
  const [typesRes, teamsRes, membersRes, stagesRes, contactTypesRes] = await Promise.all([
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
    supabase.from("contact_types").select("id, name, color").eq("workspace_id", workspace.id),
  ]);

  const caseTypes = typesRes.data ?? [];
  const solutionSchedules = caseTypes.some((t) => t.solution_deadline_hours)
    ? await loadSolutionSchedules(await createServiceClient(), workspace.id)
    : null;
  const teams = teamsRes.data ?? [];
  const members = "members" in membersRes ? membersRes.members : [];

  // Equipos que superviso: ya vienen en la lista de miembros (equipos activos).
  const supervisedTeamIds = (members.find((m) => m.userId === user.id)?.teams ?? [])
    .filter((t) => t.role === "supervisor")
    .map((t) => t.teamId);
  const isSupervisor = supervisedTeamIds.length > 0;
  const canSeeOthers = isAdmin || isSupervisor;

  const listArgs = { workspaceId: workspace.id, userId: user.id, canSeeOthers, params, now };
  const clientResult =
    params.view === "client"
      ? await loadCasesByClient(supabase, {
          ...listArgs,
          caseTypes: caseTypes.map((t) => ({ id: t.id, solutionDeadlineHours: t.solution_deadline_hours ?? null })),
          solutionSchedules,
        })
      : null;
  const boardResult =
    params.view === "board"
      ? await loadBoard(supabase, {
          ...listArgs,
          caseTypes: caseTypes.filter((t) => t.archived_at === null).map((t) => ({ id: t.id, name: t.name, color: t.color })),
          solutionSchedules,
        })
      : null;
  const result = clientResult || boardResult ? null : await loadCases(supabase, listArgs);

  // A quién puede asignar al crear una gestión: administrador, a cualquiera;
  // supervisor, a su equipo; asesor, solo a sí mismo.
  const assignable = isAdmin
    ? withoutSample(members)
    : isSupervisor
      ? withoutSample(members).filter((m) => m.userId === user.id || m.teams.some((t) => supervisedTeamIds.includes(t.teamId)))
      : [];

  return (
    <CasesView
      rows={result?.rows ?? []}
      clientGroups={clientResult?.groups ?? []}
      clientTotals={clientResult ? { clients: clientResult.totalClients, cases: clientResult.totalCases, truncated: clientResult.truncated } : null}
      contactTypes={(contactTypesRes.data ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color }))}
      board={boardResult}
      total={clientResult ? clientResult.totalClients : boardResult ? boardResult.total : (result?.total ?? 0)}
      page={clientResult?.page ?? result?.page ?? 1}
      params={{ ...params, page: clientResult?.page ?? result?.page ?? 1 }}
      nowIso={now.toISOString()}
      solutionSchedules={solutionSchedules}
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
      me={{ userId: user.id, canSeeOthers, isAdmin, supervisedTeamIds }}
    />
  );
}
