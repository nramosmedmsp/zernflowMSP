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

  const filters = parseMetricFilters(params);

  // Los miembros (con sus equipos) se piden de una vez: de ahí sale también si
  // es supervisor, sin otra consulta a team_members.
  const membersPromise = listCaseMembers().then((res) => ("members" in res ? res.members : []));
  const isAdmin = isAdminRole(role);
  // Administrador: ya se sabe que ve todo, así las consultas no esperan a los miembros.
  // Supervisor (lidera algún equipo): todo lo de su equipo. Asesor: solo lo suyo (lo recorta RLS).
  const allMembersEarly = isAdmin ? null : await membersPromise;
  const isSupervisor = (allMembersEarly ?? [])
    .find((m) => m.userId === user.id)
    ?.teams.some((t) => t.role === "supervisor") ?? false;
  const canSeeOthers = isAdmin || isSupervisor;

  if (!canSeeOthers) {
    // Los cortes por asesor y equipo son solo para supervisores y administradores.
    filters.assigneeId = undefined;
    filters.teamId = undefined;
  }

  const visibleMembers = membersPromise.then((all) =>
    (canSeeOthers ? all : all.filter((m) => m.userId === user.id)).map((m) => ({
      userId: m.userId,
      name: m.name,
    })),
  );

  const loaded = await loadMetrics(supabase, {
    workspaceId: workspace.id,
    workspaceSettings: workspace.settings,
    filters,
    canSeeOthers,
    members: visibleMembers,
    now,
  });
  const members = await visibleMembers;
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
