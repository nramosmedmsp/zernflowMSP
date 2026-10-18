import { getWorkspace } from "@/lib/workspace";
import { Sidebar } from "@/components/sidebar";
import { displayName } from "@/lib/team-rules";
import type { MemberAvailability } from "@/lib/types/database";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { workspace, user, role, supabase } = await getWorkspace();

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("role, workspace_id, availability, workspaces(id, name, slug)")
    .eq("user_id", user.id);

  const workspaces = (memberships ?? [])
    .map((m) => ({
      ...(m.workspaces as { id: string; name: string; slug: string }),
      role: m.role,
    }))
    .filter((w) => w.id);

  // Disponible / Ausente del usuario en el espacio actual (por defecto, Disponible).
  const availability: MemberAvailability =
    memberships?.find((m) => m.workspace_id === workspace.id)?.availability === "away" ? "away" : "available";

  return (
    <div className="flex h-screen">
      <Sidebar
        workspace={workspace}
        user={user}
        userName={displayName({ id: user.id, email: user.email, user_metadata: user.user_metadata })}
        role={role}
        availability={availability}
        workspaces={workspaces}
      />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
