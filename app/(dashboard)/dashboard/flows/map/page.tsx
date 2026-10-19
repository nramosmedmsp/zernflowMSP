import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { loadLabCatalog } from "@/lib/flow-lab/load-catalog";
import { FlowMap } from "@/components/flow-lab/map/flow-map";

export const metadata = { title: "Mapa de flujos" };

export default async function FlowMapPage() {
  const { workspace, role, supabase } = await getWorkspace();
  // El mapa muestra toda la configuración de automatización: solo Dueño y Administradores.
  if (!isAdminRole(role)) redirect("/dashboard/flows");

  const [catalog, sequencesRes] = await Promise.all([
    loadLabCatalog(workspace.id, { db: supabase }),
    supabase.from("sequences").select("id, name").eq("workspace_id", workspace.id),
  ]);
  const sequences = (sequencesRes.data ?? []).map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-border px-8 py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/flows"
            aria-label="Volver a Flujos"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Mapa de flujos</h1>
            <p className="text-sm text-muted-foreground">
              Cómo arranca cada flujo, a dónde lleva y qué cosas conviene revisar.
            </p>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <FlowMap catalog={catalog} sequences={sequences} />
      </div>
    </div>
  );
}
