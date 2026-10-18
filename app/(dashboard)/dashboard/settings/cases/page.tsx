import type { Metadata } from "next";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { getCaseConfig } from "@/lib/actions/case-config";
import { CasesSettingsView } from "@/components/settings/cases/cases-settings-view";
import { summarizeTemplates } from "@/components/settings/cases/template-summary";
import { NoPermission } from "@/components/settings/cases/no-permission";

export const metadata: Metadata = { title: "Gestiones" };

export default async function CasesSettingsPage() {
  const { role } = await getWorkspace();
  if (!isAdminRole(role)) return <NoPermission title="Gestiones" />;

  const config = await getCaseConfig();
  if ("error" in config) return <NoPermission title="Gestiones" message={config.error} />;

  return <CasesSettingsView data={config.data} templates={summarizeTemplates()} />;
}
