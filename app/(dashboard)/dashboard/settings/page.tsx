import { getWorkspace } from "@/lib/workspace";
import { canManageSecrets, isAdminRole } from "@/lib/permissions";
import { getWorkspaceSecretsStatus } from "@/lib/workspace-secrets";
import { DEFAULT_KEYWORD_ACTION, isKeywordAction, normalizeGlobalKeywords } from "@/lib/flow-engine/global-keywords";
import { createServiceClient } from "@/lib/supabase/server";
import { loadSystemStatus } from "@/lib/system-status";
import { SystemStatusCard } from "./system-status-card";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  const { workspace, role } = await getWorkspace();
  const isAdmin = isAdminRole(role);
  // Solo si las claves están configuradas; los valores nunca salen del servidor.
  // Los miembros no ven la configuración general: ni siquiera se consulta.
  const secrets = isAdmin
    ? await getWorkspaceSecretsStatus(workspace.id)
    : { hasLateApiKey: false, hasAiApiKey: false };

  // Estado del sistema: solo Dueño y Administrador (lee tablas sin acceso para usuarios).
  let systemStatus: Awaited<ReturnType<typeof loadSystemStatus>> | null = null;
  if (isAdmin) {
    try {
      systemStatus = await loadSystemStatus(await createServiceClient(), workspace.id);
    } catch (err) {
      console.error("[settings] estado del sistema:", err);
    }
  }

  return (
    <SettingsView
      statusSlot={systemStatus ? <SystemStatusCard status={systemStatus} /> : null}
      role={role}
      canManageSecrets={canManageSecrets(role)}
      workspace={{
        id: workspace.id,
        name: workspace.name,
        hasApiKey: secrets.hasLateApiKey,
        hasAiKey: secrets.hasAiApiKey,
        globalKeywords: normalizeGlobalKeywords(workspace.global_keywords).map((k) => ({
          keyword: k.keyword,
          action: isKeywordAction(k.action) ? k.action : DEFAULT_KEYWORD_ACTION,
        })),
      }}
    />
  );
}
