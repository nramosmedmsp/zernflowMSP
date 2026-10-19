import type { Metadata } from "next";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { loadLabCatalog } from "@/lib/flow-lab/load-catalog";
import { parseScenarioDefinition } from "@/lib/flow-lab/scenarios/validate";
import { readMemberNames } from "@/lib/flow-lab/scenarios/server";
import type { LabCatalog } from "@/lib/flow-lab/types";
import type { WorkspaceSettings } from "@/lib/types/database";
import { NoPermission } from "@/components/settings/cases/no-permission";
import { LabScreen, type LabReplay } from "@/components/flow-lab/lab/lab-screen";

export const metadata: Metadata = { title: "Laboratorio de conversaciones" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FlowLabPage({ searchParams }: { searchParams: Promise<{ flow?: string | string[]; scenario?: string | string[] }> }) {
  const { workspace, role, supabase } = await getWorkspace();
  if (!isAdminRole(role)) {
    return <NoPermission title="Laboratorio de conversaciones" message="Solo el Dueño o un Administrador pueden usar el laboratorio." />;
  }
  const params = await searchParams;
  const flow = Array.isArray(params.flow) ? params.flow[0] : params.flow;
  const scenarioId = Array.isArray(params.scenario) ? params.scenario[0] : params.scenario;

  // ?scenario=: un escenario guardado que el laboratorio reproduce al abrir.
  let replay: LabReplay | null = null;
  if (scenarioId && UUID_RE.test(scenarioId)) {
    const { data } = await supabase.from("lab_scenarios").select("id, name, definition").eq("id", scenarioId).eq("workspace_id", workspace.id).maybeSingle();
    const parsed = data ? parseScenarioDefinition(data.definition) : null;
    if (data && parsed?.ok) replay = { id: data.id, name: data.name, definition: parsed.value };
  }

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
  const settings = ((workspace as { settings?: unknown }).settings ?? {}) as WorkspaceSettings;
  return <LabScreen catalog={catalog} workspaceId={workspace.id} focusFlowId={flow ?? null} replay={replay} business={settings.business_template ?? null} />;
}
