#!/usr/bin/env node
/**
 * Crea la primera cuenta (Dueño) de una instalación, o un Dueño nuevo para un
 * espacio que se quedó sin dueño útil. Ya no existe /register: el resto de
 * usuarios se crean desde Configuración → Equipo.
 *
 * Uso:
 *   node scripts/crear-admin.mjs "Nombre Apellido" correo@dominio [id-o-slug-del-espacio]
 *   npm run crear-admin -- "Nombre Apellido" correo@dominio
 *
 * Qué hace:
 *   - Si no hay ningún espacio: crea la cuenta con auth.admin.generateLink
 *     (tipo invite) y el trigger handle_new_user crea su espacio y la deja
 *     como Dueño.
 *   - Si ya hay espacios: elige el indicado, o el único, o el primero sin un
 *     Dueño útil (un Dueño que haya iniciado sesión alguna vez). Crea la
 *     invitación pendiente que exige el trigger, crea la cuenta y la agrega
 *     como Dueño. Si la cuenta ya existía, solo la agrega como Dueño.
 *   - Envía el enlace de activación con el correo de la app (Configuración →
 *     Correo o variables SMTP_*). Si no hay correo, imprime el enlace para
 *     compartirlo por un canal privado.
 *
 * Lee las variables de .env como scripts/smoke-test.mjs: NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL (y opcionalmente
 * NEXT_PUBLIC_APP_NAME, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM).
 */

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { decryptSecret } from "./mail-crypto.mjs";

// Cargar .env a mano (sin dotenv), igual que smoke-test.mjs.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    // Sin comillas alrededor: KEY="valor" o KEY='valor'.
    const val = trimmed.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = val;
  }
}

const SET_PASSWORD_PATH = "/cuenta/contrasena";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ScriptError extends Error {}

/** Detiene el script; el mensaje lo imprime el catch final. */
function fail(message) {
  throw new ScriptError(message);
}

