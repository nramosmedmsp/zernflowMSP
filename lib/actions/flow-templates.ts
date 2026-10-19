"use server";

// Instala una plantilla de la biblioteca de flujos (lib/flow-templates). Solo
// Dueño o Administrador del espacio actual. El flujo queda como borrador: se
// publica a mano desde el editor, después de revisar los avisos.

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import { getFlowTemplate } from "@/lib/flow-templates";
import { installFlowTemplate } from "@/lib/flow-templates/install";
import type { FlowTemplateNotice } from "@/lib/flow-templates/types";

export type InstallFlowTemplateResult =
  | { ok: true; flowId: string; name: string; warnings: FlowTemplateNotice[]; adjust: string[] }
  | { error: string };

export async function installFlowTemplateAction(templateId: string): Promise<InstallFlowTemplateResult> {
  const { workspace, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  const template = getFlowTemplate(templateId);
  if (!template) return { error: "No se encontró la plantilla. Recarga la página e inténtalo de nuevo." };

  try {
    const installed = await installFlowTemplate(await createServiceClient(), workspace.id, template);
    revalidatePath("/dashboard/flows");
    return {
      ok: true,
      flowId: installed.flowId,
      name: installed.name,
      warnings: installed.notices,
      adjust: installed.adjust,
    };
  } catch (err) {
    console.error("[flow-templates] no se pudo instalar la plantilla:", err);
    return { error: "No se pudo crear el flujo desde la plantilla. Inténtalo de nuevo." };
  }
}
