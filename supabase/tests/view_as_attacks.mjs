// Ataques y regresiones de "Ver como" (migración 00040 + rutas + middleware)
// contra una base LOCAL (supabase start) y la app local (next dev en APP_URL).
// Uso: node supabase/tests/view_as_attacks.mjs
// NO apuntar a producción: crea y borra datos de prueba (espacio 2, usuarios temporales).
// Cada fila: PASS = el sistema se comportó como debía (el ataque quedó bloqueado o lo legítimo funcionó).
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ANON, APP_URL, PASSWORD, URL_API, appUp, closeAllViews, db, finish, line, q, signIn, startViewRpc, svc, userIds, workspaceId,
} from "./view_as_lib.mjs";

const rows = [];
let fails = 0;
const rec = (ok, name, detail) => {
  if (!ok) fails++;
  rows.push(line(ok, name, detail));
};
const one = async (sql, p) => (await q(sql, p))[0];

if (!(await appUp())) {
  console.error(`La app no responde en ${APP_URL}: arráncala con next dev apuntando a la base local.`);
  process.exit(2);
}

const ids = await userIds();
const ws = await workspaceId();
await closeAllViews();
const MANIFEST = path.join(process.cwd(), ".next/dev/server/server-reference-manifest.json");

const owner = await signIn("owner@local.test");
const admin = await signIn("admin@local.test");
const supervisor = await signIn("supervisor@local.test");
const asesor = await signIn("asesor@local.test");
const asesor2 = await signIn("asesor2@local.test");
const anon = createClient(URL_API, ANON, { auth: { persistSession: false } });

// ── ayudantes HTTP ────────────────────────────────────────────────────────────
async function post(p, cookieHeader, body, { origin = APP_URL, headers = {} } = {}) {
  // Tope de frecuencia de la 00043 (5 inicios de "Ver como" por minuto): esta suite hace muchos
  // inicios seguidos, así que se limpia el contador antes de cada uno. El código NO se toca.
  if (p === "/api/v1/view-as/start") {
    await q("delete from public.rate_limit_hits where bucket like 'view_as_start:%'").catch(() => {});
  }
  const r = await fetch(APP_URL + p, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: cookieHeader, "content-type": "application/json", ...(origin ? { origin } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, setCookie: r.headers.getSetCookie().map((c) => c.split(";")[0]), raw: r };
}
async function get(p, cookieHeader) {
  const r = await fetch(APP_URL + p, { redirect: "manual", headers: { cookie: cookieHeader } });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
}
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).node; } catch {}
function actionId(name) {
  return Object.entries(manifest ?? {}).find(([, v]) => v.exportedName === name)?.[0] ?? null;
}
/** Llama a una server action por su id; devuelve el objeto resultado. */
async function action(cookieHeader, pagePath, name, args) {
  const id = actionId(name);
  if (!id) return { missing: true };
  const r = await fetch(APP_URL + pagePath, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: cookieHeader, "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: APP_URL },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  const m = text.match(/^1:(\{.*\})$/m);
  let result = null;
  try { result = m ? JSON.parse(m[1]) : null; } catch {}
  return { status: r.status, result, text };
}
/** Crea una cuenta de prueba (el registro es solo por invitación: se deja una invitación pendiente antes). */
async function mkUser(email, name, { confirm = true } = {}) {
  await q("insert into public.workspace_invites (workspace_id, email, role, invited_by, status) values ($1, $2, 'member', $3, 'pending')", [ws, email, ids.owner]);
  const r = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: confirm, user_metadata: { full_name: name } });
  await q("delete from public.workspace_invites where lower(email) = lower($1)", [email]);
  if (r.error) throw new Error(`createUser ${email}: ${r.error.message}`);
  return r.data.user;
}
const sessions = async () => Number((await one("select count(*)::int n from public.view_as_sessions")).n);
const activeFor = async (userId) => await one("select * from public.view_as_sessions where viewer_id = $1 and ended_at is null", [userId]);
const ownerCookie = (sc = []) => owner.cookieHeader(sc);
async function startHttp(target) {
  const r = await post("/api/v1/view-as/start", ownerCookie(), target);
  return r;
}
async function stopHttp(sc) {
  return post("/api/v1/view-as/stop", ownerCookie(sc));
}
const COUNT = async (c, t) => (await c.from(t).select("id", { count: "exact", head: true })).count;

