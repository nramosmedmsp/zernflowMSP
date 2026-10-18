import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { parseBusinessHours } from "@/lib/business-hours";
import { HoursView, type HoursViewData } from "@/components/settings/hours/hours-view";

export const metadata: Metadata = { title: "Horarios" };

export default async function HoursSettingsPage() {
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
            <h1 className="text-2xl font-bold">Horarios</h1>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-md px-8 text-center text-sm text-muted-foreground">
          Solo el Dueño o un Administrador pueden ver y cambiar los horarios.
        </p>
      </div>
    );
  }

  const [{ data: teams }, { data: holidays }] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, business_hours")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("name", { ascending: true }),
    supabase
      .from("holidays")
      .select("id, team_id, date, name")
      .eq("workspace_id", workspace.id)
      .order("date", { ascending: true })
      .limit(5000),
  ]);

  const settings =
    workspace.settings && typeof workspace.settings === "object" && !Array.isArray(workspace.settings)
      ? (workspace.settings as Record<string, unknown>)
      : {};

  const data: HoursViewData = {
    workspaceId: workspace.id,
    companyHours: parseBusinessHours(settings.business_hours),
    teams: (teams ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      hours: parseBusinessHours(t.business_hours),
    })),
    holidays: (holidays ?? []).map((h) => ({
      id: h.id,
      teamId: h.team_id,
      date: h.date.slice(0, 10),
      name: h.name,
    })),
  };

  return <HoursView data={data} />;
}
