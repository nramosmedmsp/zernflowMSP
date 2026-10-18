import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/permissions";
import { displayName } from "@/lib/team-rules";
import { TeamsView, type TeamsViewData } from "@/components/settings/teams/teams-view";

export const metadata: Metadata = { title: "Equipos" };

export default async function TeamsSettingsPage() {
  const { workspace, role } = await getWorkspace();

  if (!isAdminRole(role)) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-8 py-6">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/settings"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Volver a Configuración"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-2xl font-bold">Equipos</h1>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-md px-8 text-center text-sm text-muted-foreground">
          Solo el Dueño o un Administrador pueden ver y cambiar los equipos.
        </p>
      </div>
    );
  }

  // El cliente de servicio hace falta para ver a todos los miembros y leer sus
  // nombres en auth.users; el acceso ya se validó arriba.
  const db = await createServiceClient();

  const [{ data: teams }, { data: members }, { data: caseTypes }] = await Promise.all([
    db.from("teams").select("*").eq("workspace_id", workspace.id).order("name", { ascending: true }),
    db
      .from("workspace_members")
      .select("user_id, role, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: true }),
    db
      .from("case_types")
      .select("id, name, color")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("position", { ascending: true }),
  ]);

  const teamIds = (teams ?? []).map((t) => t.id);
  const { data: teamMembers } = teamIds.length
    ? await db
        .from("team_members")
        .select("team_id, user_id, role, case_type_ids")
        .in("team_id", teamIds)
    : { data: [] };

  const workspaceMembers = await Promise.all(
    (members ?? []).map(async (m) => {
      const {
        data: { user },
      } = await db.auth.admin.getUserById(m.user_id);
      return {
        userId: m.user_id,
        name: displayName(user),
        email: user?.email ?? "",
        role: m.role,
      };
    }),
  );
  workspaceMembers.sort((a, b) => a.name.localeCompare(b.name, "es"));

  const data: TeamsViewData = {
    workspaceId: workspace.id,
    teams: (teams ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      isDefault: t.is_default,
      archived: t.archived_at !== null,
      assignmentMode: t.assignment_mode,
      members: (teamMembers ?? [])
        .filter((tm) => tm.team_id === t.id)
        .map((tm) => ({ userId: tm.user_id, role: tm.role, caseTypeIds: tm.case_type_ids })),
    })),
    workspaceMembers,
    caseTypes: (caseTypes ?? []).map((c) => ({ id: c.id, name: c.name })),
  };

  return <TeamsView data={data} />;
}