/** Errores de uso o de configuración, antes de conectarse a Supabase. */
function usageError(message) {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

function step(message) {
  console.log(`- ${message}`);
}

const [, , rawName, rawEmail, workspaceArg] = process.argv;

if (!rawName || !rawEmail) {
  console.log('Uso: node scripts/crear-admin.mjs "Nombre Apellido" correo@dominio [id-o-slug-del-espacio]');
  process.exit(1);
}

const fullName = rawName.trim().replace(/\s+/g, " ");
const email = rawEmail.trim().toLowerCase();
if (!fullName || fullName.length > 100) usageError("El nombre es obligatorio y debe tener hasta 100 caracteres.");
if (!EMAIL_RE.test(email)) usageError(`"${rawEmail}" no parece un correo válido.`);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "CRM";

if (!SUPABASE_URL) usageError("Falta NEXT_PUBLIC_SUPABASE_URL en .env.");
if (!SERVICE_KEY) usageError("Falta SUPABASE_SERVICE_ROLE_KEY en .env.");
if (!APP_URL || !/^https?:\/\//.test(APP_URL)) {
  usageError("Falta NEXT_PUBLIC_APP_URL en .env (la dirección pública de la app, p. ej. https://crm.tudominio.com).");
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ------------------------------------------------------------------
// Ayudas
// ------------------------------------------------------------------

async function authUserExists(address) {
  const { data, error } = await supabase.rpc("auth_user_exists", { p_email: address });
  if (error) fail(`No se pudo consultar auth_user_exists (¿está aplicada la migración 00017?): ${error.message}`);
  return data === true;
}

async function findUserByEmail(address) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`No se pudo listar usuarios: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === address);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function getUser(id) {
  const { data } = await supabase.auth.admin.getUserById(id);
  return data?.user ?? null;
}

async function hasUsefulOwner(workspaceId) {
  const { data: owners } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner");
  for (const owner of owners ?? []) {
    const user = await getUser(owner.user_id);
    if (user?.last_sign_in_at) return true;
  }
  return false;
}

async function generateLink(type, address) {
  const { data, error } =
    type === "invite"
      ? await supabase.auth.admin.generateLink({ type, email: address, options: { data: { full_name: fullName } } })
      : await supabase.auth.admin.generateLink({ type, email: address });
  if (error || !data?.properties?.hashed_token || !data.user) {
    return { error: error?.message ?? "Supabase no devolvió el enlace." };
  }
  const params = new URLSearchParams({
    token_hash: data.properties.hashed_token,
    type,
    next: SET_PASSWORD_PATH,
  });
  return { url: `${APP_URL}/auth/confirm?${params.toString()}`, user: data.user };
}

async function mailConfig() {
  const { data: row, error } = await supabase.from("app_mail_settings").select("*").eq("id", 1).maybeSingle();
  if (error && !/does not exist|schema cache/i.test(error.message)) {
    step(`Aviso: no se pudo leer app_mail_settings (${error.message}).`);
  }
  if (row?.host && row.port && row.username && row.password_encrypted && row.from_email) {
    try {
      return {
        host: row.host,
        port: row.port,
        secure: row.security === "ssl",
        user: row.username,
        pass: decryptSecret(row.password_encrypted, SERVICE_KEY),
        from: { name: row.from_name || APP_NAME, address: row.from_email },
        source: "Configuración → Correo",
      };
    } catch {
      step("Aviso: no se pudo descifrar la contraseña SMTP guardada (¿cambió la service role key?).");
    }
  }
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS && MAIL_FROM) {
    const port = Number(SMTP_PORT || 587);
    return {
      host: SMTP_HOST.trim(),
      port,
      secure: port === 465,
      user: SMTP_USER.trim(),
      pass: SMTP_PASS.trim(),
      from: MAIL_FROM.trim(),
      source: "variables SMTP_* de .env",
    };
  }
  return null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function deliver(url, address) {
  const config = await mailConfig();
  if (config) {
    try {
      const transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: !config.secure,
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: 10_000,
      });
      const text = `Hola, ${fullName}:\n\nTe crearon un usuario de Dueño en ${APP_NAME}. Abre este enlace para activar tu cuenta y crear tu contraseña (vence en 24 horas y solo funciona una vez):\n\n${url}\n`;
      await transport.sendMail({
        from: config.from,
        to: address,
        subject: `Activa tu cuenta en ${APP_NAME}`,
        text,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#333;max-width:520px">
<p>Hola, ${escapeHtml(fullName)}:</p>
<p>Te crearon un usuario de Dueño en ${escapeHtml(APP_NAME)}. Abre el enlace para activar tu cuenta y crear tu contraseña. Vence en 24 horas y solo funciona una vez.</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Activar mi cuenta</a></p>
<p style="font-size:13px;color:#666">Si el botón no funciona, copia este enlace:<br>${escapeHtml(url)}</p>
</div>`,
      });
      step(`Correo de activación enviado a ${address} (con ${config.source}).`);
      return;
    } catch (err) {
      step(`No se pudo enviar el correo (${err?.message ?? err}).`);
    }
  } else {
    step("El correo de la app aún no está configurado.");
  }
  console.log("\nEnlace de activación (compártelo solo por un canal privado; quien lo abra podrá activar la cuenta; vence en 24 horas):\n");
  console.log(`  ${url}\n`);
}

// ------------------------------------------------------------------
// Principal
// ------------------------------------------------------------------

