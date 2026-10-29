// Ataques y regresiones de la migración 00031 contra una base LOCAL (supabase start)
// con los usuarios de prueba. Uso: node supabase/tests/rls_endurecer_attacks.mjs pre|post
// "pre" = antes de 00031 (los ataques funcionan), "post" = después (deben fallar).
// Variables: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SEED_IDS (json de seed.mjs).
// NO apuntar a producción: escribe y borra datos de prueba.
import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const phase = process.argv[2] || "post";
const ids = JSON.parse((await import("node:fs")).readFileSync(process.env.SEED_IDS ?? "seed-ids.json", "utf8"));
const WS = ids.workspace;
const svc = createClient(URL, SRK, { auth: { persistSession: false } });
async function as(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "Local12345!" });
  if (error) throw error;
  return c;
}
const asesor = await as("asesor@local.test");
const sup = await as("supervisor@local.test");
const admin = await as("admin@local.test");
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

let fails = 0;
const rows = [];
// attack: debe estar bloqueado en "post"; legit: debe funcionar siempre.
function rec(kind, name, ok, detail) {
  const good = kind === "attack" ? (phase === "post" ? !ok : true) : ok;
  if (!good) fails++;
  const label = kind === "attack" ? (ok ? "ATAQUE FUNCIONA" : "ataque bloqueado") : (ok ? "ok" : "FALLA");
  rows.push(`${good ? "PASS" : "FAIL"} [${kind}] ${name} -> ${label}${detail ? " (" + detail + ")" : ""}`);
}
const andrea = ids.contacts["Andrea Flores"], luis = ids.contacts["Luis Ccori"];
const { data: tmpC } = await svc.from("contacts").insert({ workspace_id: WS, display_name: "TMP destino" }).select().single();
const { data: convA } = await svc.from("conversations").select("*").eq("contact_id", andrea).single();
const { data: ccA } = await svc.from("contact_channels").select("*").eq("contact_id", andrea).single();