// ═══ A. Quién puede activar la vista ═════════════════════════════════════════
{
  const before = await sessions();
  for (const [name, who] of [["admin", admin], ["supervisor", supervisor], ["asesor", asesor]]) {
    const r = await post("/api/v1/view-as/start", who.cookieHeader(), { kind: "person", userId: ids.asesor2 });
    rec(r.status === 403, `A ${name}: POST /api/v1/view-as/start`, `status ${r.status} ${r.json?.error ?? ""}`);
    const rpc = await who.client.rpc("view_as_start", { p_viewer: who.userId, p_auth_session: who.sessionId, p_workspace: ws, p_kind: "person", p_target_user: ids.asesor2 });
    rec(!!rpc.error, `A ${name}: rpc view_as_start con su sesión (PostgREST)`, rpc.error?.message);
    const ins = await who.client.from("view_as_sessions").insert({ workspace_id: ws, viewer_id: who.userId, auth_session_id: who.sessionId, target_kind: "person", target_user_id: ids.asesor2, target_label: "x", expires_at: new Date(Date.now() + 60000).toISOString() });
    rec(!!ins.error, `A ${name}: insert directo en view_as_sessions`, ins.error?.message);
    const sel = await who.client.from("view_as_sessions").select("*");
    rec(!!sel.error || (sel.data ?? []).length === 0, `A ${name}: leer view_as_sessions`, sel.error?.message ?? `${sel.data?.length} filas`);
    const opts = await get("/api/v1/view-as/options", who.cookieHeader());
    rec(opts.status === 403, `A ${name}: GET /api/v1/view-as/options`, `status ${opts.status}`);
    for (const fn of ["view_as_start(uuid, uuid, uuid, text, uuid, text, uuid)", "view_as_stop(uuid, uuid, text)", "view_as_touch(uuid, uuid, text)"]) {
      const ok = (await one(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') p`)).p;
      rec(ok === false, `A authenticated no ejecuta ${fn.split("(")[0]}`);
    }
  }
  const an = await anon.rpc("view_as_start", { p_viewer: ids.owner, p_auth_session: asesor.sessionId, p_workspace: ws, p_kind: "role", p_role: "admin" });
  rec(!!an.error, "A anon: rpc view_as_start", an.error?.message);
  const noOrigin = await post("/api/v1/view-as/start", ownerCookie(), { kind: "role", role: "admin" }, { origin: null });
  rec(noOrigin.status === 403, "A Dueño sin cabecera Origin (CSRF)", `status ${noOrigin.status}`);
  const badOrigin = await post("/api/v1/view-as/start", ownerCookie(), { kind: "role", role: "admin" }, { origin: "https://malo.example.com" });
  rec(badOrigin.status === 403, "A Dueño con Origin de otro sitio", `status ${badOrigin.status}`);
  const noSession = await post("/api/v1/view-as/start", "", { kind: "role", role: "admin" });
  rec(noSession.status === 401, "A sin sesión", `status ${noSession.status}`);
  const bad = await post("/api/v1/view-as/start", ownerCookie(), { kind: "person", userId: "no-es-uuid" });
  rec(bad.status === 400, "A cuerpo no válido", `status ${bad.status}`);
  rec((await sessions()) === before, "A ningún intento dejó filas en view_as_sessions");
}

// ═══ J. No se puede mirar a sí mismo ═════════════════════════════════════════
{
  const r = await startHttp({ kind: "person", userId: ids.owner });
  rec(r.status === 400, "J Dueño se mira a sí mismo", `status ${r.status} ${r.json?.error ?? ""}`);
}

// ═══ B. Sin escritura en vista, por ninguna vía (Dueño viendo como Ana, que sí puede escribir) ═
const ownerBaseCases = await COUNT(owner.client, "cases");
const convRow = await one("select id from public.conversations order by created_at limit 1");
// control: Ana sí puede (sin vista)
await q("update public.conversations set unread_count = 7 where id = $1", [convRow.id]);
{
  const ctl = await admin.client.from("conversations").update({ unread_count: 0 }).eq("id", convRow.id).select("id");
  rec(!ctl.error && ctl.data?.length === 1, "B control: Ana pone unread_count=0 con su sesión", ctl.error?.message);
  const ctl2 = await admin.client.from("saved_replies").insert({ workspace_id: ws, scope: "personal", user_id: ids.admin, title: "ctl", body: "x", created_by: ids.admin }).select("id");
  rec(!ctl2.error && ctl2.data?.length === 1, "B control: Ana crea una respuesta personal", ctl2.error?.message);
  if (ctl2.data?.[0]) await q("delete from public.saved_replies where id = $1", [ctl2.data[0].id]);
}
await q("update public.conversations set unread_count = 7 where id = $1", [convRow.id]);
const startAna = await startHttp({ kind: "person", userId: ids.admin });
rec(startAna.status === 200 && startAna.setCookie.some((c) => c.startsWith("crm_view_as=")), "B Dueño empieza a ver como Ana", `status ${startAna.status}`);
const sc = startAna.setCookie;
const viewCookie = () => ownerCookie(sc);
{
  const cur = await owner.client.rpc("view_as_current");
  rec(cur.data?.target_user_id === ids.admin && cur.data?.kind === "person", "B view_as_current con la sesión del Dueño devuelve a Ana");

  const upd = await owner.client.from("conversations").update({ unread_count: 0 }).eq("id", convRow.id).select("id");
  rec(upd.error?.code === "25006", "B PATCH conversations directo a PostgREST", upd.error ? `${upd.error.code} ${upd.error.message}` : "SE ESCRIBIÓ");
  rec((await one("select unread_count from public.conversations where id = $1", [convRow.id])).unread_count === 7, "B unread_count sigue en 7");
  const ins = await owner.client.from("saved_replies").insert({ workspace_id: ws, scope: "personal", user_id: ids.admin, title: "zz", body: "x", created_by: ids.admin }).select("id");
  rec(ins.error?.code === "25006", "B insert directo (respuesta personal de Ana)", ins.error ? `${ins.error.code}` : "SE ESCRIBIÓ");
  rec((await one("select count(*)::int n from public.saved_replies where title = 'zz'")).n === 0, "B no quedó la respuesta");
  const rpcW = await owner.client.rpc("merge_workspace_settings", { p_workspace_id: ws, p_set: { zz_vista: 1 }, p_remove: [] });
  rec(!!rpcW.error, "B rpc que escribe (merge_workspace_settings)", rpcW.error ? `${rpcW.error.code} ${rpcW.error.message}` : "SE ESCRIBIÓ");
  rec(!(await one("select settings ? 'zz_vista' as has from public.workspaces where id = $1", [ws])).has, "B settings sin cambios");

  // service_role con la cabecera del candado (clientes del servidor en vista)
  const locked = createClient(URL_API, (await import("./view_as_lib.mjs")).SRK, { auth: { persistSession: false }, global: { headers: { "x-crm-read-only": "1" } } });
  const w1 = await locked.from("workspaces").update({ name: (await one("select name from public.workspaces where id=$1", [ws])).name }).eq("id", ws).select("id");
  rec(w1.error?.code === "25006", "B service_role + cabecera x-crm-read-only: escritura", w1.error?.code ?? "SE ESCRIBIÓ");
  const r1 = await locked.from("workspaces").select("id").limit(1);
  rec(!r1.error && r1.data.length === 1, "B service_role + cabecera: la lectura sigue funcionando");
  const w2 = await svc.from("workspaces").update({ name: (await one("select name from public.workspaces where id=$1", [ws])).name }).eq("id", ws).select("id");
  rec(!w2.error && w2.data.length === 1, "B service_role SIN cabecera sigue escribiendo (cron y webhook)", w2.error?.message);

  // rutas HTTP con la cookie de la vista
  const msgs0 = await one("select count(*)::int n from public.messages");
  const act0 = await one("select count(*)::int n from public.activity");
  const attempts = [
    ["POST /api/v1/messages", () => post("/api/v1/messages", viewCookie(), { conversationId: convRow.id, text: "hola" })],
    ["POST /api/v1/media/upload-url", () => post("/api/v1/media/upload-url", viewCookie(), { conversationId: convRow.id, mime: "image/jpeg", size: 1000 })],
    ["POST /api/v1/channels/sync", () => post("/api/v1/channels/sync", viewCookie(), {})],
    ["POST /api/v1/broadcasts", () => post("/api/v1/broadcasts", viewCookie(), { name: "zz" })],
    ["PATCH /api/v1/flows/x", async () => (await fetch(`${APP_URL}/api/v1/flows/00000000-0000-4000-8000-000000000000`, { method: "PATCH", headers: { cookie: viewCookie(), origin: APP_URL, "content-type": "application/json" }, body: "{}" }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })))],
    ["DELETE /api/v1/channels/x", async () => (await fetch(`${APP_URL}/api/v1/channels/00000000-0000-4000-8000-000000000000`, { method: "DELETE", headers: { cookie: viewCookie(), origin: APP_URL } }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })))],
    ["POST /api/cron/jobs con cookie de vista", () => post("/api/cron/jobs", viewCookie(), {})],
  ];
  for (const [name, fn] of attempts) {
    const r = await fn();
    rec(r.status === 403 && r.json?.code === "VIEW_AS_READ_ONLY", `B ${name}`, `status ${r.status} ${r.json?.code ?? ""}`);
  }
  rec((await one("select count(*)::int n from public.messages")).n === msgs0.n, "B no se creó ningún mensaje");
  const zip = await get("/api/v1/admin/source-zip", viewCookie());
  rec(zip.status === 403, "B GET source-zip (GET que escribe un registro)", `status ${zip.status}`);
  const remote = await get(`/api/v1/media/remote?c=${convRow.id}&m=x&i=0&u=${encodeURIComponent("https://example.com/x")}`, viewCookie());
  rec(remote.status === 403 || remote.status === 400, "B GET media/remote (GET que guarda copias)", `status ${remote.status}`);
  const remote2 = await get(`/api/v1/media/remote?c=${convRow.id}&m=x&i=0&u=${encodeURIComponent("/api/v1/whatsapp/media/abc")}`, viewCookie());
  rec(remote2.status === 403, "B GET media/remote con enlace válido bloqueado por la vista", `status ${remote2.status}`);
  rec((await one("select count(*)::int n from public.activity")).n === act0.n, "B no se registró actividad nueva");

  // server actions
  if (manifest) {
    const readOk = await action(viewCookie(), "/dashboard/cases", "listCaseMembers", []);
    rec(readOk.result?.ok === true && readOk.result.members?.length >= 5, "B server action de LECTURA (POST) sigue funcionando en vista", `members ${readOk.result?.members?.length}`);
    const w = await action(viewCookie(), "/dashboard/cases", "setMyAvailability", ["away"]);
    rec(!!w.result?.error, "B server action de escritura setMyAvailability", JSON.stringify(w.result)?.slice(0, 90));
    rec((await one("select availability from public.workspace_members where user_id = $1", [ids.admin])).availability === "available", "B disponibilidad de Ana sin cambios");
    const caseOfAna = await one("select id from public.cases where assignee_id = $1 and status = 'open' limit 1", [ids.admin]);
    if (caseOfAna) {
      const n0 = (await one("select count(*)::int n from public.case_notes")).n;
      const note = await action(viewCookie(), "/dashboard/cases", "addCaseNote", [caseOfAna.id, "nota en vista", []]);
      rec(!!note.result?.error && (await one("select count(*)::int n from public.case_notes")).n === n0, "B server action addCaseNote", JSON.stringify(note.result)?.slice(0, 90));
    }
    const c = await action(viewCookie(), "/dashboard/cases", "createContact", [{ name: "Zz Vista", phone: "+51999000111" }]);
    rec(!!c.result?.error && !(await one("select 1 as x from public.contacts where display_name = 'Zz Vista'")), "B server action createContact no crea nada", JSON.stringify(c.result ?? c.text)?.slice(0, 90));
    // control: la misma acción con la sesión real de Ana SÍ funciona
    const ctl = await action(admin.cookieHeader(), "/dashboard/cases", "setMyAvailability", ["away"]);
    rec(ctl.result?.ok === true || ctl.result?.availability === "away", "B control: setMyAvailability con la sesión de Ana funciona", JSON.stringify(ctl.result)?.slice(0, 90));
    await q("update public.workspace_members set availability = 'available' where user_id = $1", [ids.admin]);
  } else {
    rows.push("SKIP B server actions (falta .next/dev/server/server-reference-manifest.json: abre /dashboard/cases con next dev primero)");
  }

  // el candado también frena el correo: lo cubre vitest (lib/view-as/effects.test.ts)

  // touch y registro
  const t1 = await post("/api/v1/view-as/touch", viewCookie(), { path: "/dashboard/inbox" });
  const t2 = await post("/api/v1/view-as/touch", viewCookie(), { path: "/dashboard/inbox" });
  const t3 = await post("/api/v1/view-as/touch", viewCookie(), { path: "/dashboard/cases?x=1" });
  const t4 = await post("/api/v1/view-as/touch", viewCookie(), { path: "/api/v1/messages" });
  const row = await activeFor(ids.owner);
  rec(t1.json?.active === true && t3.json?.active === true && JSON.stringify(row.sections) === JSON.stringify(["Bandeja", "Gestiones"]), "B touch registra secciones con lista fija, sin repetidos ni rutas crudas", JSON.stringify(row.sections));
  rec(t2.status === 200 && t4.status === 200, "B touch con ruta desconocida no registra nada");
  rec(row.target_user_id === ids.admin && row.viewer_id === ids.owner && row.viewer_name === "Olga Dueña" && row.target_label === "Ana Admin", "B el registro dice quién miró a quién", `${row.viewer_name} -> ${row.target_label}`);
  rec(new Date(row.expires_at) - new Date(row.started_at) === 30 * 60 * 1000, "B la vista dura exactamente 30 minutos");
  rec((await one("select count(*)::int n from public.notifications where created_at > $1", [row.started_at])).n === 0, "B a la persona no se le crea ningún aviso");
}

