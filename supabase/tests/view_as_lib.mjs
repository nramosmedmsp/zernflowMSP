// Utilidades compartidas por view_as_parity.mjs y view_as_attacks.mjs ("Ver como").
// SOLO contra una base LOCAL (supabase start) con los usuarios de prueba de
// seed.mjs (owner/admin/supervisor/asesor/asesor2 @local.test, clave Local12345!).
// Variables: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, APP_URL.
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import pg from "pg";

export const URL_API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
export const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const SRK =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
export const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const APP_URL = process.env.APP_URL ?? "http://localhost:3456";
export const PASSWORD = "Local12345!";

if (!URL_API.includes("127.0.0.1") && !URL_API.includes("localhost")) throw new Error("Solo contra la base local.");
if (!DB_URL.includes("127.0.0.1") && !DB_URL.includes("localhost")) throw new Error("Solo contra la base local.");

export const svc = createClient(URL_API, SRK, { auth: { persistSession: false, autoRefreshToken: false } });
export const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
export const q = async (sql, params = []) => (await db.query(sql, params)).rows;

export const EMAILS = {
  owner: "owner@local.test",
  admin: "admin@local.test",
  supervisor: "supervisor@local.test",
  asesor: "asesor@local.test",
  asesor2: "asesor2@local.test",
};

export async function userIds() {
  const rows = await q("select id, email from auth.users where email = any($1)", [Object.values(EMAILS)]);
  const byEmail = Object.fromEntries(rows.map((r) => [r.email, r.id]));
  return Object.fromEntries(Object.entries(EMAILS).map(([k, e]) => [k, byEmail[e]]));
}

export async function workspaceId() {
  return (await q("select id from public.workspaces order by created_at limit 1"))[0].id;
}

/** Inicia sesión; devuelve { client, session, userId, sessionId, cookieHeader } (cookie como la deja @supabase/ssr). */
export async function signIn(email) {
  const jar = new Map();
  const ssr = createServerClient(URL_API, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { data, error } = await ssr.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  const claims = JSON.parse(Buffer.from(data.session.access_token.split(".")[1], "base64url").toString());
  const client = createClient(URL_API, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  return {
    email,
    client,
    token: data.session.access_token,
    userId: data.user.id,
    sessionId: claims.session_id,
    cookies: () => [...jar].map(([n, v]) => `${n}=${v}`),
    cookieHeader: (extra = []) => [...[...jar].map(([n, v]) => `${n}=${v}`), ...extra].join("; "),
  };
}

/** Empieza una vista como lo hace la ruta /start (rpc view_as_start con el cliente de servicio). */
export async function startViewRpc(owner, ws, target) {
  const args = {
    p_viewer: owner.userId,
    p_auth_session: owner.sessionId,
    p_workspace: ws,
    p_kind: target.kind,
    p_target_user: target.userId ?? null,
    p_role: target.role ?? null,
    p_team: target.teamId ?? null,
  };
  return svc.rpc("view_as_start", args);
}

export async function stopViewRpc(owner) {
  return svc.rpc("view_as_stop", { p_viewer: owner.userId, p_auth_session: owner.sessionId, p_reason: "manual" });
}

export async function closeAllViews() {
  await q("update public.view_as_sessions set ended_at = now(), end_reason = 'manual' where ended_at is null");
}

export async function appUp() {
  try {
    const r = await fetch(`${APP_URL}/login`, { redirect: "manual", signal: AbortSignal.timeout(20000) });
    return r.status < 500;
  } catch {
    return false;
  }
}

export function line(ok, name, detail = "") {
  return `${ok ? "PASS" : "FAIL"} ${name}${detail ? " -> " + detail : ""}`;
}

export async function finish(rows, fails, label) {
  console.log(rows.join("\n"));
  console.log(`\n${label}: ${rows.length} comprobaciones, ${fails} fallos`);
  await db.end();
  process.exit(fails ? 1 : 0);
}
