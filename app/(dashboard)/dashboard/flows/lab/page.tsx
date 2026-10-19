import type { Metadata } from "next";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { createServiceClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/team-rules";
import { loadLabCatalog } from "@/lib/flow-lab/load-catalog";
import type { LabCatalog } from "@/lib/flow-lab/types";
import { NoPermission } from "@/components/settings/cases/no-permission";
import { LabScreen } from "@/components/flow-lab/lab/lab-screen";

export const metadata: Metadata = { title: "Laboratorio de conversaciones" };

/** Nombres de las personas (la base no los guarda): se leen de Auth con el cliente de servicio. Si falla, el laboratorio usa "Asesor 1"... */
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

export default async function FlowLabPage({ searchParams }: { searchParams: Promise<{ flow?: string | string[] }> }) {
  const { workspace, role } = await getWorkspace();
  if (!isAdminRole(role)) {
    return <NoPermission title="Laboratorio de conversaciones" message="Solo el Dueño o un Administrador pueden usar el laboratorio." />;
  }
  const params = await searchParams;
  const flow = Array.isArray(params.flow) ? params.flow[0] : params.flow;

  let catalog: LabCatalog;
  try {
    catalog = await loadLabCatalog(workspace.id, { memberNames: await readMemberNames(workspace.id) });
  } catch (e) {
    return (
      <div className="mx-auto mt-10 max-w-md px-8 text-center">
        <p className="text-sm font-medium">No se pudo cargar el laboratorio</p>
        <p className="mt-1 text-sm text-muted-foreground">{e instanceof Error ? e.message : "No se pudo leer la configuración del espacio."}</p>
      </div>
    );
  }
  return <LabScreen catalog={catalog} workspaceId={workspace.id} focusFlowId={flow ?? null} />;
}
