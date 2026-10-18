// Secretos del espacio de trabajo (docs/FASE-1-TECNICO.md 2.4).
//
// Desde la migración 00019 la clave de Zernio, la de IA y el secreto del
// webhook viven en `workspace_secrets`, que no tiene políticas RLS ni
// privilegios para anon/authenticated: solo se lee y escribe con el cliente de
// servicio, siempre en el servidor y después de validar permisos en código.
// Nunca envíes estos valores al navegador; para la UI usa
// `getWorkspaceSecretsStatus` (solo dice si están configurados).
//
// Todas las funciones aceptan opcionalmente un cliente ya creado; tiene que
// ser el de servicio (el del usuario recibe "permission denied").

import type { SupabaseClient } from "@supabase/supabase-js";

export interface WorkspaceSecrets {
  /** Clave de API de Zernio (antes workspaces.late_api_key_encrypted). */
  lateApiKey: string | null;
  /** Clave de AI Gateway (antes workspaces.ai_api_key). */
  aiApiKey: string | null;
  /** Secreto HMAC del webhook de Zernio (antes workspaces.webhook_secret). */
  webhookSecret: string | null;
}

/** Campos a guardar: `undefined` no se toca, `null` o "" lo borra. */
export type WorkspaceSecretsPatch = Partial<Record<keyof WorkspaceSecrets, string | null>>;

export interface WorkspaceSecretsStatus {
  hasLateApiKey: boolean;
  hasAiApiKey: boolean;
  hasWebhookSecret: boolean;
}

const EMPTY: WorkspaceSecrets = { lateApiKey: null, aiApiKey: null, webhookSecret: null };

const COLUMN: Record<keyof WorkspaceSecrets, "late_api_key" | "ai_api_key" | "webhook_secret"> = {
  lateApiKey: "late_api_key",
  aiApiKey: "ai_api_key",
  webhookSecret: "webhook_secret",
};

export const MIGRATION_MISSING_MESSAGE =
  "Falta aplicar la migración 00019 en la base de datos para guardar las claves.";

type AnyClient = { from: unknown };

interface DbError {
  code?: string;
  message?: string;
}

export class WorkspaceSecretsError extends Error {}

async function resolveClient(client?: AnyClient): Promise<SupabaseClient> {
  if (client) return client as unknown as SupabaseClient;
  // Import diferido: así este módulo se puede probar con un cliente falso sin
  // cargar next/headers.
  const { createServiceClient } = await import("@/lib/supabase/server");
  return (await createServiceClient()) as unknown as SupabaseClient;
}

/** La tabla todavía no existe (código desplegado antes de aplicar 00019). */
function isMissingTable(error: DbError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const text = (error.message ?? "").toLowerCase();
  return text.includes("workspace_secrets") && (text.includes("does not exist") || text.includes("could not find"));
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Lee los secretos del espacio con el cliente de servicio. Lanza
 * WorkspaceSecretsError si la base responde con un error inesperado (mejor
 * fallar que, por ejemplo, aceptar un webhook sin verificar la firma).
 */
export async function getWorkspaceSecrets(
  workspaceId: string,
  client?: AnyClient,
): Promise<WorkspaceSecrets> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("workspace_secrets")
    .select("late_api_key, ai_api_key, webhook_secret")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return getLegacySecrets(supabase, workspaceId);
    throw new WorkspaceSecretsError(`No se pudieron leer los secretos del espacio: ${error.message}`);
  }

  if (!data) return { ...EMPTY };
  const row = data as Record<string, unknown>;
  return {
    lateApiKey: clean(row.late_api_key),
    aiApiKey: clean(row.ai_api_key),
    webhookSecret: clean(row.webhook_secret),
  };
}

/** Mientras 00019 no esté aplicada, los secretos siguen en `workspaces`. */
async function getLegacySecrets(supabase: SupabaseClient, workspaceId: string): Promise<WorkspaceSecrets> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("late_api_key_encrypted, ai_api_key, webhook_secret")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new WorkspaceSecretsError(`No se pudieron leer los secretos del espacio: ${error.message}`);
  }
  if (!data) return { ...EMPTY };
  const row = data as Record<string, unknown>;
  return {
    lateApiKey: clean(row.late_api_key_encrypted),
    aiApiKey: clean(row.ai_api_key),
    webhookSecret: clean(row.webhook_secret),
  };
}

/**
 * Guarda solo los campos presentes en `patch` (upsert por workspace_id: crea
 * la fila si no existe). Valida permisos ANTES de llamarla.
 */
export async function saveWorkspaceSecrets(
  workspaceId: string,
  patch: WorkspaceSecretsPatch,
  client?: AnyClient,
): Promise<{ error: string | null }> {
  const row: Record<string, string | null> = { workspace_id: workspaceId };
  let changes = 0;
  for (const key of Object.keys(COLUMN) as Array<keyof WorkspaceSecrets>) {
    if (patch[key] === undefined) continue;
    row[COLUMN[key]] = clean(patch[key]);
    changes++;
  }
  if (changes === 0) return { error: null };

  const supabase = await resolveClient(client);
  const { error } = await supabase
    .from("workspace_secrets")
    .upsert(row, { onConflict: "workspace_id" });

  if (error) {
    if (isMissingTable(error)) return { error: MIGRATION_MISSING_MESSAGE };
    console.error("[workspace-secrets] save failed:", error.message);
    return { error: "No se pudieron guardar las claves. Inténtalo de nuevo." };
  }
  return { error: null };
}

/**
 * Clave de Zernio del espacio o null si no está configurada o no se pudo leer
 * (registra el error). Para los procesos de fondo que antes hacían
 * `select late_api_key_encrypted` y seguían de largo si faltaba.
 */
export async function getLateApiKey(workspaceId: string, client?: AnyClient): Promise<string | null> {
  try {
    return (await getWorkspaceSecrets(workspaceId, client)).lateApiKey;
  } catch (err) {
    console.error("[workspace-secrets]", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Solo si cada secreto está configurado, para mostrar "Configurada" en la UI. */
export async function getWorkspaceSecretsStatus(
  workspaceId: string,
  client?: AnyClient,
): Promise<WorkspaceSecretsStatus> {
  try {
    const secrets = await getWorkspaceSecrets(workspaceId, client);
    return {
      hasLateApiKey: !!secrets.lateApiKey,
      hasAiApiKey: !!secrets.aiApiKey,
      hasWebhookSecret: !!secrets.webhookSecret,
    };
  } catch (err) {
    console.error("[workspace-secrets]", err instanceof Error ? err.message : err);
    return { hasLateApiKey: false, hasAiApiKey: false, hasWebhookSecret: false };
  }
}
