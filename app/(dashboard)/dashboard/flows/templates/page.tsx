import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { FLOW_TEMPLATES, defaultBusinessFilter, summarizeTemplate } from "@/lib/flow-templates";
import { TemplatesView } from "./templates-view";

export default async function TemplatesPage() {
  const { workspace, role } = await getWorkspace();
  const settings = (workspace.settings ?? {}) as { business_template?: string };

  return (
    <TemplatesView
      templates={FLOW_TEMPLATES.map(summarizeTemplate)}
      defaultBusiness={defaultBusinessFilter(settings.business_template)}
      canInstall={isAdminRole(role)}
    />
  );
}