// ═══ L. Opciones ══════════════════════════════════════════════════════════════
{
  const opts = await get("/api/v1/view-as/options", viewCookie());
  const names = (opts.json?.people ?? []).map((p) => p.name);
  rec(opts.status === 200 && ["Ana Admin", "Sara Supervisora", "Andrés Asesor", "Beto Asesor"].every((n) => names.includes(n)) && !names.includes("Olga Dueña"), "L options (también dentro de una vista): personas sin quien mira", names.join(", "));
  const labels = (opts.json?.roles ?? []).map((r) => r.label);
  rec(["Administrador", "Supervisor de Ventas", "Asesor de Ventas", "Supervisor de Postventa", "Asesor de Postventa"].every((l) => labels.includes(l)), "L options: roles de ejemplo", labels.join(", "));
}

// ═══ C. Salir restaura ═══════════════════════════════════════════════════════
{
  const stop = await stopHttp(sc);
  rec(stop.status === 200 && stop.json?.stopped === true, "C POST /api/v1/view-as/stop", `status ${stop.status}`);
  rec(stop.setCookie.some((c) => /^crm_view_as=$/.test(c)), "C la cookie de la vista se borra");
  const row = await one("select * from public.view_as_sessions where viewer_id = $1 order by started_at desc limit 1", [ids.owner]);
  rec(row.ended_at !== null && row.end_reason === "manual", "C el registro queda con fin y motivo manual (no se borra)");
  rec((await COUNT(owner.client, "cases")) === ownerBaseCases, "C el Dueño vuelve a ver como Dueño", `cases ${await COUNT(owner.client, "cases")} = ${ownerBaseCases}`);
  const cur = await owner.client.rpc("view_as_current");
  rec(cur.data === null, "C view_as_current vuelve a null");
  const w = await owner.client.from("saved_replies").insert({ workspace_id: ws, scope: "personal", user_id: ids.owner, title: "zz-salir", body: "x", created_by: ids.owner }).select("id");
  rec(!w.error && w.data?.length === 1, "C una escritura del Dueño funciona de nuevo", w.error?.message);
  if (w.data?.[0]) await q("delete from public.saved_replies where id = $1", [w.data[0].id]);
  const m = await post("/api/v1/messages", ownerCookie(), {});
  rec(m.status === 400, "C el candado de rutas ya no actúa (POST /api/v1/messages llega a su validación)", `status ${m.status}`);
  const again = await stopHttp([]);
  rec(again.status === 200 && again.json?.stopped === false, "C /stop es idempotente");
}
await q("update public.conversations set unread_count = 0 where id = $1", [convRow.id]);

