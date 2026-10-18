// Reglas puras de la configuración de correo (SMTP propio de la app), sin
// dependencias de servidor, para probarlas con vitest y usarlas en la vista.

export type MailSecurity = "starttls" | "ssl";

export const MAIL_SECURITY_OPTIONS: { value: MailSecurity; label: string; port: number }[] = [
  { value: "starttls", label: "STARTTLS (puerto 587)", port: 587 },
  { value: "ssl", label: "SSL/TLS (puerto 465)", port: 465 },
];

/** Valores de ejemplo de ZeptoMail; solo se muestran como ayuda, no se guardan. */
export const ZEPTOMAIL_EXAMPLE = {
  host: "smtp.zeptomail.com",
  port: 587,
  security: "starttls" as MailSecurity,
  username: "emailapikey",
};

/** Fila de la tabla app_mail_settings (migración 00018). */
export interface MailSettingsRow {
  id: number;
  host: string | null;
  port: number | null;
  security: string | null;
  username: string | null;
  password_encrypted: string | null;
  from_email: string | null;
  from_name: string | null;
  last_error: string | null;
  last_error_at: string | null;
  last_success_at: string | null;
  updated_at: string | null;
}

/** Configuración lista para enviar (con la contraseña ya descifrada). */
export interface ResolvedMailConfig {
  source: "db" | "env";
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

export interface MailSettingsInput {
  host: string;
  port: string | number;
  security: string;
  username: string;
  /** Vacío = conservar la contraseña guardada. */
  password: string;
  fromEmail: string;
  fromName: string;
}

export interface NormalizedMailSettings {
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  password: string | null;
  fromEmail: string;
  fromName: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

export function isMailSecurity(value: unknown): value is MailSecurity {
  return value === "starttls" || value === "ssl";
}

/** Puerto típico de cada modo de seguridad. */
export function defaultPortFor(security: MailSecurity): number {
  return security === "ssl" ? 465 : 587;
}

/**
 * Valida y limpia lo que llega del formulario. `hasStoredPassword` indica si ya
 * hay una contraseña guardada (entonces dejarla vacía la conserva).
 */
export function validateMailSettingsInput(
  input: MailSettingsInput,
  hasStoredPassword: boolean,
): { value: NormalizedMailSettings; error: null } | { value: null; error: string } {
  const host = String(input.host ?? "").trim().toLowerCase();
  if (!host || host.length > 253 || !HOST_RE.test(host)) {
    return { value: null, error: "Escribe un servidor SMTP válido, por ejemplo smtp.zeptomail.com." };
  }

  const port = Number(String(input.port ?? "").trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { value: null, error: "El puerto debe ser un número entre 1 y 65535." };
  }

  if (!isMailSecurity(input.security)) {
    return { value: null, error: "Elige la seguridad de la conexión: STARTTLS o SSL." };
  }

  const username = String(input.username ?? "").trim();
  if (!username || username.length > 320) {
    return { value: null, error: "Escribe el usuario del SMTP." };
  }

  const rawPassword = String(input.password ?? "");
  const password = rawPassword.trim() ? rawPassword.trim() : null;
  if (!password && !hasStoredPassword) {
    return { value: null, error: "Escribe la contraseña o el token del SMTP." };
  }
  if (password && password.length > 1024) {
    return { value: null, error: "La contraseña o token es demasiado larga." };
  }

  const fromEmail = String(input.fromEmail ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(fromEmail) || fromEmail.length > 254) {
    return { value: null, error: "Escribe un correo remitente válido." };
  }

  const fromName = String(input.fromName ?? "").trim().replace(/\s+/g, " ");
  if (fromName.length > 100) {
    return { value: null, error: "El nombre del remitente no puede tener más de 100 caracteres." };
  }
  if (/[<>"\r\n]/.test(fromName)) {
    return { value: null, error: "El nombre del remitente no puede tener los caracteres < > o comillas." };
  }

  return {
    value: { host, port, security: input.security, username, password, fromEmail, fromName },
    error: null,
  };
}

/** ¿La fila guardada tiene todo lo necesario para enviar? */
export function isRowComplete(row: MailSettingsRow | null | undefined): boolean {
  return !!(
    row &&
    row.host &&
    row.port &&
    isMailSecurity(row.security) &&
    row.username &&
    row.password_encrypted &&
    row.from_email
  );
}

/** Separa "Nombre <correo@x.com>" o "correo@x.com". */
export function parseFromAddress(raw: string | null | undefined): { name: string; email: string } | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const name = match ? match[1].trim() : "";
  const email = (match ? match[2] : value).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return null;
  return { name, email };
}

/**
 * Respaldo por variables de entorno (SMTP_HOST, SMTP_PORT, SMTP_USER,
 * SMTP_PASS, MAIL_FROM) para cuando la tabla está vacía. Puerto 465 = SSL.
 */
export function mailConfigFromEnv(
  env: Record<string, string | undefined>,
  defaultFromName: string,
): ResolvedMailConfig | null {
  const host = env.SMTP_HOST?.trim();
  const username = env.SMTP_USER?.trim();
  const password = env.SMTP_PASS?.trim();
  const from = parseFromAddress(env.MAIL_FROM);
  if (!host || !username || !password || !from) return null;
  const port = Number(env.SMTP_PORT?.trim() || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    source: "env",
    host,
    port,
    security: port === 465 ? "ssl" : "starttls",
    username,
    password,
    fromEmail: from.email,
    fromName: from.name || defaultFromName,
  };
}

export type MailState = "unconfigured" | "configured" | "error";

export interface MailStatus {
  state: MailState;
  source: "db" | "env" | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
}

/** Estado que se muestra en Configuración → Correo. */
export function mailStatus(row: MailSettingsRow | null | undefined, envConfigured: boolean): MailStatus {
  const source: MailStatus["source"] = isRowComplete(row) ? "db" : envConfigured ? "env" : null;
  const lastErrorAt = row?.last_error_at ?? null;
  const lastSuccessAt = row?.last_success_at ?? null;
  const errorIsLatest =
    !!row?.last_error &&
    !!lastErrorAt &&
    (!lastSuccessAt || new Date(lastErrorAt).getTime() > new Date(lastSuccessAt).getTime());

  let state: MailState = "unconfigured";
  if (source) state = errorIsLatest ? "error" : "configured";

  return {
    state,
    source,
    lastError: errorIsLatest ? row!.last_error : null,
    lastErrorAt: errorIsLatest ? lastErrorAt : null,
    lastSuccessAt,
  };
}

export const MAIL_STATE_LABELS: Record<MailState, string> = {
  unconfigured: "Sin configurar",
  configured: "Configurado",
  error: "Último envío con error",
};

/** Traduce los errores de nodemailer / del servidor SMTP. */
export function translateSmtpError(err: unknown): string {
  const e = (err ?? {}) as { code?: string; responseCode?: number; message?: string };
  const code = e.code ?? "";
  const text = (e.message ?? String(err ?? "")).toLowerCase();

  if (code === "EAUTH" || e.responseCode === 535 || text.includes("authentication")) {
    return "El servidor rechazó el usuario o la contraseña del SMTP.";
  }
  if (code === "ENOTFOUND" || code === "EDNS" || text.includes("getaddrinfo")) {
    return "No se encontró el servidor SMTP. Revisa el nombre del servidor.";
  }
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ECONNREFUSED" || text.includes("timeout")) {
    return "No se pudo conectar con el servidor SMTP. Revisa el servidor, el puerto y la seguridad.";
  }
  if (code === "ETLS" || text.includes("ssl") || text.includes("tls") || text.includes("wrong version number")) {
    return "Falló la conexión segura. Usa STARTTLS con el puerto 587 o SSL con el 465.";
  }
  if (code === "EENVELOPE" || (e.responseCode && e.responseCode >= 550 && e.responseCode < 560)) {
    return "El servidor rechazó el remitente o el destinatario. Revisa que el correo remitente sea de un dominio verificado.";
  }
  if (text === "mail_secret_format" || text.includes("unsupported state") || text.includes("unable to authenticate data")) {
    return "No se pudo leer la contraseña guardada (¿cambió la service role key?). Vuelve a escribirla y guarda.";
  }
  return "No se pudo enviar el correo. Revisa la configuración y vuelve a intentarlo.";
}
