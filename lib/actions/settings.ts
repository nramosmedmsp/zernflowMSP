"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import {
  ADMIN_ONLY_MESSAGE,
  OWNER_ONLY_SECRETS_MESSAGE,
  canManageSecrets,
  isAdminRole,
} from "@/lib/permissions";
import {
  getWorkspaceSecretsStatus,
  saveWorkspaceSecrets,
  type WorkspaceSecretsPatch,
} from "@/lib/workspace-secrets";

// Configuración general del espacio. El nombre y las palabras clave se guardan
// con el cliente del usuario (RLS: solo administradores actualizan
// workspaces); las claves, con el cliente de servicio en workspace_secrets y
// solo si quien guarda es el Dueño.

const WORKSPACE_CHANGED = "El espacio de trabajo cambió. Recarga la página e inténtalo de nuevo.";
const MAX_NAME_LENGTH = 100;
const MAX_KEYWORDS = 200;

export interface SaveWorkspaceSettingsInput {
  workspaceId: string;
  name: string;
  globalKeywords: string[];
  /** Solo si se escribió una clave nueva; vacío o ausente = no cambiar. */
  lateApiKey?: string;
  aiApiKey?: string;
}

export async function saveWorkspaceSettings(
  input: SaveWorkspaceSettingsInput,
): Promise<{ error: string } | { ok: true; hasApiKey: boolean; hasAiKey: boolean }> {
  const { workspace, role, supabase } = await getWorkspace();
  if (workspace.id !== input.workspaceId) return { error: WORKSPACE_CHANGED };
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { error: "Escribe un nombre para el espacio de trabajo." };
  if (name.length > MAX_NAME_LENGTH) {
    return { error: `El nombre no puede tener más de ${MAX_NAME_LENGTH} caracteres.` };
  }

  const keywords = Array.isArray(input.globalKeywords)
    ? [
        ...new Set(
          input.globalKeywords
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim().toLowerCase())
            .filter(Boolean),
        ),
      ]
    : [];
  if (keywords.length > MAX_KEYWORDS) {
    return { error: `Puedes tener hasta ${MAX_KEYWORDS} palabras clave globales.` };
  }

  const secrets: WorkspaceSecretsPatch = {};
  const lateApiKey = typeof input.lateApiKey === "string" ? input.lateApiKey.trim() : "";
  const aiApiKey = typeof input.aiApiKey === "string" ? input.aiApiKey.trim() : "";
  if (lateApiKey) secrets.lateApiKey = lateApiKey;
  if (aiApiKey) secrets.aiApiKey = aiApiKey;
  const changesSecrets = Object.keys(secrets).length > 0;
  if (changesSecrets && !canManageSecrets(role)) return { error: OWNER_ONLY_SECRETS_MESSAGE };

  const { error: updateError } = await supabase
    .from("workspaces")
    .update({ name, global_keywords: keywords })
    .eq("id", workspace.id)
    .select("id")
    .single();

  if (updateError) {
    console.error("[saveWorkspaceSettings]", updateError.message);
    return { error: "No se pudo guardar la configuración. Inténtalo de nuevo." };
  }

  if (changesSecrets) {
    const { error } = await saveWorkspaceSecrets(workspace.id, secrets);
    if (error) return { error };
  }

  const status = await getWorkspaceSecretsStatus(workspace.id);
  revalidatePath("/dashboard/settings");
  return { ok: true, hasApiKey: status.hasLateApiKey, hasAiKey: status.hasAiApiKey };
}