async function main() {
  console.log(`\nCrear Dueño: ${fullName} <${email}>`);
  console.log(`App: ${APP_URL}\n`);

  const exists = await authUserExists(email);
  const { data: workspaces, error: wsError } = await supabase
    .from("workspaces")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: true });
  if (wsError) fail(`No se pudieron leer los espacios: ${wsError.message}`);

  // A) Instalación nueva: el trigger crea el espacio y deja a la persona de Dueño.
  if (!workspaces?.length) {
    if (exists) {
      fail(
        "Ya existe una cuenta con ese correo pero no hay ningún espacio de trabajo. Crea el espacio desde el SQL Editor o borra esa cuenta en Supabase → Authentication y vuelve a ejecutar el script.",
      );
    }
    step("No hay espacios de trabajo: es una instalación nueva.");
    const link = await generateLink("invite", email);
    if (link.error) fail(`No se pudo crear la cuenta: ${link.error}`);
    step(`Cuenta creada (id ${link.user.id}).`);

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, workspaces(name)")
      .eq("user_id", link.user.id)
      .maybeSingle();
    if (membership?.role === "owner") {
      step(`El trigger creó el espacio "${membership.workspaces?.name ?? membership.workspace_id}" con la persona como Dueño.`);
    } else {
      step("Aviso: no se encontró la membresía de Dueño. Revisa que la migración 00017 esté aplicada.");
    }
    await deliver(link.url, email);
    return;
  }

  // B) Ya hay espacios: elegir el destino.
  let target = null;
  if (workspaceArg) {
    target = workspaces.find((w) => w.id === workspaceArg || w.slug === workspaceArg) ?? null;
    if (!target) fail(`No existe un espacio con id o slug "${workspaceArg}".`);
    if (await hasUsefulOwner(target.id)) {
      fail(`"${target.name}" ya tiene un Dueño activo. Crea el usuario desde Configuración → Equipo.`);
    }
  } else {
    for (const ws of workspaces) {
      if (!(await hasUsefulOwner(ws.id))) {
        target = ws;
        break;
      }
    }
    if (!target) {
      const list = workspaces.map((w) => `  - ${w.name} (${w.slug})`).join("\n");
      fail(
        `Todos los espacios ya tienen un Dueño activo:\n${list}\nCrea los usuarios desde Configuración → Equipo.`,
      );
    }
  }
  step(`Espacio sin Dueño activo: "${target.name}" (${target.slug}).`);

  // B1) La cuenta ya existe: se agrega (o se asciende) como Dueño.
  if (exists) {
    const user = await findUserByEmail(email);
    if (!user) fail("La cuenta existe pero no se pudo encontrar. Inténtalo de nuevo.");
    const { error } = await supabase
      .from("workspace_members")
      .upsert({ workspace_id: target.id, user_id: user.id, role: "owner" }, { onConflict: "workspace_id,user_id" });
    if (error) fail(`No se pudo agregar como Dueño: ${error.message}`);
    step(`La cuenta ya existía (id ${user.id}); ahora es Dueño de "${target.name}".`);

    if (user.last_sign_in_at) {
      step("Ya inició sesión antes: puede entrar con su contraseña o usar ¿Olvidaste tu contraseña?.");
      return;
    }
    const link = await generateLink(user.email_confirmed_at ? "recovery" : "invite", email);
    if (link.error) fail(`No se pudo generar el enlace de activación: ${link.error}`);
    await deliver(link.url, email);
    return;
  }

  // B2) Cuenta nueva: el trigger exige una invitación pendiente para el correo.
  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", target.id)
    .limit(1);
  let invitedBy = members?.[0]?.user_id ?? null;
  if (!invitedBy) {
    const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    invitedBy = data?.users?.[0]?.id ?? null;
  }
  if (!invitedBy) {
    fail(
      "Hay espacios pero ningún usuario en Auth para registrar como autor de la invitación. Borra los espacios vacíos desde el SQL Editor y vuelve a ejecutar el script.",
    );
  }

  const { data: invite, error: inviteError } = await supabase
    .from("workspace_invites")
    .insert({ workspace_id: target.id, email, role: "owner", invited_by: invitedBy, status: "pending" })
    .select("id")
    .single();
  if (inviteError) fail(`No se pudo crear la invitación pendiente: ${inviteError.message}`);
  step("Invitación pendiente creada (la necesita el trigger handle_new_user).");

  const link = await generateLink("invite", email);
  if (link.error) {
    await supabase.from("workspace_invites").delete().eq("id", invite.id);
    fail(`No se pudo crear la cuenta: ${link.error}`);
  }
  step(`Cuenta creada (id ${link.user.id}).`);

  const { error: memberError } = await supabase
    .from("workspace_members")
    .insert({ workspace_id: target.id, user_id: link.user.id, role: "owner" });
  if (memberError) {
    await supabase.auth.admin.deleteUser(link.user.id);
    await supabase.from("workspace_invites").delete().eq("id", invite.id);
    fail(`No se pudo agregar como Dueño (se deshizo la cuenta): ${memberError.message}`);
  }
  await supabase.from("workspace_invites").update({ status: "accepted" }).eq("id", invite.id);
  step(`Agregada como Dueño de "${target.name}".`);

  await deliver(link.url, email);
}

main()
  .then(() => {
    console.log("Listo.\n");
  })
  .catch((err) => {
    console.error(`\nERROR: ${err instanceof ScriptError ? err.message : (err?.stack ?? err)}\n`);
    // Sin process.exit: deja cerrar las conexiones pendientes (en Windows
    // salir a la fuerza puede disparar un assert de libuv).
    process.exitCode = 1;
  });