// ---- A-1
{
  const r = await asesor.from("contact_channels").update({ contact_id: luis }).eq("id", ccA.id).select();
  const moved = !r.error && (r.data?.length ?? 0) > 0;
  rec("attack", "A-1 asesor mueve contact_channels a otro contacto", moved, r.error?.message);
  await svc.from("contact_channels").update({ contact_id: andrea }).eq("id", ccA.id);
}
// ---- A-3
{
  const r = await asesor.from("conversations").update({ complaint_flagged_at: null, complaint_dismissed_at: "2099-01-01T00:00:00Z" }).eq("id", convA.id).select();
  rec("attack", "A-3 asesor limpia/descarta marca de reclamo", !r.error && r.data?.length > 0, r.error?.message);
  const r2 = await asesor.from("conversations").update({ contact_id: tmpC.id }).eq("id", convA.id).select();
  rec("attack", "A-3 asesor mueve conversacion a otro contacto", !r2.error && r2.data?.length > 0, r2.error?.message);
  const r3 = await asesor.from("conversations").update({ assigned_to: ids.users["asesor@local.test"], is_automation_paused: true }).eq("id", convA.id).select();
  rec("attack", "A-3 asesor cambia assigned_to / pausa bot", !r3.error && r3.data?.length > 0, r3.error?.message);
  const r4 = await asesor.from("conversations").update({ workspace_id: "00000000-0000-0000-0000-000000000000" }).eq("id", convA.id).select();
  rec("attack", "A-3 asesor cambia workspace_id", !r4.error && r4.data?.length > 0, r4.error?.message);
  const r5 = await admin.from("conversations").update({ status: "closed" }).eq("id", convA.id).select();
  rec("attack", "A-3 (admin tampoco por cliente) cambia status", !r5.error && r5.data?.length > 0, r5.error?.message);
  const r6 = await admin.from("conversations").insert({ workspace_id: WS, channel_id: convA.channel_id, contact_id: tmpC.id, platform: "whatsapp" }).select();
  rec("attack", "A-3 admin inserta conversacion desde el cliente", !r6.error && r6.data?.length > 0, r6.error?.message);
  if (r6.data?.[0]) await svc.from("conversations").delete().eq("id", r6.data[0].id);
  // restaurar
  await svc.from("conversations").update({ contact_id: andrea, workspace_id: WS, assigned_to: convA.assigned_to, is_automation_paused: convA.is_automation_paused, complaint_flagged_at: convA.complaint_flagged_at, complaint_dismissed_at: convA.complaint_dismissed_at, status: convA.status }).eq("id", convA.id);
  // legit
  await svc.from("conversations").update({ unread_count: 3 }).eq("id", convA.id);
  const l = await asesor.from("conversations").update({ unread_count: 0 }).eq("id", convA.id).select("unread_count");
  rec("legit", "asesor pone unread_count=0 al abrir el chat", !l.error && l.data?.[0]?.unread_count === 0, l.error?.message);
  const sel = await asesor.from("conversations").select("id, contact_id").eq("id", convA.id);
  rec("legit", "asesor lee su conversacion", !sel.error && sel.data?.length === 1);
}
// ---- M-1
{
  const { data: m } = await svc.from("messages").select("id, platform_message_id, conversation_id").eq("conversation_id", convA.id).not("platform_message_id", "is", null).limit(1);
  const pm = m?.[0]?.platform_message_id ?? "wamid.fake";
  const r = await asesor.from("messages").insert({ conversation_id: convA.id, direction: "outbound", text: "falso", platform_message_id: pm, status: "read", sent_by_user_id: ids.users["asesor@local.test"] }).select();
  rec("attack", "M-1 asesor inserta mensaje falso desde el cliente", !r.error && r.data?.length > 0, r.error?.message);
  await svc.from("messages").delete().eq("text", "falso");
  const u = await asesor.from("messages").update({ status: "failed" }).eq("conversation_id", convA.id).select();
  rec("attack", "M-1 asesor actualiza estado de mensajes", !u.error && u.data?.length > 0, u.error?.message);
  const rd = await asesor.from("messages").select("id").eq("conversation_id", convA.id).limit(5);
  rec("legit", "asesor lee mensajes de su chat", !rd.error && (rd.data?.length ?? 0) > 0);
  // servidor (service) sigue escribiendo
  const s = await svc.from("messages").insert({ conversation_id: convA.id, direction: "outbound", text: "svc", status: "pending", sent_by_user_id: ids.users["asesor@local.test"], platform_message_id: "svc-1" }).select();
  rec("legit", "servidor (service_role) registra mensaje", !s.error && s.data?.length > 0, s.error?.message);
  await svc.from("messages").delete().eq("text", "svc");
}
// ---- B-1
{
  const { data: c0 } = await svc.from("contacts").select("*").eq("id", andrea).single();
  const r = await asesor.from("contacts").update({ is_subscribed: false, display_name: "Hackeado" }).eq("id", andrea).select();
  rec("attack", "B-1 asesor edita contacto (is_subscribed, nombre)", !r.error && r.data?.length > 0, r.error?.message);
  await svc.from("contacts").update({ is_subscribed: c0.is_subscribed, display_name: c0.display_name }).eq("id", andrea);
  const t = await asesor.from("contact_tags").insert({ contact_id: andrea, tag_id: "00000000-0000-0000-0000-000000000000" });
  rec("attack", "B-1 asesor inserta contact_tags", !t.error, t.error?.message);
  const rd = await asesor.from("contacts").select("id").eq("id", andrea);
  rec("legit", "asesor lee contacto que ve", rd.data?.length === 1);
}
// ---- B-2
{
  const r = await asesor.from("analytics_events").insert({ workspace_id: WS, event_type: "message_sent" }).select();
  rec("attack", "B-2 asesor inserta analytics_events", !r.error && r.data?.length > 0, r.error?.message);
  await svc.from("analytics_events").delete().eq("workspace_id", WS).eq("event_type", "message_sent").is("contact_id", null).is("flow_id", null);
  const ra = await asesor.from("analytics_events").select("id").eq("workspace_id", WS).limit(1);
  rec("attack", "B-2 asesor lee analytics_events", (ra.data?.length ?? 0) > 0);
  const rs = await sup.from("analytics_events").select("id", { count: "exact", head: true }).eq("workspace_id", WS);
  rec("legit", "supervisor lee analytics_events (Metricas)", !rs.error, `count=${rs.count}`);
  const rd = await admin.from("analytics_events").select("id", { count: "exact", head: true }).eq("workspace_id", WS);
  rec("legit", "admin lee analytics_events", !rd.error, `count=${rd.count}`);
  await svc.from("comment_logs").select("id").limit(1);
  const rc = await asesor.from("comment_logs").select("id").limit(1);
  rec("legit", "comment_logs: asesor sin error (0 filas)", !rc.error);
}
// ---- B-3
{
  const { count } = await svc.from("workspace_invites").select("id", { count: "exact", head: true });
  if (!count) await svc.from("workspace_invites").insert({ workspace_id: WS, email: "x@local.test", role: "member", invited_by: ids.users["admin@local.test"], status: "pending" });
  const r = await asesor.from("workspace_invites").select("id");
  rec("attack", "B-3 asesor lee invitaciones", (r.data?.length ?? 0) > 0);
  const u = await asesor.from("workspace_invites").update({ role: "admin" }).eq("workspace_id", WS).select();
  rec("attack", "B-3 asesor actualiza invitaciones", !u.error && u.data?.length > 0, u.error?.message);
  const ra = await admin.from("workspace_invites").select("id");
  rec("legit", "admin lee invitaciones", !ra.error && (ra.data?.length ?? 0) > 0, ra.error?.message);
  await svc.from("workspace_invites").delete().eq("email", "x@local.test");
}
// ---- A-2
{
  const { data: media } = await svc.from("message_media").select("storage_path").limit(1);
  let victim = media?.[0]?.storage_path;
  if (!victim) {
    victim = `${WS}/conv/${convA.id}/in/11111111-1111-4111-8111-111111111111.png`;
  }
  const r = await asesor.from("saved_replies").insert({ workspace_id: WS, scope: "personal", user_id: ids.users["asesor@local.test"], title: "evil", body: "x", attachment_url: victim, attachment_name: "x", created_by: ids.users["asesor@local.test"] }).select();
  rec("attack", "A-2 asesor crea respuesta personal con adjunto = ruta de un chat", !r.error && r.data?.length > 0, r.error?.message);
  if (r.data?.[0]) await svc.from("saved_replies").delete().eq("id", r.data[0].id);
  // ruta de otro espacio / traversal, incluso desde servidor (check)
  const bad = await svc.from("saved_replies").insert({ workspace_id: WS, scope: "workspace", title: "badpath", body: "x", attachment_url: `${WS}/conv/${convA.id}/in/11111111-1111-4111-8111-111111111111.png` }).select();
  rec("attack", "A-2 incluso el servidor no puede guardar ruta fuera de replies/ (CHECK)", !bad.error, bad.error?.message);
  if (bad.data?.[0]) await svc.from("saved_replies").delete().eq("id", bad.data[0].id);

  // flujo legitimo: crear respuesta personal sin archivo, subir archivo con enlace firmado, registrar adjunto con service
  const ins = await asesor.from("saved_replies").insert({ workspace_id: WS, scope: "personal", user_id: ids.users["asesor@local.test"], title: "con archivo", body: "hola", created_by: ids.users["asesor@local.test"] }).select().single();
  rec("legit", "asesor crea respuesta personal (sin adjunto)", !ins.error, ins.error?.message);
  const path = `${WS}/replies/22222222-2222-4222-8222-222222222222.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
  const signed = await svc.storage.from("chat-media").createSignedUploadUrl(path);
  rec("legit", "servidor crea enlace de subida firmado", !signed.error, signed.error?.message);
  if (!signed.error) {
    // el navegador sube con el token (cliente del asesor)
    const up = await asesor.storage.from("chat-media").uploadToSignedUrl(path, signed.data.token, png, { contentType: "image/png" });
    rec("legit", "asesor sube archivo con enlace firmado", !up.error, up.error?.message);
    const att = await svc.from("saved_replies").update({ attachment_url: path, attachment_name: "x.png", attachment_mime: "image/png", attachment_size: png.length }).eq("id", ins.data.id).select();
    rec("legit", "servidor registra el adjunto de la respuesta", !att.error && att.data?.length === 1, att.error?.message);
    const sel = await asesor.from("saved_replies").select("attachment_url").eq("id", ins.data.id).single();
    rec("legit", "asesor lee su respuesta con adjunto", sel.data?.attachment_url === path);
    const upd = await asesor.from("saved_replies").update({ title: "con archivo 2", body: "hola 2" }).eq("id", ins.data.id).select();
    rec("legit", "asesor edita titulo/texto de su respuesta", !upd.error && upd.data?.length === 1, upd.error?.message);
    const tamper = await asesor.from("saved_replies").update({ attachment_url: victim }).eq("id", ins.data.id).select();
    rec("attack", "A-2 asesor cambia attachment_url de su respuesta", !tamper.error && tamper.data?.length > 0, tamper.error?.message);
    const dup = await svc.from("saved_replies").insert({ workspace_id: WS, scope: "workspace", title: "dup", body: "x", attachment_url: path }).select();
    rec("attack", "A-2 mismo archivo en dos respuestas (indice unico)", !dup.error, dup.error?.message);
    if (dup.data?.[0]) await svc.from("saved_replies").delete().eq("id", dup.data[0].id);
    const del = await asesor.from("saved_replies").delete().eq("id", ins.data.id).select();
    rec("legit", "asesor borra su respuesta", !del.error && del.data?.length === 1, del.error?.message);
    // acceso directo de storage
    const dl = await asesor.storage.from("chat-media").download(path);
    rec("attack", "storage: asesor descarga directo del bucket", !dl.error, dl.error?.message);
    const rm = await asesor.storage.from("chat-media").remove([path]);
    const still = await svc.storage.from("chat-media").info(path);
    rec("attack", "storage: asesor borra directo del bucket", !still.data, "");
    const ls = await asesor.storage.from("chat-media").list(`${WS}/replies`);
    rec("attack", "storage: asesor lista el bucket", (ls.data?.length ?? 0) > 0, ls.error?.message);
    await svc.storage.from("chat-media").remove([path]);
  }
}
// ---- A-4
{
  const mk = async (ws, id) => svc.from("channels").insert({ workspace_id: ws, platform: "whatsapp", late_account_id: id, is_active: true }).select().single();
  const c1 = await mk(WS, "acc_real_test_1");
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "Otro", slug: "otro-" + Date.now() }).select().single();
  const c2 = await mk(ws2.id, "acc_real_test_1");
  rec("attack", "A-4 segundo espacio registra el mismo late_account_id", !c2.error, c2.error?.code + " " + (c2.error?.message ?? ""));
  const d1 = await mk(ws2.id, "demo-whatsapp-001");
  rec("legit", "canal demo con el mismo id en otro espacio sigue permitido", !d1.error, d1.error?.message);
  const d2 = await mk(WS, "acc_real_test_1");
  rec("attack", "A-4 duplicado dentro del mismo espacio", !d2.error);
  await svc.from("channels").delete().eq("workspace_id", ws2.id);
  await svc.from("channels").delete().eq("late_account_id", "acc_real_test_1");
  await svc.from("workspaces").delete().eq("id", ws2.id);
}
// ---- B-4
{
  const a = await anon.rpc("is_ws_admin", { ws: WS });
  rec("attack", "B-4 anon llama is_ws_admin", !a.error, a.error?.message);
  const b = await anon.rpc("can_see_contact", { contact_id: andrea });
  rec("attack", "B-4 anon llama can_see_contact", !b.error, b.error?.message);
  const c = await asesor.rpc("rls_auto_enable");
  rec("attack", "B-4 asesor llama rls_auto_enable", !c.error, c.error?.message);
  const d = await asesor.rpc("increment_unread", { conv_id: convA.id, preview: "x" });
  rec("attack", "B-4 asesor llama increment_unread", !d.error, d.error?.message);
  const e = await asesor.rpc("is_ws_admin", { ws: WS });
  rec("legit", "authenticated puede llamar is_ws_admin (politicas)", !e.error && e.data === false, e.error?.message);
  const f = await anon.from("conversations").select("id").limit(1);
  rec("attack", "B-4 anon lee conversations", !f.error && (f.data?.length ?? 0) > 0, f.error?.message);
}
await svc.from("contacts").delete().eq("id", tmpC.id);
console.log(rows.join("\n"));
console.log(`\nfase=${phase} fallas=${fails}`);
process.exit(fails ? 1 : 0);
