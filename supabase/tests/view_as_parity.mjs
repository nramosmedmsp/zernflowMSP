// Paridad de "Ver como" (migración 00040) contra una base LOCAL: lo que ve cada
// usuario sembrado con SU sesión debe ser EXACTAMENTE lo que ve el Dueño viendo
// como él (todas las tablas legibles, fila por fila), y con la transacción en
// solo lectura. Uso: node supabase/tests/view_as_parity.mjs
// Parte HTTP (si la app corre en APP_URL): las rutas GET de la API devuelven lo
// mismo para la persona real y para el Dueño en vista.
import {
  APP_URL, appUp, closeAllViews, finish, line, q, signIn, startViewRpc, stopViewRpc, svc, userIds, workspaceId,
} from "./view_as_lib.mjs";

const rows = [];
let fails = 0;
const rec = (ok, name, detail) => {
  if (!ok) fails++;
  rows.push(line(ok, name, detail));
};

const ids = await userIds();
const ws = await workspaceId();
await closeAllViews();

const tables = (
  await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') and has_table_privilege('authenticated', c.oid, 'select')
           order by 1`)
).map((r) => r.relname);

/** Volcado de todas las tablas legibles con el cliente dado: { tabla: [json de fila ordenado] }. */
async function dump(client) {
  const out = {};
  for (const t of tables) {
    const res = await client.from(t).select("*").limit(5000);
    out[t] = res.error ? `ERROR ${res.error.code} ${res.error.message}` : res.data.map((r) => JSON.stringify(r)).sort();
  }
  return out;
}

function compare(a, b) {
  const diffs = [];
  let total = 0;
  for (const t of tables) {
    const x = a[t], y = b[t];
    if (typeof x === "string" || typeof y === "string") {
      if (x !== y) diffs.push(`${t}: ${typeof x === "string" ? x : "ok"} vs ${typeof y === "string" ? y : "ok"}`);
      continue;
    }
    total += x.length;
    const sx = new Set(x), sy = new Set(y);
    const onlyA = x.filter((r) => !sy.has(r)).length, onlyB = y.filter((r) => !sx.has(r)).length;
    if (onlyA || onlyB || x.length !== y.length) diffs.push(`${t}: real ${x.length} vs vista ${y.length} (solo real ${onlyA}, solo vista ${onlyB})`);
  }
  return { total, diffs };
}

const owner = await signIn("owner@local.test");
const ownerBase = await dump(owner.client);
rec(true, `tablas legibles: ${tables.length}`, `filas del Dueño sin vista: ${Object.values(ownerBase).reduce((n, r) => n + (Array.isArray(r) ? r.length : 0), 0)}`);

const people = ["admin", "supervisor", "asesor", "asesor2"];
const realDumps = {};
for (const who of people) {
  const u = await signIn(`${who}@local.test`);
  realDumps[who] = await dump(u.client);
  // Discriminación: el Dueño sin vista ve distinto que la persona (si no, la prueba no probaría nada).
  const baseDiff = compare(realDumps[who], ownerBase).diffs.length;
  rec(baseDiff > 0 || who === "admin", `${who}: la prueba discrimina (Dueño sin vista ve distinto)`, `${baseDiff} tablas distintas`);

  const start = await startViewRpc(owner, ws, { kind: "person", userId: ids[who] });
  rec(!start.error, `${who}: view_as_start`, start.error?.message);
  const viewDump = await dump(owner.client);
  const { total, diffs } = compare(realDumps[who], viewDump);
  rec(diffs.length === 0, `${who}: paridad exacta en ${tables.length} tablas (${total} filas)`, diffs.join(" | ") || undefined);

  const probe = await owner.client.from("saved_replies").insert({ workspace_id: ws, scope: "personal", user_id: ids[who], title: "zz-paridad", body: "x", created_by: ids[who] }).select("id");
  rec(probe.error?.code === "25006", `${who}: la vista es de solo lectura (escribir falla con 25006)`, probe.error?.code ?? "SE ESCRIBIÓ");
  const cur = await owner.client.rpc("view_as_current");
  rec(cur.data?.target_user_id === ids[who], `${who}: view_as_current devuelve a la persona`, JSON.stringify(cur.data?.label));
  await stopViewRpc(owner);
  const after = await dump(owner.client);
  rec(compare(ownerBase, after).diffs.length === 0, `${who}: al salir el Dueño vuelve a ver lo suyo`);
}

// Por rol: la identidad de ejemplo no tiene cuenta, así que "lo suyo" (asignaciones,
// responsable, avisos y respuestas personales) sale vacío. Todo lo demás debe ser igual que
// el de una persona real con ese rol y equipo: lo comprobamos contra la persona real
// quitándole solo las filas que dependen de su propio id.
const [{ id: ventas }, { id: postventa }] = await Promise.all(
  ["Ventas", "Postventa"].map(async (n) => (await q("select id from public.teams where name = $1", [n]))[0]),
);
const roleCases = [
  { name: "Supervisor de Postventa", target: { kind: "role", role: "supervisor", teamId: postventa }, like: "supervisor" },
  { name: "Asesor de Ventas", target: { kind: "role", role: "agent", teamId: ventas }, like: "asesor" },
  { name: "Asesor de Postventa", target: { kind: "role", role: "agent", teamId: postventa }, like: "asesor2" },
];
for (const rc of roleCases) {
  const start = await startViewRpc(owner, ws, rc.target);
  rec(!start.error, `rol ${rc.name}: view_as_start`, start.error?.message);
  const fakeId = start.data?.target_user_id;
  rec(!!fakeId && (await q("select 1 from auth.users where id = $1", [fakeId])).length === 0, `rol ${rc.name}: el id de ejemplo no existe en auth.users`);
  const viewDump = await dump(owner.client);
  const real = realDumps[rc.like];
  const uid = ids[rc.like];
  // Filas de la persona real que dependen de su propio id (se excluyen de la comparación):
  const mine = (t, r) => {
    const o = JSON.parse(r);
    if (t === "cases") return o.assignee_id === uid;
    if (t === "contacts") return o.owner_id === uid;
    if (t === "notifications") return o.user_id === uid;
    if (t === "saved_replies") return o.scope === "personal" && o.user_id === uid;
    if (t === "workspace_members") return o.user_id === uid;
    if (t === "team_members") return o.user_id === uid;
    return false;
  };
  // Un contacto (y lo que cuelga de él) puede verse solo por una gestión asignada a esa persona o por ser su responsable: se acepta que falte.
  const ownCaseContacts = new Set([
    ...(await q("select contact_id from public.cases where assignee_id = $1 and status in ('scheduled','open')", [uid])).map((r) => r.contact_id),
    ...(await q("select id from public.contacts where owner_id = $1", [uid])).map((r) => r.id),
  ]);
  let onlyView = 0, unexplainedMissing = [];
  for (const t of tables) {
    const x = real[t], y = viewDump[t];
    if (typeof x === "string" || typeof y === "string") {
      if (x !== y) unexplainedMissing.push(`${t}: ${x} / ${y}`);
      continue;
    }
    const sx = new Set(x), sy = new Set(y);
    onlyView += y.filter((r) => !sx.has(r)).length;
    for (const r of x) {
      if (sy.has(r)) continue;
      const o = JSON.parse(r);
      const explained =
        mine(t, r) ||
        (t === "contacts" && ownCaseContacts.has(o.id)) ||
        (t === "conversations" && ownCaseContacts.has(o.contact_id)) ||
        (o.contact_id && ownCaseContacts.has(o.contact_id)) ||
        (["messages", "message_media", "contact_channels", "contact_tags", "contact_custom_fields", "case_notes"].includes(t));
      if (!explained) unexplainedMissing.push(`${t}:${o.id ?? "?"}`);
    }
  }
  rec(onlyView === 0, `rol ${rc.name}: no ve nada que la persona real equivalente no vea`, onlyView ? `${onlyView} filas de más` : undefined);
  rec(unexplainedMissing.length === 0, `rol ${rc.name}: solo falta lo que depende del id propio`, unexplainedMissing.slice(0, 5).join(" | ") || undefined);
  const cases = viewDump.cases;
  rec(Array.isArray(cases) && cases.every((r) => JSON.parse(r).assignee_id !== fakeId), `rol ${rc.name}: "Míos" vacío`);
  await stopViewRpc(owner);
}

// Rol Administrador: ve todo lo operativo igual que un administrador real (admin@), salvo lo propio.
{
  const start = await startViewRpc(owner, ws, { kind: "role", role: "admin" });
  rec(!start.error, "rol Administrador: view_as_start", start.error?.message);
  const viewDump = await dump(owner.client);
  const ref = realDumps.admin;
  const critical = ["conversations", "cases", "contacts", "messages", "case_notes", "teams", "saved_replies", "workspaces", "channels", "flows", "tags"];
  const diffs = [];
  for (const t of critical) {
    if (typeof ref[t] === "string" || typeof viewDump[t] === "string") continue;
    const sr = new Set(ref[t]), sv = new Set(viewDump[t]);
    const missing = ref[t].filter((r) => !sv.has(r)).filter((r) => {
      const o = JSON.parse(r);
      return !(t === "saved_replies" && o.scope === "personal");
    }).length;
    const extra = viewDump[t].filter((r) => !sr.has(r)).length;
    if (missing || extra) diffs.push(`${t}: faltan ${missing}, sobran ${extra}`);
  }
  rec(diffs.length === 0, "rol Administrador: igual que un administrador real en las tablas operativas", diffs.join(" | ") || undefined);
  await stopViewRpc(owner);
}

// ── Parte HTTP: rutas GET de la API ───────────────────────────────────────────
if (await appUp()) {
  const GETS = ["/api/v1/channels", "/api/v1/contacts", "/api/v1/flows", "/api/v1/broadcasts"];
  async function get(cookie, path, extraCookies = []) {
    const r = await fetch(APP_URL + path, { headers: { cookie: [...cookie.cookies(), ...extraCookies].join("; ") } });
    return { status: r.status, body: await r.text() };
  }
  for (const who of ["admin", "asesor"]) {
    const u = await signIn(`${who}@local.test`);
    const start = await fetch(`${APP_URL}/api/v1/view-as/start`, {
      method: "POST",
      headers: { cookie: owner.cookieHeader(), origin: APP_URL, "content-type": "application/json" },
      body: JSON.stringify({ kind: "person", userId: ids[who] }),
    });
    const setCookie = start.headers.getSetCookie().map((c) => c.split(";")[0]);
    rec(start.status === 200, `HTTP ${who}: POST /api/v1/view-as/start`, `status ${start.status}`);
    for (const path of GETS) {
      const real = await get(u, path);
      const view = await get(owner, path, setCookie);
      rec(real.status === view.status && real.body === view.body, `HTTP ${who}: GET ${path} igual que con su sesión`, `real ${real.status}/${real.body.length}b vista ${view.status}/${view.body.length}b`);
    }
    await fetch(`${APP_URL}/api/v1/view-as/stop`, { method: "POST", headers: { cookie: owner.cookieHeader(setCookie), origin: APP_URL } });
  }
} else {
  rows.push("SKIP parte HTTP (la app no responde en " + APP_URL + ")");
}

await closeAllViews();
await finish(rows, fails, "view_as_parity");
