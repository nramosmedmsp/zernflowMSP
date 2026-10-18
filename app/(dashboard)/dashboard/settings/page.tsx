import { getWorkspace } from "@/lib/workspace";
import { canManageSecrets, isAdminRole } from "@/lib/permissions";
import { getWorkspaceSecretsStatus } from "@/lib/workspace-secrets";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  const { workspace, role } = await getWorkspace();
  const isAdmin = isAdminRole(role);
  // Solo si las claves están configuradas; los valores nunca salen del servidor.
  // Los miembros no ven la configuración general: ni siquiera se consulta.
  const secrets = isAdmin
    ? await getWorkspaceSecretsStatus(workspace.id)
    : { hasLateApiKey: false, hasAiApiKey: false };

  return (
    <SettingsView
      role={role}
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
