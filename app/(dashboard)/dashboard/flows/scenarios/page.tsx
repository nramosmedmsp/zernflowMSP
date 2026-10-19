import type { Metadata } from "next";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { listLabScenarios } from "@/lib/actions/lab-scenarios";
import { loadLabCatalog } from "@/lib/flow-lab/load-catalog";
import { exampleScenariosFor } from "@/lib/flow-lab/scenarios/examples";
import { readMemberNames } from "@/lib/flow-lab/scenarios/server";
import type { LabCatalog } from "@/lib/flow-lab/types";
import type { WorkspaceSettings } from "@/lib/types/database";
import { NoPermission } from "@/components/settings/cases/no-permission";
import { ScenariosScreen } from "@/components/flow-lab/scenarios/scenarios-screen";

export const metadata: Metadata = { title: "Escenarios del laboratorio" };

function Problem({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto mt-10 max-w-md px-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export default async function ScenariosPage() {
  const { workspace, role } = await getWorkspace();
  if (!isAdminRole(role)) {
    return <NoPermission title="Escenarios del laboratorio" message="Solo el Dueño o un Administrador pueden usar los escenarios." />;
  }

  let catalog: LabCatalog;
  try {
    catalog = await loadLabCatalog(workspace.id, { memberNames: await readMemberNames(workspace.id) });
  } catch (e) {
    return <Problem title="No se pudieron cargar los escenarios" message={e instanceof Error ? e.message : "No se pudo leer la configuración del espacio."} />;
  }

  const listed = await listLabScenarios();
  if ("error" in listed) {
    return (
      <Problem
        title="No se pudieron cargar los escenarios"
        message={`${listed.error} Si acabas de actualizar el sistema, revisa que la migración 00023 (tabla lab_scenarios) esté aplicada en esta base.`}
      />
    );
  }

  const settings = ((workspace as { settings?: unknown }).settings ?? {}) as WorkspaceSettings;
  return <ScenariosScreen catalog={catalog} initialScenarios={listed.scenarios} hasExamples={exampleScenariosFor(settings.business_template).length > 0} />;
}
