import { NextResponse, type NextRequest } from "next/server";
import { authIdentityOf } from "@/lib/view-as/options";
import { buildViewAsOptions } from "@/lib/view-as/rules";
import { requireRealOwner } from "@/lib/view-as/service";
import { displayName } from "@/lib/team-rules";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/view-as/options
 *
 * Solo el Dueño (también durante una vista, para "Cambiar vista"). Devuelve las
 * personas del espacio (incluidas las invitadas que aún no entraron y otros
 * Dueños) y los roles de ejemplo (Administrador y Supervisor/Asesor de cada
 * equipo activo): { people: [...], roles: [...] }.
 */
export async function GET(request: NextRequest) {
  const guard = await requireRealOwner(request, { checkOrigin: false });
  if (!guard.ok) return guard.response;
  const { viewerId, workspaceId, service } = guard.ctx;

  const [{ data: members }, { data: teams }] = await Promise.all([
    service.from("workspace_members").select("user_id, role").eq("workspace_id", workspaceId),
    service.from("teams").select("id, name, archived_at").eq("workspace_id", workspaceId),
  ]);
  const teamIds = (teams ?? []).map((t) => t.id);
  const { data: teamMembers } = teamIds.length
    ? await service.from("team_members").select("team_id, user_id, role").in("team_id", teamIds)
    : { data: [] as { team_id: string; user_id: string; role: string }[] };

  const people = await Promise.all(
    (members ?? []).map(async (m) => {
      const user = await authIdentityOf(service, m.user_id);
      return {
        userId: m.user_id,
        name: displayName(user),
        email: user?.email ?? null,
        role: m.role,
        lastSignInAt: user?.last_sign_in_at ?? null,
      };
    }),
  );

  const options = buildViewAsOptions({
    viewerId,
    members: people,
    teams: (teams ?? []).map((t) => ({ id: t.id, name: t.name, archivedAt: t.archived_at })),
    teamMembers: (teamMembers ?? []).map((tm) => ({ teamId: tm.team_id, userId: tm.user_id, role: tm.role })),
  });
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
}