// ═══ D. Caducidad ═════════════════════════════════════════════════════════════
{
  const s = await startHttp({ kind: "person", userId: ids.asesor });
  const sc2 = s.setCookie;
  const vc = () => ownerCookie(sc2);
  const asesorCases = await COUNT(owner.client, "cases");
  rec(asesorCases === (await COUNT(asesor.client, "cases")) && asesorCases !== ownerBaseCases, "D antes de caducar: el Dueño ve como Andrés", `cases ${asesorCases}`);
  await q("update public.view_as_sessions set expires_at = now() - interval '1 minute' where viewer_id = $1 and ended_at is null", [ids.owner]);
  rec((await COUNT(owner.client, "cases")) === ownerBaseCases, "D vencida: la siguiente lectura es la del Dueño", `cases ${await COUNT(owner.client, "cases")}`);
  const cur = await owner.client.rpc("view_as_current");
  rec(cur.data === null, "D vencida: view_as_current = null (la interfaz muestra «La vista terminó»)");
  const upd = await owner.client.from("conversations").update({ unread_count: 0 }).eq("id", convRow.id).select("id");
  rec(upd.error?.code === "25006", "D vencida (margen de 5 min): la base sigue en solo lectura", upd.error?.code ?? "SE ESCRIBIÓ");
  const tc = await post("/api/v1/view-as/touch", vc(), { path: "/dashboard/inbox" });
  rec(tc.json?.active === false, "D vencida: touch responde active=false");
  const post1 = await post("/api/v1/messages", vc(), { conversationId: convRow.id, text: "x" });
  rec(post1.status === 403, "D vencida: POST /api sigue en 403 hasta /stop", `status ${post1.status}`);
  if (manifest) {
    const expiredCookie = `${(await one("select id from public.view_as_sessions where viewer_id = $1 and ended_at is null", [ids.owner])).id}.${ids.owner}.${Date.now() - 1000}`;
    const w = await action(ownerCookie([`crm_view_as=${expiredCookie}`]), "/dashboard/cases", "setMyAvailability", ["away"]);
    rec(w.status === 403, "D cookie vencida: una server action (POST a la página) recibe 403 en el middleware", `status ${w.status}`);
    const w2 = await action(vc(), "/dashboard/cases", "setMyAvailability", ["away"]);
    rec(!w2.result?.ok && (await one("select availability from public.workspace_members where user_id=$1", [ids.owner])).availability === "available", "D vencida pero con cookie: la server action no escribe (cliente con candado + base)", JSON.stringify(w2.result)?.slice(0, 80));
  }
  await q("update public.view_as_sessions set expires_at = now() - interval '6 minutes' where viewer_id = $1 and ended_at is null", [ids.owner]);
  const afterGrace = await owner.client.from("saved_replies").insert({ workspace_id: ws, scope: "personal", user_id: ids.owner, title: "zz-gracia", body: "x", created_by: ids.owner }).select("id");
  rec(!afterGrace.error, "D pasado el margen de 5 min la base deja escribir al Dueño de nuevo", afterGrace.error?.message);
  if (afterGrace.data?.[0]) await q("delete from public.saved_replies where id = $1", [afterGrace.data[0].id]);
  const post2 = await post("/api/v1/messages", vc(), { conversationId: convRow.id, text: "x" });
  rec(post2.status === 403, "D pasado el margen, el servidor sigue con candado mientras no se salga (cookie)", `status ${post2.status}`);
  const st = await stopHttp(sc2);
  rec(st.json?.stopped === true && (await one("select end_reason from public.view_as_sessions where viewer_id=$1 order by started_at desc limit 1", [ids.owner])).end_reason === "expired", "D /stop cierra la vista vencida con motivo expired");
  const post3 = await post("/api/v1/messages", ownerCookie(), {});
  rec(post3.status === 400, "D tras /stop el candado desaparece", `status ${post3.status}`);
}

