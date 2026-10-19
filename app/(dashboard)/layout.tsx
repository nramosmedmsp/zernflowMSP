import { Suspense } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { RouteProgress } from "@/components/ui/route-progress";
import { getWorkspace } from "@/lib/workspace";
import { Sidebar } from "@/components/sidebar";
import { displayName } from "@/lib/team-rules";
import type { MemberAvailability } from "@/lib/types/database";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Todo sale de getWorkspace (cacheado por petición): sin consultas propias.
  const { workspace, user, role, availability: rawAvailability, workspaces } = await getWorkspace();

  // Disponible / Ausente del usuario en el espacio actual (por defecto, Disponible).
  const availability: MemberAvailability = rawAvailability === "away" ? "away" : "available";

  return (
    <ToastProvider>
      <div className="flex h-screen">
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>
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
    </ToastProvider>
  );
}
