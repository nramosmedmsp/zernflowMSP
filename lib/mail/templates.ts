// Plantillas de correo en español. HTML simple con tablas y estilos en línea
// para que se vea bien en Gmail, Outlook y clientes móviles, más una versión
// en texto plano.

import { APP_NAME } from "@/lib/brand";

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(params: {
  appName: string;
  title: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footer: string;
}): string {
  const app = escapeHtml(params.appName);
  const body = params.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#333333;">${p}</p>`,
    )
    .join("");
  const button = params.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;">
<tr><td style="border-radius:8px;background-color:#111111;">
<a href="${escapeHtml(params.button.url)}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(params.button.label)}</a>
</td></tr></table>
<p style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:#666666;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><a href="${escapeHtml(params.button.url)}" style="color:#666666;word-break:break-all;">${escapeHtml(params.button.url)}</a></p>`
    : "";

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(params.title)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
<tr><td style="padding:28px 32px 8px 32px;font-size:13px;font-weight:bold;color:#71717a;text-transform:uppercase;letter-spacing:0.5px;">${app}</td></tr>
<tr><td style="padding:8px 32px 8px 32px;">
<h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.4;color:#111111;">${escapeHtml(params.title)}</h1>
${body}
${button}
</td></tr>
<tr><td style="padding:16px 32px 28px 32px;border-top:1px solid #e4e4e7;font-size:12px;line-height:1.6;color:#71717a;">${params.footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function inviteEmail(params: {
  name: string;
  url: string;
  inviterName?: string | null;
  workspaceName?: string | null;
  appName?: string;
}): MailContent {
  const appName = params.appName ?? APP_NAME;
  const greeting = params.name ? `Hola, ${params.name}:` : "Hola:";
  const who = params.inviterName ? `${params.inviterName} te creó un usuario` : "Te crearon un usuario";
  const where = params.workspaceName ? ` en ${params.workspaceName}` : "";
  const intro = `${who} en ${appName}${where}.`;
  const action =
    "Para activar tu cuenta, abre el enlace y crea tu contraseña. El enlace vence en 24 horas y solo funciona una vez.";
  const ignore = "Si no esperabas este correo, puedes ignorarlo.";

  return {
    subject: `Activa tu cuenta en ${appName}`,
    html: layout({
      appName,
      title: "Activa tu cuenta",
      paragraphs: [escapeHtml(greeting), escapeHtml(intro), escapeHtml(action)],
      button: { label: "Activar mi cuenta", url: params.url },
      footer: escapeHtml(ignore),
    }),
    text: `${greeting}\n\n${intro}\n\n${action}\n\n${params.url}\n\n${ignore}\n`,
  };
}

export function resetPasswordEmail(params: {
  name?: string | null;
  url: string;
  appName?: string;
}): MailContent {
  const appName = params.appName ?? APP_NAME;
  const greeting = params.name ? `Hola, ${params.name}:` : "Hola:";
  const intro = `Recibimos un pedido para restablecer tu contraseña de ${appName}.`;
  const action = "Abre el enlace para crear una contraseña nueva. Vence en 24 horas y solo funciona una vez.";
  const ignore = "Si no lo pediste, ignora este correo: tu contraseña actual sigue funcionando.";

  return {
    subject: `Restablece tu contraseña de ${appName}`,
    html: layout({
      appName,
      title: "Restablece tu contraseña",
      paragraphs: [escapeHtml(greeting), escapeHtml(intro), escapeHtml(action)],
      button: { label: "Crear contraseña nueva", url: params.url },
      footer: escapeHtml(ignore),
    }),
    text: `${greeting}\n\n${intro}\n\n${action}\n\n${params.url}\n\n${ignore}\n`,
  };
}

export function testEmail(params: { appName?: string } = {}): MailContent {
  const appName = params.appName ?? APP_NAME;
  const intro = `Este es un correo de prueba de ${appName}.`;
  const detail = "Si lo recibiste, la configuración de correo funciona y ya se pueden enviar invitaciones.";

  return {
    subject: `Correo de prueba de ${appName}`,
    html: layout({
      appName,
      title: "Correo de prueba",
      paragraphs: [escapeHtml(intro), escapeHtml(detail)],
      footer: escapeHtml("Lo enviaste desde Configuración → Correo."),
    }),
    text: `${intro}\n\n${detail}\n`,
  };
}
