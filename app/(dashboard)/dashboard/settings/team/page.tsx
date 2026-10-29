import type { Metadata } from "next";
import { getWorkspace } from "@/lib/workspace";
import { TeamView } from "@/components/settings/team-view";
import { createServiceClient } from "@/lib/supabase/server";
import { isMailConfigured } from "@/lib/mail/settings";
import { NoPermission } from "@/components/settings/cases/no-permission";
import { canManageTeam, memberViewFromUser } from "@/lib/team-rules";

export const metadata: Metadata = { title: "Equipo" };

export default async function TeamPage() {
  const { workspace, user, role } = await getWorkspace();

  // B-7: la lista de miembros (correos, roles, estado) es solo para el Dueño y
  // los Administradores; se revisa en el servidor antes de consultar nada.
  if (!canManageTeam(role)) {
    return (
      <NoPermission
        title="Equipo"
        message="Solo el Dueño o un Administrador pueden ver y administrar el equipo."
      />
    );
  }

  // El cliente de servicio hace falta para ver a todos los miembros (la política
  // SELECT de workspace_members solo devuelve las filas propias) y para leer
  // auth.users (correo, nombre y último inicio de sesión).
  const serviceClient = await createServiceClient();

  const { data: members } = await serviceClient
    .from("workspace_members")
    .select("workspace_id, user_id, role, created_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: true });

  const memberDetails = await Promise.all(
    (members ?? []).map(async (member) => {
      const {
        data: { user: memberUser },
      } = await serviceClient.auth.admin.getUserById(member.user_id);

      return memberViewFromUser(memberUser, {
        userId: member.user_id,
        role: member.role,
        joinedAt: member.created_at,
      });
    })
  );

  const isManager = canManageTeam(role);

  // Invitaciones pendientes del sistema anterior de enlaces (las nuevas se
  // marcan como aceptadas en cuanto se crea el usuario).
  const { data: pendingInvites } = isManager
    ? await serviceClient
        .from("workspace_invites")
        .select("id, email, role, created_at, expires_at")
        .eq("workspace_id", workspace.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
    : { data: [] };

  const mailConfigured = isManager ? await isMailConfigured(serviceClient) : false;

  return (
    <TeamView
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      currentUserId={user.id}
      currentUserRole={role}
      members={memberDetails}
      legacyInvites={pendingInvites ?? []}
      mailConfigured={mailConfigured}
    />
  );
}
