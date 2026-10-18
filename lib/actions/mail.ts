"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { canManageTeam } from "@/lib/team-rules";
import { validateMailSettingsInput, type MailSettingsInput, type MailStatus } from "@/lib/mail/config";
import { getMailStatus, loadMailRow, saveMailRow } from "@/lib/mail/settings";
import { sendAppMail } from "@/lib/mail/send";
import { testEmail } from "@/lib/mail/templates";

// La configuración de correo es de toda la instalación. Solo la cambia quien
// es Dueño o Administrador del espacio actual; se escribe con el cliente de
// servicio porque la tabla no tiene políticas RLS.

const NOT_ALLOWED = "Solo el Dueño o un Administrador pueden configurar el correo.";

async function managerService() {
  const ctx = await getWorkspace();
  if (!canManageTeam(ctx.role)) return { ok: false, error: NOT_ALLOWED } as const;
  return { ok: true, ctx, service: await createServiceClient() } as const;
}

export async function saveMailSettings(
  input: MailSettingsInput,
): Promise<{ error: string } | { ok: true; status: MailStatus; hasPassword: true }> {
  const auth = await managerService();
  if (!auth.ok) return { error: auth.error };
  const { ctx, service } = auth;

  const current = await loadMailRow(service);
  const checked = validateMailSettingsInput(input, !!current?.password_encrypted);
  if (checked.error !== null) return { error: checked.error };

  const { error } = await saveMailRow(service, checked.value, ctx.user.id);
  if (error) return { error };

  const { status } = await getMailStatus(service);
  return { ok: true, status, hasPassword: true };
}

/** Envía un correo de prueba al correo de quien lo pide. */
export async function sendTestMail(): Promise<
  { error: string; status?: MailStatus } | { ok: true; to: string; status: MailStatus }
> {
  const auth = await managerService();
  if (!auth.ok) return { error: auth.error };
  const { ctx, service } = auth;

  const to = ctx.user.email;
  if (!to) return { error: "Tu cuenta no tiene correo para enviarte la prueba." };

  const result = await sendAppMail(service, to, testEmail());
  const { status } = await getMailStatus(service);

  if (result.ok) return { ok: true, to, status };
  if (result.notConfigured) {
    return { error: "Primero guarda la configuración de correo.", status };
  }
  return { error: result.error, status };
}
