"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { mergeWorkspaceSettings } from "@/lib/workspace-settings";
import {
  ADMIN_ONLY_MESSAGE,
  OWNER_ONLY_SECRETS_MESSAGE,
  canManageSecrets,
  isAdminRole,
} from "@/lib/permissions";
import {
  mergeAttentionSettings,
  parseAttentionInput,
  type AttentionSettings,
} from "@/app/(dashboard)/dashboard/settings/attention/attention-rules";
import {
  mergeAutomationSettings,
  parseAutomationInput,
  type AutomationForm,
} from "@/app/(dashboard)/dashboard/settings/attention/automation-rules";
import type { Json } from "@/lib/types/database";
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

/**
 * Atención (docs/PLAN-CRM.md 4.3 y 5.2): visibilidad del asesor, modo de
 * reparto sin equipos y si un asesor puede devolver una gestión a la cola.
 * Lee los settings actuales y solo cambia esas tres claves, para no pisar
 * business_template, key_date_label ni otras que se agreguen.
 */
export async function saveAttentionSettings(
  workspaceId: string,
  input: AttentionSettings,
): Promise<{ error: string } | { ok: true }> {
  const { workspace, role, supabase } = await getWorkspace();
  if (workspace.id !== workspaceId) return { error: WORKSPACE_CHANGED };
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  const parsed = parseAttentionInput(input);
  if ("error" in parsed) return parsed;

  const { data: current, error: readError } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", workspace.id)
    .single();
  if (readError || !current) {
    console.error("[saveAttentionSettings] leer", readError?.message);
    return { error: "No se pudo guardar la configuración. Inténtalo de nuevo." };
  }

  const settings = mergeAttentionSettings(current.settings, parsed.value) as Json;
  const updateError = await mergeWorkspaceSettings(supabase, workspace.id, current.settings, settings);
  if (updateError) {
    console.error("[saveAttentionSettings]", updateError);
    return { error: "No se pudo guardar la configuración. Inténtalo de nuevo." };
  }

  revalidatePath("/dashboard/settings/attention");
  return { ok: true };
}

/**
 * Atención automática (docs/FASE-2-TECNICO.md 3 y 8): respuesta fuera de
 * horario y reasignación por espera. Lee los settings actuales y solo cambia
 * `off_hours_reply` y `reassign_after_minutes`, para no pisar el resto.
 */
export async function saveAttentionAutomation(
  workspaceId: string,
  input: AutomationForm,
): Promise<{ error: string } | { ok: true }> {
  const { workspace, role, supabase } = await getWorkspace();
  if (workspace.id !== workspaceId) return { error: WORKSPACE_CHANGED };
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  const parsed = parseAutomationInput(input);
  if ("error" in parsed) return parsed;

  const { data: current, error: readError } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", workspace.id)
    .single();
  if (readError || !current) {
    console.error("[saveAttentionAutomation] leer", readError?.message);
    return { error: "No se pudo guardar la configuración. Inténtalo de nuevo." };
  }

  const settings = mergeAutomationSettings(current.settings, parsed.value) as Json;
  const updateError = await mergeWorkspaceSettings(supabase, workspace.id, current.settings, settings);
  if (updateError) {
    console.error("[saveAttentionAutomation]", updateError);
    return { error: "No se pudo guardar la configuración. Inténtalo de nuevo." };
  }

  revalidatePath("/dashboard/settings/attention");
  return { ok: true };
}