// ═══ E. Cookie falsa, cookie robada, aislamiento ═══════════════════════════════
{
  const baseline = await get("/api/v1/contacts", asesor.cookieHeader());
  const fakeUuid = crypto.randomUUID();
  for (const [name, val] of [["basura", "basura"], ["bien formada y falsa", `${fakeUuid}.${ids.asesor}.${Date.now() + 600000}`]]) {
    const g = await get("/api/v1/contacts", asesor.cookieHeader([`crm_view_as=${val}`]));
    rec(g.status === 200 && g.text === baseline.text, `E cookie ${name}: el asesor sigue viendo lo suyo`, `status ${g.status}`);
    const p = await post("/api/v1/messages", asesor.cookieHeader([`crm_view_as=${val}`]), { conversationId: convRow.id, text: "x" });
    rec(p.status === 403 && p.json?.code === "VIEW_AS_READ_ONLY", `E cookie ${name}: solo consigue quedar en solo lectura`, `status ${p.status}`);
  }
  rec(!(await asesor.client.rpc("view_as_current")).data, "E con cookie falsa la base no cambia ninguna identidad");
  // cookie VÁLIDA del Dueño usada por otra persona
  const s = await startHttp({ kind: "person", userId: ids.admin });
  const ownerCk = s.setCookie.find((c) => c.startsWith("crm_view_as="));
  const stolen = await get("/api/v1/contacts", asesor.cookieHeader([ownerCk]));
  rec(stolen.status === 200 && stolen.text === baseline.text, "E cookie válida del Dueño en manos del asesor: ve lo suyo, no lo de Ana");
  const stolenPost = await post("/api/v1/messages", asesor.cookieHeader([ownerCk]), {});
  rec(stolenPost.status === 400, "E la cookie de otra persona se descarta (el asesor no queda bloqueado)", `status ${stolenPost.status}`);
  const stolenPage = await get("/dashboard/cases", asesor.cookieHeader([ownerCk]));
  const normalPage = await get("/dashboard/cases", asesor.cookieHeader());
  const strip = (t) => t.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").replace(/\s+/g, " ");
  rec(strip(stolenPage.text) === strip(normalPage.text), "E la página de Gestiones del asesor con la cookie robada es idéntica a la normal");
  // aislamiento: mientras el Dueño mira, el asesor y Ana siguen igual
  rec((await COUNT(asesor.client, "cases")) === (await COUNT(asesor.client, "cases")) && !(await admin.client.rpc("view_as_current")).data, "E mientras el Dueño mira, otras sesiones no cambian");
  // la sesión del Dueño en otro dispositivo (otro session_id) NO se ve afectada
  const ownerOtherDevice = await signIn("owner@local.test");
  rec(ownerOtherDevice.sessionId !== owner.sessionId && (await COUNT(ownerOtherDevice.client, "cases")) === ownerBaseCases && !(await ownerOtherDevice.client.rpc("view_as_current")).data, "E otro dispositivo del Dueño (otra sesión de Auth) no se afecta");
  await stopHttp(s.setCookie);
}

