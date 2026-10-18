import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { attentionFromSettings } from "./attention-rules";
import { AttentionView } from "./attention-view";

export const metadata: Metadata = { title: "Atención" };

export default async function AttentionSettingsPage() {
  const { workspace, role, supabase } = await getWorkspace();

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
            <h1 className="text-2xl font-bold">Atención</h1>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-md px-8 text-center text-sm text-muted-foreground">
          Solo el Dueño o un Administrador pueden ver y cambiar la configuración de atención.
        </p>
      </div>
    );
  }

  // Equipos activos: con equipos, el modo de reparto se elige en cada equipo.
  const { count } = await supabase
    .from("teams")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .is("archived_at", null);

  return (
    <AttentionView
      workspaceId={workspace.id}
      initial={attentionFromSettings(workspace.settings)}
      activeTeams={count ?? 0}
    />
  );
}
