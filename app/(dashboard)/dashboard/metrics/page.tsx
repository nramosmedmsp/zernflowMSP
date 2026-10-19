import type { Metadata } from "next";
import { getWorkspace } from "@/lib/workspace";
import { listCaseMembers } from "@/lib/actions/cases";
import { isAdminRole } from "@/lib/permissions";
import { computeMetrics } from "@/lib/metrics/compute";
import { loadMetrics } from "@/lib/metrics/load";
import { parseMetricFilters } from "@/lib/metrics/period";
import { MetricsView, type TabKey } from "./metrics-view";

export const metadata: Metadata = { title: "Métricas" };

const TAB_KEYS: readonly TabKey[] = ["summary", "agents", "funnel", "results", "overdue", "volume"];

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { user, workspace, role, supabase } = await getWorkspace();
  const now = new Date();

  // Supervisor: lidera algún equipo. Administrador: todo. Asesor: solo lo suyo (lo recorta RLS).
  const { data: myTeams } = await supabase.from("team_members").select("role").eq("user_id", user.id);
  const isSupervisor = (myTeams ?? []).some((m) => m.role === "supervisor");
  const canSeeOthers = isAdminRole(role) || isSupervisor;

  const filters = parseMetricFilters(params);
  if (!canSeeOthers) {
    // Los cortes por asesor y equipo son solo para supervisores y administradores.
    filters.assigneeId = undefined;
    filters.teamId = undefined;
  }

  const membersRes = await listCaseMembers();
  const allMembers = "members" in membersRes ? membersRes.members : [];
  const members = (canSeeOthers ? allMembers : allMembers.filter((m) => m.userId === user.id)).map((m) => ({
    userId: m.userId,
    name: m.name,
  }));

  const loaded = await loadMetrics(supabase, {
    workspaceId: workspace.id,
    workspaceSettings: workspace.settings,
    filters,
    canSeeOthers,
    members,
    now,
  });
  const report = computeMetrics(loaded.input, filters);

  const tabParam = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const initialTab = TAB_KEYS.find((k) => k === tabParam) ?? "summary";

  return (
    <MetricsView
      report={report}
      filters={filters}
      options={{
        caseTypes: loaded.input.caseTypes.map((t) => ({ id: t.id, name: t.name })),
        teams: loaded.input.teams,
        members,
        channels: loaded.channels,
        contactTypes: loaded.contactTypes,
      }}
      canSeeOthers={canSeeOthers}
      staleDays={loaded.input.staleStageDays}
      truncatedCases={loaded.truncatedCases}
      truncatedInbound={loaded.truncatedInbound}
      initialTab={initialTab}
    />
  );
}
