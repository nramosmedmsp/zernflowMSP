import type { Metadata } from "next";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { createServiceClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/team-rules";
import { loadLabCatalog } from "@/lib/flow-lab/load-catalog";
import type { LabCatalog } from "@/lib/flow-lab/types";
import { NoPermission } from "@/components/settings/cases/no-permission";
import { ExplorerScreen } from "@/components/flow-lab/explorer/explorer-screen";

export const metadata: Metadata = { title: "Explorador de caminos" };

/** Nombres de las personas (la base no los guarda): se leen de Auth con el cliente de servicio. Si falla, el explorador usa "Asesor 1"... */
async function readMemberNames(workspaceId: string): Promise<Record<string, string>> {
  try {
    const service = await createServiceClient();
    const { data: members } = await service.from("workspace_members").select("user_id").eq("workspace_id", workspaceId);
    const entries = await Promise.all(
      (members ?? []).map(async (m) => {
        const {
          data: { user },
        } = await service.auth.admin.getUserById(m.user_id);
        return [m.user_id, displayName(user)] as const;
      }),
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export default async function FlowExplorerPage({ searchParams }: { searchParams: Promise<{ flow?: string | string[] }> }) {
  const { workspace, role, supabase } = await getWorkspace();
  if (!isAdminRole(role)) {
    return <NoPermission title="Explorador de caminos" message="Solo el Dueño o un Administrador pueden usar el explorador de caminos." />;
  }
  const params = await searchParams;
  const flow = Array.isArray(params.flow) ? params.flow[0] : params.flow;

  let catalog: LabCatalog;
  try {
    catalog = await loadLabCatalog(workspace.id, { memberNames: await readMemberNames(workspace.id) });
  } catch (e) {
    return (
      <div className="mx-auto mt-10 max-w-md px-8 text-center">
        <p className="text-sm font-medium">No se pudo cargar el explorador</p>
        <p className="mt-1 text-sm text-muted-foreground">{e instanceof Error ? e.message : "No se pudo leer la configuración del espacio."}</p>
      </div>
    );
  }
  const { data: sequencesData } = await supabase.from("sequences").select("id, name").eq("workspace_id", workspace.id);
  const sequences = (sequencesData ?? []).map((s) => ({ id: s.id, name: s.name }));

  return <ExplorerScreen catalog={catalog} focusFlowId={flow ?? null} sequences={sequences} />;
}
