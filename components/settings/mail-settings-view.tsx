"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Mail, Save, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { saveMailSettings, sendTestMail } from "@/lib/actions/mail";
import {
  MAIL_SECURITY_OPTIONS,
  MAIL_STATE_LABELS,
  ZEPTOMAIL_EXAMPLE,
  defaultPortFor,
  isMailSecurity,
  type MailSecurity,
  type MailStatus,
} from "@/lib/mail/config";

interface MailFormValues {
  host: string;
  port: string;
  security: MailSecurity;
  username: string;
  hasPassword: boolean;
  fromEmail: string;
  fromName: string;
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

const stateStyles: Record<MailStatus["state"], string> = {
  unconfigured: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200",
  configured: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  error: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export function MailSettingsView({
  initial,
  initialStatus,
  userEmail,
}: {
  initial: MailFormValues;
  initialStatus: MailStatus;
  userEmail: string;
}) {
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port);
  const [security, setSecurity] = useState<MailSecurity>(initial.security);
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(initial.hasPassword);
  const [fromEmail, setFromEmail] = useState(initial.fromEmail);
  const [fromName, setFromName] = useState(initial.fromName);
  const [status, setStatus] = useState(initialStatus);

  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function changeSecurity(value: string) {
    if (!isMailSecurity(value)) return;
    // Si el puerto era el típico del otro modo (o estaba vacío), se ajusta solo.
    const previousDefault = String(defaultPortFor(security));
    if (!port || port === previousDefault) setPort(String(defaultPortFor(value)));
    setSecurity(value);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage(null);

    let result: Awaited<ReturnType<typeof saveMailSettings>>;
    try {
      result = await saveMailSettings({
        host,
        port,
        security,
        username,
        password,
        fromEmail,
        fromName,
      });
    } catch {
      result = { error: "No se pudo guardar la configuración. Inténtalo de nuevo." };
    }

    if ("error" in result) {
      setMessage({ kind: "error", text: result.error });
      toast.error(result.error);
    } else {
      toast.success("Configuración de correo guardada");
      setPassword("");
      setHasPassword(true);
      setStatus(result.status);
      setMessage({ kind: "ok", text: "Configuración guardada. Envía un correo de prueba para comprobarla." });
    }
    setSaving(false);
  }

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    setMessage(null);

    let result: Awaited<ReturnType<typeof sendTestMail>>;
    try {
      result = await sendTestMail();
    } catch {
      result = { error: "No se pudo enviar el correo de prueba. Inténtalo de nuevo." } as typeof result;
    }
    if (result.status) setStatus(result.status);
    if ("error" in result) {
      setMessage({ kind: "error", text: result.error });
      toast.error(result.error);
    } else {
      toast.success(`Correo de prueba enviado a ${result.to}`);
      setMessage({ kind: "ok", text: `Te enviamos un correo de prueba a ${result.to}.` });
    }
    setTesting(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Volver a Configuración"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Correo</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Servidor SMTP con el que la app envía invitaciones y enlaces para restablecer contraseñas.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-6 px-8 py-8">
          {/* Estado */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Estado</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  stateStyles[status.state],
                )}
              >
                {MAIL_STATE_LABELS[status.state]}
              </span>
              {status.source === "env" && (
                <span className="text-xs text-muted-foreground">
                  (con las variables de entorno SMTP_*)
                </span>
              )}
            </div>
            {status.state === "unconfigured" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Mientras no lo configures, las invitaciones y los enlaces para restablecer contraseñas
                no se envían: en Equipo puedes copiar el enlace y compartirlo por un canal privado.
              </p>
            )}
            {status.lastError && (
              <p className="mt-2 text-xs text-destructive">
                {status.lastError}
                {status.lastErrorAt && ` (${formatDateTime(status.lastErrorAt)})`}
              </p>
            )}
            {status.state === "configured" && status.lastSuccessAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                Último envío correcto: {formatDateTime(status.lastSuccessAt)}
              </p>
            )}
          </section>

          {/* Formulario */}
          <form onSubmit={handleSave} noValidate className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <div>
                <label htmlFor="mail-host" className="mb-1.5 block text-sm font-medium">
                  Servidor SMTP
                </label>
                <input
                  id="mail-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  required
                  autoComplete="off"
                  placeholder={ZEPTOMAIL_EXAMPLE.host}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="mail-port" className="mb-1.5 block text-sm font-medium">
                  Puerto
                </label>
                <input
                  id="mail-port"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
                  required
                  placeholder={String(defaultPortFor(security))}
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label htmlFor="mail-security" className="mb-1.5 block text-sm font-medium">
                Seguridad
              </label>
              <select
                id="mail-security"
                value={security}
                onChange={(e) => changeSecurity(e.target.value)}
                className={inputClass}
              >
                {MAIL_SECURITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="mail-user" className="mb-1.5 block text-sm font-medium">
                  Usuario
                </label>
                <input
                  id="mail-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="off"
                  placeholder={ZEPTOMAIL_EXAMPLE.username}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="mail-pass" className="mb-1.5 block text-sm font-medium">
                  Contraseña o token
                </label>
                <input
                  id="mail-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={!hasPassword}
                  autoComplete="new-password"
                  placeholder={hasPassword ? "•••••••••• (guardada)" : "Token SMTP"}
                  className={inputClass}
                />
                {hasPassword && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Déjalo vacío para conservar la que ya está guardada.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="mail-from" className="mb-1.5 block text-sm font-medium">
                  Correo remitente
                </label>
                <input
                  id="mail-from"
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  required
                  placeholder="no-responder@tudominio.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="mail-from-name" className="mb-1.5 block text-sm font-medium">
                  Nombre del remitente
                </label>
                <input
                  id="mail-from-name"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  maxLength={100}
                  placeholder="Por defecto, el nombre de la app"
                  className={inputClass}
                />
              </div>
            </div>

            {message && (
              <p
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  message.kind === "ok"
                    ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200"
                    : "border-destructive/30 bg-destructive/10 text-destructive",
                )}
              >
                {message.text}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "Guardando…" : "Guardar"}
              </button>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || status.state === "unconfigured"}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                title={userEmail ? `Se envía a ${userEmail}` : undefined}
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {testing ? "Enviando..." : "Enviar correo de prueba"}
              </button>
              {userEmail && (
                <span className="text-xs text-muted-foreground">La prueba llega a {userEmail}</span>
              )}
            </div>
          </form>

          {/* Ayuda */}
          <section className="rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <Check className="h-3.5 w-3.5" />
              Ejemplo con ZeptoMail
            </p>
            <ul className="mt-2 space-y-1">
              <li>
                Servidor: <code>{ZEPTOMAIL_EXAMPLE.host}</code> · Puerto:{" "}
                <code>{ZEPTOMAIL_EXAMPLE.port}</code> · Seguridad: STARTTLS
              </li>
              <li>
                Usuario: <code>{ZEPTOMAIL_EXAMPLE.username}</code> · Contraseña: el token SMTP de tu
                Mail Agent en ZeptoMail
              </li>
              <li>Correo remitente: una dirección de un dominio verificado en ZeptoMail.</li>
            </ul>
            <p className="mt-2">
              La contraseña se guarda cifrada y nunca se vuelve a mostrar.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
