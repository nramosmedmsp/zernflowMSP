import nodemailer from "nodemailer";
import { translateSmtpError, type ResolvedMailConfig } from "@/lib/mail/config";
import { recordMailResult, resolveMailConfig } from "@/lib/mail/settings";
import type { MailContent } from "@/lib/mail/templates";

export type SendMailResult =
  | { ok: true }
  | { ok: false; notConfigured: true; error: null }
  | { ok: false; notConfigured: false; error: string };

function createTransport(config: ResolvedMailConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === "ssl",
    requireTLS: config.security === "starttls",
    auth: { user: config.username, pass: config.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/**
 * Envía un correo con el SMTP de la app. Devuelve `notConfigured` si no hay
 * configuración, o el error ya traducido. Registra el resultado para el
 * indicador de estado de Configuración → Correo.
 */
export async function sendAppMail(
  service: { from: unknown },
  to: string,
  content: MailContent,
): Promise<SendMailResult> {
  let config: ResolvedMailConfig | null;
  try {
    config = await resolveMailConfig(service);
  } catch (err) {
    const error = translateSmtpError(err);
    await recordMailResult(service, error);
    return { ok: false, notConfigured: false, error };
  }
  if (!config) return { ok: false, notConfigured: true, error: null };

  try {
    await createTransport(config).sendMail({
      from: { name: config.fromName, address: config.fromEmail },
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    await recordMailResult(service, null);
    return { ok: true };
  } catch (err) {
    const e = err as { code?: string; responseCode?: number; message?: string };
    console.error("[mail] sendAppMail", e.code, e.responseCode, e.message);
    const error = translateSmtpError(err);
    await recordMailResult(service, error);
    return { ok: false, notConfigured: false, error };
  }
}
