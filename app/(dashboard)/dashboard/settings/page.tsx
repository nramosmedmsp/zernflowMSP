import { getWorkspace } from "@/lib/workspace";
import { canManageTeam } from "@/lib/team-rules";
import { canManageSecrets } from "@/lib/permissions";
import { getWorkspaceSecretsStatus } from "@/lib/workspace-secrets";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  const { workspace, role } = await getWorkspace();
  // Solo si las claves están configuradas; los valores nunca salen del servidor.
  const secrets = await getWorkspaceSecretsStatus(workspace.id);

  return (
    <SettingsView
      canManageTeam={canManageTeam(role)}
      canManageSecrets={canManageSecrets(role)}
      workspace={{
        id: workspace.id,
        name: workspace.name,
        hasApiKey: secrets.hasLateApiKey,
        hasAiKey: secrets.hasAiApiKey,
        globalKeywords: (workspace.global_keywords as string[]) ?? [],
      }}
    />
  );
}
