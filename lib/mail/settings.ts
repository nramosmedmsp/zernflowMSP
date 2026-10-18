import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_NAME } from "@/lib/brand";
import { decryptSecret, encryptSecret } from "@/lib/mail/crypto";
import {
  isRowComplete,
  isMailSecurity,
  mailConfigFromEnv,
  mailStatus,
  type MailSettingsRow,
  type MailStatus,
  type NormalizedMailSettings,
  type ResolvedMailConfig,
} from "@/lib/mail/config";

// Acceso a la tabla app_mail_settings (migración 00018). Solo con el cliente de
// servicio: la tabla tiene RLS sin políticas, así que anon y authenticated no
// la ven. Quien llama debe validar antes que la persona es Dueño o
// Administrador.

const TABLE = "app_mail_settings";
const ROW_ID = 1;

type AnyClient = { from: unknown };

// La tabla no está en lib/types/database.ts (tipos generados): se usa sin tipar.
function untyped(client: AnyClient): SupabaseClient {
  return client as unknown as SupabaseClient;
}

export async function loadMailRow(service: AnyClient): Promise<MailSettingsRow | null> {
  const { data, error } = await untyped(service)
    .from(TABLE)
    .select("*")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) {
    console.error("[mail] loadMailRow", error.message);
    return null;
  }
  return (data as MailSettingsRow | null) ?? null;
}

function envConfig(): ResolvedMailConfig | null {
  return mailConfigFromEnv(process.env, APP_NAME);
}

/** Estado para mostrar (sin secretos). */
export async function getMailStatus(service: AnyClient): Promise<{ row: MailSettingsRow | null; status: MailStatus }> {
  const row = await loadMailRow(service);
  return { row, status: mailStatus(row, !!envConfig()) };
}

/** ¿Hay correo configurado (tabla completa o variables de entorno)? */
export async function isMailConfigured(service: AnyClient): Promise<boolean> {
  const row = await loadMailRow(service);
  return isRowComplete(row) || !!envConfig();
}

/**
 * Configuración lista para enviar: la de la tabla si está completa; si no, la
 * de las variables de entorno; si no hay ninguna, null.
 */
export async function resolveMailConfig(service: AnyClient): Promise<ResolvedMailConfig | null> {
  const row = await loadMailRow(service);
  if (row && isRowComplete(row) && isMailSecurity(row.security)) {
    return {
      source: "db",
      host: row.host!,
      port: row.port!,
      security: row.security,
      username: row.username!,
      // Puede lanzar si cambió la service role key; send.ts lo traduce.
      password: decryptSecret(row.password_encrypted!),
      fromEmail: row.from_email!,
      fromName: row.from_name?.trim() || APP_NAME,
    };
  }
  return envConfig();
}

export async function saveMailRow(
  service: AnyClient,
  value: NormalizedMailSettings,
  updatedBy: string,
): Promise<{ error: string | null }> {
  const update: Record<string, unknown> = {
    id: ROW_ID,
    host: value.host,
    port: value.port,
    security: value.security,
    username: value.username,
    from_email: value.fromEmail,
    from_name: value.fromName || null,
    // Al cambiar la configuración se limpia el error anterior.
    last_error: null,
    last_error_at: null,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };
  if (value.password) update.password_encrypted = encryptSecret(value.password);

  const { error } = await untyped(service).from(TABLE).upsert(update, { onConflict: "id" });
  if (error) {
    console.error("[mail] saveMailRow", error.message);
    return { error: "No se pudo guardar la configuración de correo. ¿Está aplicada la migración 00018?" };
  }
  return { error: null };
}

/** Guarda el resultado del último envío para el indicador de estado. */
export async function recordMailResult(service: AnyClient, error: string | null): Promise<void> {
  const now = new Date().toISOString();
  const patch = error
    ? { id: ROW_ID, last_error: error.slice(0, 500), last_error_at: now }
    : { id: ROW_ID, last_success_at: now };
  const { error: dbError } = await untyped(service).from(TABLE).upsert(patch, { onConflict: "id" });
  if (dbError) console.error("[mail] recordMailResult", dbError.message);
}
