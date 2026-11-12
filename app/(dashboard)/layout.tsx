import { Suspense } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { RouteProgress } from "@/components/ui/route-progress";
import { getWorkspace } from "@/lib/workspace";
import { Sidebar } from "@/components/sidebar";
import { MobileNavShell } from "@/components/mobile-nav-shell";
import { APP_NAME } from "@/lib/brand";
import { ViewAsProvider } from "@/components/view-as/view-as-context";
import { ViewAsBar } from "@/components/view-as/view-as-bar";
import { displayName } from "@/lib/team-rules";
import { viewAsRoleText } from "@/lib/view-as/ui-rules";
import type { MemberAvailability } from "@/lib/types/database";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Todo sale de getWorkspace (cacheado por petición): sin consultas propias.
  // Con una vista de "Ver como" activa, es la identidad de la persona (o rol) vista.
  const { workspace, user, role, availability: rawAvailability, workspaces, viewAs, supabase } = await getWorkspace();

  // Disponible / Ausente del usuario en el espacio actual (por defecto, Disponible).
  const availability: MemberAvailability = rawAvailability === "away" ? "away" : "available";

  const info = viewAs.active ? viewAs.info : null;
  let roleText = "";
  if (info) {
    // Rol por equipo de la persona vista (solo para el texto de la franja).
    let teamRoles: { role: string; teamName: string }[] = [];
    if (info.kind === "person") {
      const { data } = await supabase
        .from("team_members")
        .select("role, teams(name, archived_at)")
        .eq("user_id", info.targetUserId);
      teamRoles = (data ?? []).flatMap((row) => {
        const team = row.teams as unknown as { name: string; archived_at: string | null } | null;
        return team && !team.archived_at ? [{ role: row.role as string, teamName: team.name }] : [];
      });
    }
    roleText = viewAsRoleText(info, role, teamRoles);
  }

  // En vista no se cambia de espacio: queda fijado al de la vista.
  const shownWorkspaces = info ? workspaces.filter((w) => w.id === workspace.id) : workspaces;
  // El Dueño real, en reposo, tiene la franja delgada con el selector.
  const isRealOwner = role === "owner" && !viewAs.locked;

  return (
    <ToastProvider>
      <ViewAsProvider active={viewAs.active} locked={viewAs.locked} ended={viewAs.ended} info={info} roleText={roleText}>
        <div className="flex h-screen flex-col">
          <ViewAsBar isRealOwner={isRealOwner} />
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <Suspense fallback={null}>
              <RouteProgress />
            </Suspense>
            <MobileNavShell appName={APP_NAME}>
            <Sidebar
              workspace={workspace}
              user={user}
              userName={displayName({ id: user.id, email: user.email, user_metadata: user.user_metadata })}
              role={role}
              availability={availability}
              workspaces={shownWorkspaces}
            />
            </MobileNavShell>
            <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
          </div>
        </div>
      </ViewAsProvider>
    </ToastProvider>
  );
}