// ═══ N. Reemplazo ═════════════════════════════════════════════════════════════
{
  await startViewRpc(owner, ws, { kind: "person", userId: ids.asesor });
  const first = await one("select id from public.view_as_sessions where viewer_id=$1 and ended_at is null", [ids.owner]);
  const second = await startViewRpc(owner, ws, { kind: "person", userId: ids.supervisor });
  const act = (await q("select id from public.view_as_sessions where viewer_id=$1 and ended_at is null", [ids.owner]));
  rec(!second.error && act.length === 1 && act[0].id === second.data.session_id, "N una sola vista activa por sesión; la anterior se cierra");
  rec((await one("select end_reason from public.view_as_sessions where id=$1", [first.id])).end_reason === "replaced", "N la anterior queda con motivo replaced");
  await closeAllViews();
}

// ═══ F. Fuga entre espacios ═══════════════════════════════════════════════════
{
  const tag = Date.now().toString(36);
  const z = { data: { user: await mkUser(`zz.${tag}@local.test`, "Zz Ajeno") } };
  const ws2 = (await one("insert into public.workspaces (name, slug) values ($1, $2) returning id", [`Ajeno ${tag}`, `ajeno-${tag}`])).id;
  await q("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [ws2, z.data.user.id]);
  // el asesor es miembro de AMBOS espacios (en el segundo, nuestro Dueño no es Dueño)
  await q("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [ws2, ids.asesor]);
  const r1 = await startHttp({ kind: "person", userId: ids.asesor });
  rec(r1.status === 403, "F ver como alguien que también es miembro de un espacio ajeno", `status ${r1.status} ${r1.json?.error ?? ""}`);
  const r2 = await startHttp({ kind: "person", userId: z.data.user.id });
  rec(r2.status === 400, "F ver como alguien que solo existe en el espacio ajeno", `status ${r2.status} ${r2.json?.error ?? ""}`);
  const rpc = await startViewRpc(owner, ws2, { kind: "person", userId: z.data.user.id });
  rec(!!rpc.error && rpc.error.message.includes("view_as_not_owner"), "F pedir la vista sobre el espacio ajeno (donde no es Dueño)", rpc.error?.message);
  const r3 = await startHttp({ kind: "role", role: "agent", teamId: crypto.randomUUID() });
  rec(r3.status === 400, "F rol con un equipo que no existe", `status ${r3.status}`);
  rec(!(await activeFor(ids.owner)), "F ninguna de las pruebas dejó una vista activa");
  await q("delete from public.workspace_members where workspace_id = $1 and user_id = $2", [ws2, ids.asesor]);
  await q("delete from public.workspaces where id = $1", [ws2]);
  await svc.auth.admin.deleteUser(z.data.user.id);
}

// ═══ G. Identidad de ejemplo ══════════════════════════════════════════════════
{
  const teamV = (await one("select id from public.teams where name = 'Ventas'")).id;
  const s = await startHttp({ kind: "role", role: "agent", teamId: teamV });
  const info = s.json?.view;
  const fake = info?.targetUserId;
  rec(s.status === 200 && info?.kind === "role" && info?.label === "Asesor de Ventas", "G empezar «Asesor de Ventas»", `status ${s.status} ${info?.label}`);
  rec(!!fake && !(await svc.auth.admin.getUserById(fake)).data.user, "G el id de ejemplo no existe en Auth (no puede iniciar sesión)");
  rec((await q("select 1 from public.workspace_members where user_id=$1 union all select 1 from public.team_members where user_id=$1", [fake])).length === 0, "G ninguna fila real de workspace_members/team_members con ese id");
  const aCase = await one("select id from public.cases where status='open' limit 1");
  const asg = await svc.from("cases").update({ assignee_id: fake }).eq("id", aCase.id).select("id");
  rec(["23503", "23514"].includes(asg.error?.code), "G asignarle una gestión falla (clave foránea / check_case_refs)", asg.error ? `${asg.error.code} ${asg.error.message}` : "SE ASIGNÓ");
  const noti = await svc.from("notifications").insert({ workspace_id: ws, user_id: fake, type: "mention", title: "x" }).select("id");
  rec(!!noti.error, "G no puede recibir avisos", noti.error?.code ?? "SE CREÓ");
  const mem = await owner.client.from("workspace_members").select("user_id").eq("user_id", fake);
  rec((mem.data ?? []).length === 0, "G la tabla real no muestra la identidad de ejemplo");
  const cur = await owner.client.rpc("view_as_current");
  rec(cur.data?.role_ws === "member" && cur.data?.team_role === "agent" && cur.data?.team_name === "Ventas", "G view_as_current describe el rol y el equipo");
  const mine = await owner.client.from("cases").select("id").eq("assignee_id", fake);
  rec((mine.data ?? []).length === 0, "G «Míos» vacío");
  const lm = manifest ? await action(ownerCookie(s.setCookie), "/dashboard/cases", "listCaseMembers", []) : null;
  if (lm) {
    const members = lm.result?.members ?? [];
    const sample = members.filter((m) => m.sample);
    rec(sample.length === 1 && sample[0].userId === fake && members.filter((m) => !m.sample).length === (await one("select count(*)::int n from public.workspace_members")).n, "G listCaseMembers incluye la identidad de ejemplo marcada sample y a nadie más", `sample ${sample.length}/${members.length}`);
  }
  await stopHttp(s.setCookie);
  // sin vista, ninguna función de permisos ve la identidad
  rec((await one("select count(*)::int n from crm_private.effective_workspace_members")).n === (await one("select count(*)::int n from public.workspace_members")).n, "G fuera de la vista las membresías efectivas = las reales");
  rec((await one("select public.is_ws_admin($1::uuid) as r", [ws])).r === false, "G is_ws_admin sin identidad = false");
}

// ═══ H. Dueño degradado a mitad de vista ══════════════════════════════════════
{
  await q("update public.workspace_members set role = 'owner' where user_id = $1", [ids.asesor2]); // segundo Dueño: permite degradar al primero
  const s = await startHttp({ kind: "person", userId: ids.asesor });
  rec(s.status === 200, "H empieza a ver como Andrés");
  rec((await COUNT(owner.client, "cases")) === (await COUNT(asesor.client, "cases")), "H antes de degradar: ve como Andrés");
  await q("update public.workspace_members set role = 'admin' where user_id = $1", [ids.owner]);
  const cur = await owner.client.rpc("view_as_current");
  const cases = await COUNT(owner.client, "cases");
  rec(cur.data === null && cases !== (await COUNT(asesor.client, "cases")), "H degradado: la siguiente petición ya no cambia la identidad", `view_as_current ${JSON.stringify(cur.data)} cases ${cases}`);
  const opts = await get("/api/v1/view-as/options", ownerCookie(s.setCookie));
  rec(opts.status === 403, "H degradado: options responde 403", `status ${opts.status}`);
  const start2 = await startHttp({ kind: "person", userId: ids.supervisor });
  rec(start2.status === 403, "H degradado: no puede empezar otra vista", `status ${start2.status}`);
  await q("update public.workspace_members set role = 'owner' where user_id = $1", [ids.owner]);
  await q("update public.workspace_members set role = 'member' where user_id = $1", [ids.asesor2]);
  await stopHttp(s.setCookie);
}

// ═══ I. Ver como otro Dueño ═══════════════════════════════════════════════════
{
  await q("update public.workspace_members set role = 'owner' where user_id = $1", [ids.asesor2]);
  const s = await startHttp({ kind: "person", userId: ids.asesor2 });
  rec(s.status === 200, "I ver como otro Dueño está permitido", `status ${s.status}`);
  const upd = await owner.client.from("saved_replies").insert({ workspace_id: ws, scope: "personal", user_id: ids.asesor2, title: "zz-otro", body: "x", created_by: ids.asesor2 }).select("id");
  rec(upd.error?.code === "25006", "I viendo como otro Dueño: solo lectura", upd.error?.code ?? "SE ESCRIBIÓ");
  const row = await activeFor(ids.owner);
  rec(row?.target_user_id === ids.asesor2 && row.target_label === "Beto Asesor", "I queda registrado");
  await stopHttp(s.setCookie);
  await q("update public.workspace_members set role = 'member' where user_id = $1", [ids.asesor2]);
}

// ═══ L2. Opciones con invitado pendiente y otros Dueños ═══════════════════════
{
  const tag = Date.now().toString(36);
  const inv = { data: { user: await mkUser(`inv.${tag}@local.test`, "Invitada Pendiente", { confirm: false }) } };
  await q("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [ws, inv.data.user.id]);
  await q("update public.workspace_members set role = 'owner' where user_id = $1", [ids.asesor2]);
  const opts = await get("/api/v1/view-as/options", ownerCookie());
  const pend = (opts.json?.people ?? []).find((p) => p.name === "Invitada Pendiente");
  rec(pend?.status === "pending", "L2 options incluye a la persona invitada que aún no entró (pendiente)", JSON.stringify(pend));
  rec((opts.json?.people ?? []).find((p) => p.userId === ids.asesor2)?.roleLabel === "Dueño", "L2 options incluye a otros Dueños");
  const s = await startHttp({ kind: "person", userId: inv.data.user.id });
  rec(s.status === 200, "L2 se puede ver como una persona invitada que no ha entrado");
  const lastSign = await one("select last_sign_in_at from auth.users where id = $1", [inv.data.user.id]);
  rec(lastSign.last_sign_in_at === null, "L2 mirarla no cambia su último ingreso (sigue Pendiente)");
  await stopHttp(s.setCookie);
  await q("update public.workspace_members set role = 'member' where user_id = $1", [ids.asesor2]);
  await q("delete from public.workspace_members where user_id = $1", [inv.data.user.id]);
  await svc.auth.admin.deleteUser(inv.data.user.id);
}

// ═══ K. Cron, webhook y service_role con el pre-request instalado ═════════════
{
  const cfg = await one("select x as c from pg_roles r, unnest(r.rolconfig) x where r.rolname='authenticator' and x like 'pgrst.db_pre_request=%'");
  rec(cfg?.c === "pgrst.db_pre_request=crm_private.view_as_pre_request", "K el pre-request está instalado en authenticator", cfg?.c);
  const s = await startHttp({ kind: "person", userId: ids.asesor }); // con una vista activa del Dueño
  const secret = (await one("select webhook_secret from public.workspace_secrets limit 1")).webhook_secret;
  const evt = `evt-vc-${Date.now()}`;
  const sender = `5199${Date.now().toString().slice(-7)}9`;
  const now = new Date().toISOString();
  const body = JSON.stringify({ id: evt, event: "message.received", timestamp: now, message: { id: `wamid.${evt}`, conversationId: `demo-conv-${sender}`, platform: "whatsapp", platformMessageId: `wamid.${evt}`, direction: "incoming", text: "hola vc", attachments: [], sender: { id: sender, name: "Zz Webhook Vista", username: null, picture: null }, sentAt: now, isRead: false }, conversation: { id: `demo-conv-${sender}`, platformConversationId: null, participantId: sender, participantName: "Zz Webhook Vista", participantUsername: null, participantPicture: null, status: "open" }, account: { id: "demo-whatsapp-001", platform: "whatsapp", username: "+51 900 000 000", displayName: "WhatsApp (Prueba)" } });
  const wh = await fetch(`${APP_URL}/api/webhooks/late`, { method: "POST", headers: { "content-type": "application/json", "x-late-signature": crypto.createHmac("sha256", secret).update(body).digest("hex") }, body });
  rec(wh.status === 200, "K webhook firmado (sin cookie) funciona mientras el Dueño mira", `status ${wh.status}`);
  await new Promise((r) => setTimeout(r, 2500));
  const created = await one("select c.id from public.contacts c join public.contact_channels cc on cc.contact_id=c.id where cc.platform_sender_id=$1", [sender]);
  rec(!!created, "K el webhook creó el contacto (escritura con service_role)");
  const badSig = await fetch(`${APP_URL}/api/webhooks/late`, { method: "POST", headers: { "content-type": "application/json", "x-late-signature": "deadbeef" }, body });
  rec(badSig.status === 401 || badSig.status === 403, "K webhook con firma mala sigue rechazado", `status ${badSig.status}`);
  for (const name of ["jobs", "sequences", "media-cleanup"]) {
    const c = await fetch(`${APP_URL}/api/cron/${name}`, { headers: { Authorization: "Bearer local-cron-secret" } });
    rec(c.status === 200, `K cron ${name} con su clave`, `status ${c.status}`);
  }
  const noKey = await fetch(`${APP_URL}/api/cron/jobs`);
  rec(noKey.status === 401 || noKey.status === 403, "K cron sin clave rechazado", `status ${noKey.status}`);
  const anonRead = await fetch(`${URL_API}/rest/v1/conversations?select=id`, { headers: { apikey: ANON } });
  rec(anonRead.status >= 400 && anonRead.status < 500, "K anon sigue sin leer (y la API no cae)", `status ${anonRead.status}`);
  const anonRoot = await fetch(`${URL_API}/rest/v1/`, { headers: { apikey: ANON } });
  rec(anonRoot.status < 500, "K la API responde a anon", `status ${anonRoot.status}`);
  const srvW = await svc.from("workspaces").update({ updated_at: new Date().toISOString() }).eq("id", ws).select("id");
  rec(!srvW.error, "K service_role escribe", srvW.error?.message);
  await stopHttp(s.setCookie);
}

await closeAllViews();
// Estado final de los datos de prueba
await q("update public.workspace_members set role = 'owner' where user_id = $1", [ids.owner]);
await q("update public.workspace_members set role = 'member' where user_id = $1", [ids.asesor2]);
rec((await one("select count(*)::int n from public.view_as_sessions where ended_at is null")).n === 0, "FIN ninguna vista quedó activa");
rec((await one("select count(*)::int n from crm_private.effective_workspace_members")).n === (await one("select count(*)::int n from public.workspace_members")).n, "FIN las membresías efectivas son las reales");

await finish(rows, fails, "view_as_attacks");
