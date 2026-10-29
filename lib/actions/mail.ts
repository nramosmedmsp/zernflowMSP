"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { OWNER_ONLY_MAIL_MESSAGE, canManageMailSettings } from "@/lib/team-rules";
import { logActivity, notify, type Db } from "@/lib/cases/io";
import { validateMailSettingsInput, type MailSettingsInput, type MailStatus } from "@/lib/mail/config";
import { getMailStatus, loadMailRow, saveMailRow } from "@/lib/mail/settings";
import { sendAppMail } from "@/lib/mail/send";
import { testEmail } from "@/lib/mail/templates";

// La configuración de correo es de toda la instalación y por ella salen los
// enlaces de acceso de todo el equipo. Solo la ve y la cambia el Dueño; se
// escribe con el cliente de servicio porque la tabla no tiene políticas RLS.
// Cada cambio queda en `activity` (config_changed) y avisa a los Dueños con el
// servidor y remitente anteriores. Nunca se registran contraseñas.

const NOT_ALLOWED = OWNER_ONLY_MAIL_MESSAGE;

async function managerService() {
  const ctx = await getWorkspace();
  if (!canManageMailSettings(ctx.role)) return { ok: false, error: NOT_ALLOWED } as const;
  return { ok: true, ctx, service: await createServiceClient() } as const;
}

interface MailSnapshot {
  host: string | null;
  port: number | null;
  username: string | null;
  fromEmail: string | null;
}

/** Deja rastro y avisa a los Dueños. Nunca incluye contraseñas. */
async function recordMailChange(
  db: Db,
  p: {
    workspaceId: string;
    actorId: string;
    actorEmail: string | null;
    previous: MailSnapshot;
    next: MailSnapshot;
    passwordChanged: boolean;
  },
): Promise<void> {
  try {
    await logActivity(db, {
      workspace_id: p.workspaceId,
      type: "config_changed",
      actor_id: p.actorId,
      from_value: p.previous.host,
      to_value: p.next.host,
      meta: {
        action: "mail_settings_changed",
        entity: "mail",
        previous_host: p.previous.host,
        previous_port: p.previous.port,
        previous_username: p.previous.username,
        previous_from_email: p.previous.fromEmail,
        new_host: p.next.host,
        new_port: p.next.port,
        new_username: p.next.username,
        new_from_email: p.next.fromEmail,
        password_changed: p.passwordChanged,
      },
    });

    const { data: owners } = await db
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", p.workspaceId)
      .eq("role", "owner");
    const before = `${p.previous.host ?? "sin servidor"} (remitente ${p.previous.fromEmail ?? "sin definir"})`;
    const after = `${p.next.host ?? "sin servidor"} (remitente ${p.next.fromEmail ?? "sin definir"})`;
    await notify(
      db,
      (owners ?? []).map((o) => ({
        workspace_id: p.workspaceId,
        user_id: o.user_id,
        type: "mail_settings_changed" as const,
        title: "Se cambió la configuración de correo",
        body: `Antes: ${before}. Ahora: ${after}.${p.actorEmail ? ` Lo hizo ${p.actorEmail}.` : ""}`,
        link: "/dashboard/settings/correo",
      })),
    );
  } catch (error) {
    console.error("[mail] no se pudo registrar el cambio", error instanceof Error ? error.message : error);
  }
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

  await recordMailChange(service as unknown as Db, {
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    previous: {
      host: current?.host ?? null,
      port: current?.port ?? null,
      username: current?.username ?? null,
      fromEmail: current?.from_email ?? null,
    },
    next: {
      host: checked.value.host,
      port: checked.value.port,
      username: checked.value.username,
      fromEmail: checked.value.fromEmail,
    },
    passwordChanged: checked.value.password !== null,
  });

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
