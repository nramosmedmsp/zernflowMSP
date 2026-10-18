#!/usr/bin/env node
/**
 * Datos de prueba del CRM: carga y borra un conjunto de datos de ejemplo
 * (asesores, equipos, canales de prueba, contactos, conversaciones, gestiones,
 * notas, avisos, respuestas guardadas y una difusión) para revisar todas las
 * funciones sin un canal real conectado.
 *
 * Uso:
 *   node scripts/datos-prueba.mjs cargar [--espacio=<id>]
 *   node scripts/datos-prueba.mjs borrar [--espacio=<id>]
 *
 * Usa NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env (como
 * scripts/smoke-test.mjs) y trabaja sobre el único espacio de trabajo; si hay
 * más de uno, exige --espacio=<id>. ESTE SCRIPT ESCRIBE EN LA BASE QUE APUNTE
 * .env: si es producción, es producción.
 *
 * Qué queda marcado: nombres con " (Prueba)", correos @prueba.invalid, canales
 * con late_account_id "demo-..." y los ids creados en
 * workspaces.settings.demo_data. `borrar` elimina exactamente eso (y lo que
 * cuelga en cascada) y deja settings como estaba.
 *
 * Lo único que cambia fuera de lo marcado (se restaura al borrar):
 *   - case_types "Postventa": routing = fixed_team hacia "Atención (Prueba)".
 *     El valor anterior queda en demo_data.restore.
 * Efectos colaterales a tener en cuenta:
 *   - Al crear equipos, el espacio pasa a "tener equipos": el reparto de
 *     gestiones reales usa los equipos y sus miembros mientras haya datos de
 *     prueba cargados.
 *   - El cron de la app (cada minuto) reparte las gestiones abiertas sin
 *     asignar y activa las recompras programadas cuando les toca.
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  ADVISORS,
  BROADCAST,
  CASES,
  CHANNELS,
  CONTACTS,
  CONVERSATIONS,
  DEMO_CHANNEL_PREFIX,
  DEMO_DATA_KEY,
  DEMO_TAG_NAME,
  NOTES,
  NOTIFICATIONS,
  ROUTING_OVERRIDES,
  SAVED_REPLIES,
  TEAMS,
  agoIso,
  buildCase,
  buildContact,
  buildConversation,
  chunk,
  contactDisplayName,
  contactSenderId,
  deletionPlan,
  emptyDemoData,
  fillNames,
  hasDemoData,
  keyDatesByContact,
  markerProblems,
  savedReplyTitle,
  withContactTypeChanges,
  withDemoData,
  withoutDemoData,
} from "./datos-prueba-lib.mjs";

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
    const val = trimmed.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = val;
  }
}

class ScriptError extends Error {}
const fail = (message) => {
  throw new ScriptError(message);
};
const step = (message) => console.log(`- ${message}`);

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--"));
const workspaceArg = args.find((a) => a.startsWith("--espacio="))?.slice("--espacio=".length) ?? null;

if (command !== "cargar" && command !== "borrar") {
  console.log("Uso: node scripts/datos-prueba.mjs cargar|borrar [--espacio=<id>]");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!SUPABASE_URL) {
  console.error("\nERROR: Falta NEXT_PUBLIC_SUPABASE_URL en .env.\n");
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error("\nERROR: Falta SUPABASE_SERVICE_ROLE_KEY en .env.\n");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ── Ayudas de base de datos ────────────────────────────────────────────────

function must({ data, error }, what) {
  if (error) fail(`${what}: ${error.message}`);
  return data;
}

async function chooseWorkspace() {
  const rows = must(await db.from("workspaces").select("id, name, settings").order("created_at"), "No se pudieron leer los espacios");
  if (rows.length === 0) fail("No hay ningún espacio de trabajo.");
  if (workspaceArg) {
    const found = rows.find((w) => w.id === workspaceArg);
    if (!found) fail(`No existe un espacio con id "${workspaceArg}".`);
    return found;
  }
  if (rows.length > 1) {
    const list = rows.map((w) => `  - ${w.name}: ${w.id}`).join("\n");
    fail(`Hay ${rows.length} espacios. Indica uno con --espacio=<id>:\n${list}`);
  }
  return rows[0];
}

/** Guarda demo_data en workspaces.settings releyendo settings para no pisar otros cambios. */
async function saveDemoData(workspaceId, demoData) {
  const { data, error } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  if (error) fail(`No se pudo leer settings: ${error.message}`);
  const next = withDemoData(data.settings, demoData);
  const res = await db.from("workspaces").update({ settings: next }).eq("id", workspaceId);
  if (res.error) fail(`No se pudo guardar demo_data: ${res.error.message}`);
}

async function insertMany(table, rows, select = "id") {
  const out = [];
  for (const part of chunk(rows, 200)) {
    out.push(...must(await db.from(table).insert(part).select(select), `Insertar en ${table}`));
  }
  return out;
}

async function countWhere(table, column, ids) {
  if (ids.length === 0) return 0;
  let total = 0;
  for (const part of chunk(ids, 100)) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).in(column, part);
    if (error) fail(`Contar ${table}: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

// ── cargar ─────────────────────────────────────────────────────────────────

async function loadCatalog(workspaceId) {
  const types = must(
    await db.from("case_types").select("id, name, routing, fixed_team_id").eq("workspace_id", workspaceId).is("archived_at", null),
    "No se pudieron leer los tipos de gestión",
  );
  const typeIds = types.map((t) => t.id);
  const [stages, categories, reasons, contactTypes] = await Promise.all([
    db.from("case_stages").select("id, case_type_id, name, kind, position").in("case_type_id", typeIds).is("archived_at", null).order("position"),
    db.from("case_categories").select("id, case_type_id, name").in("case_type_id", typeIds).is("archived_at", null),
    db.from("case_outcome_reasons").select("id, case_type_id, name").in("case_type_id", typeIds).is("archived_at", null),
    db.from("contact_types").select("id, name").eq("workspace_id", workspaceId).is("archived_at", null),
  ]);
  return {
    types,
    stages: must(stages, "No se pudieron leer las etapas"),
    categories: must(categories, "No se pudieron leer las categorías"),
    reasons: must(reasons, "No se pudieron leer los motivos"),
    contactTypes: must(contactTypes, "No se pudieron leer los tipos de contacto"),
  };
}

function catalogResolvers(catalog) {
  const typeByName = new Map(catalog.types.map((t) => [t.name, t]));
  const contactTypeByName = new Map(catalog.contactTypes.map((t) => [t.name, t.id]));
  const lookup = (map, key, what) => {
    const value = map.get(key);
    if (!value) fail(`Falta ${what} en la configuración. Aplica antes la plantilla de negocio E-commerce (Configuración → Gestiones).`);
    return value;
  };
  const typeOf = (name) => lookup(typeByName, name, `el tipo de gestión "${name}"`);
  const child = (list, typeName, name, what) => {
    const t = typeOf(typeName);
    const found = list.find((x) => x.case_type_id === t.id && x.name === name);
    if (!found) fail(`Falta ${what} "${name}" en el tipo "${typeName}". Aplica antes la plantilla E-commerce.`);
    return found.id;
  };
  return {
    typeOf,
    contactType: (name) => lookup(contactTypeByName, name, `el tipo de contacto "${name}"`),
    type: (name) => typeOf(name).id,
    stage: (typeName, name) => child(catalog.stages, typeName, name, "la etapa"),
    category: (typeName, name) => child(catalog.categories, typeName, name, "la categoría"),
    reason: (typeName, name) => child(catalog.reasons, typeName, name, "el motivo"),
    openStages: (typeName) => {
      const t = typeOf(typeName);
      return catalog.stages.filter((s) => s.case_type_id === t.id && s.kind === "open").sort((a, b) => a.position - b.position).map((s) => s.name);
    },
  };
}

async function cargar() {
  const problems = markerProblems();
  if (problems.length) fail(`Datos de prueba sin marcar (error del script):\n${problems.join("\n")}`);

  const workspace = await chooseWorkspace();
  console.log(`\nCargar datos de prueba en "${workspace.name}" (${workspace.id})`);
  console.log(`Base: ${SUPABASE_URL}\n`);

  if (hasDemoData(workspace.settings)) {
    fail(
      "Ya hay datos de prueba cargados (workspaces.settings.demo_data). Ejecuta primero:\n  node scripts/datos-prueba.mjs borrar" +
        (workspaceArg ? ` --espacio=${workspaceArg}` : ""),
    );
  }
  const strayChannels = must(
    await db.from("channels").select("id").eq("workspace_id", workspace.id).like("late_account_id", `${DEMO_CHANNEL_PREFIX}%`),
    "No se pudieron leer los canales",
  );
  if (strayChannels.length > 0) {
    fail(`Hay ${strayChannels.length} canal(es) demo-... sin registro en demo_data. Revísalos o bórralos a mano antes de cargar.`);
  }

  const catalog = await loadCatalog(workspace.id);
  const cat = catalogResolvers(catalog);
  // Comprobación temprana de todos los nombres que usan los datos.
  for (const c of CASES) {
    if (!c.type) continue;
    cat.type(c.type);
    if (c.stage) cat.stage(c.type, c.stage);
    if (c.reached) cat.stage(c.type, c.reached);
    if (c.category) cat.category(c.type, c.category);
    if (c.reason) cat.reason(c.type, c.reason);
  }
  for (const c of CONTACTS) cat.contactType(c.type);

  // Dueño (autor de notas y destinatario de avisos).
  const owners = must(
    await db.from("workspace_members").select("user_id, role, created_at").eq("workspace_id", workspace.id).in("role", ["owner", "admin"]).order("created_at"),
    "No se pudieron leer los miembros",
  );
  const owner = owners.find((m) => m.role === "owner") ?? owners[0];
  if (!owner) fail("El espacio no tiene Dueño ni Administrador.");
  const { data: ownerAuth } = await db.auth.admin.getUserById(owner.user_id);
  const ownerName =
    ownerAuth?.user?.user_metadata?.full_name?.trim() || ownerAuth?.user?.user_metadata?.name?.trim() || ownerAuth?.user?.email?.split("@")[0] || "Dueño";

  const now = new Date();
  const dd = emptyDemoData(now);
  const created = {
    asesores: 0,
    equipos: 0,
    canales: 0,
    contactos: 0,
    conversaciones: 0,
    mensajes: 0,
    gestiones: 0,
    actividad: 0,
    notas: 0,
    notificaciones: 0,
    respuestas: 0,
    difusiones: 0,
    etiquetas: 0,
  };
  const warnings = [];

  // Registro previo: si algo falla a medias, `borrar` sabe qué limpiar.
  await saveDemoData(workspace.id, dd);
  const save = () => saveDemoData(workspace.id, dd);

  try {
    // 1. Equipos
    step("Creando equipos...");
    const existingDefault = must(
      await db.from("teams").select("id").eq("workspace_id", workspace.id).eq("is_default", true).is("archived_at", null),
      "No se pudieron leer los equipos",
    );
    const teamIds = {};
    for (const t of TEAMS) {
      const makeDefault = t.wantsDefault && existingDefault.length === 0;
      if (t.wantsDefault && !makeDefault) {
        warnings.push(`Ya hay un equipo por defecto: "${t.name}" se creó sin ser el predeterminado.`);
      }
      const row = must(
        await db
          .from("teams")
          .insert({ workspace_id: workspace.id, name: t.name, is_default: makeDefault, assignment_mode: t.assignment_mode })
          .select("id")
          .single(),
        `Crear el equipo ${t.name}`,
      );
      teamIds[t.key] = row.id;
      dd.team_ids.push(row.id);
      created.equipos++;
    }
    await save();

    // 2. Asesores (usuarios de Auth sin contraseña: no pueden iniciar sesión)
    step("Creando asesores...");
    const advisorIds = {};
    for (const a of ADVISORS) {
      const invite = must(
        await db
          .from("workspace_invites")
          .insert({ workspace_id: workspace.id, email: a.email, role: "member", invited_by: owner.user_id, status: "pending" })
          .select("id")
          .single(),
        `Invitación pendiente de ${a.email}`,
      );
      dd.invite_ids.push(invite.id);
      await save();
      const { data: auth, error: authError } = await db.auth.admin.createUser({
        email: a.email,
        email_confirm: false,
        user_metadata: { full_name: a.name },
      });
      if (authError || !auth?.user) fail(`No se pudo crear el usuario ${a.email}: ${authError?.message ?? "sin respuesta"}`);
      advisorIds[a.key] = auth.user.id;
      dd.user_ids.push(auth.user.id);
      await save();
      must(
        await db.from("workspace_members").insert({ workspace_id: workspace.id, user_id: auth.user.id, role: "member", availability: a.availability }),
        `Membresía de ${a.email}`,
      );
      must(
        await db.from("team_members").insert({ team_id: teamIds[a.team], user_id: auth.user.id, role: a.teamRole, case_type_ids: null }),
        `Miembro de equipo ${a.email}`,
      );
      await db.from("workspace_invites").update({ status: "accepted" }).eq("id", invite.id);
      created.asesores++;
    }

    // 3. Canales de prueba
    step("Creando canales de prueba...");
    const channelIds = {};
    for (const c of CHANNELS) {
      const row = must(
        await db
          .from("channels")
          .insert({
            workspace_id: workspace.id,
            platform: c.platform,
            late_account_id: c.late_account_id,
            display_name: c.display_name,
            username: c.username,
            is_active: true,
          })
          .select("id")
          .single(),
        `Crear el canal ${c.display_name}`,
      );
      channelIds[c.key] = row.id;
      dd.channel_ids.push(row.id);
      created.canales++;
    }
    await save();

    // 4. Etiquetas (se reutilizan las existentes; solo se borran las que se crean aquí)
    step("Preparando etiquetas...");
    const tagNames = [...new Set([DEMO_TAG_NAME, ...CONTACTS.flatMap((c) => c.tags)])];
    const existingTags = must(await db.from("tags").select("id, name").eq("workspace_id", workspace.id).in("name", tagNames), "No se pudieron leer las etiquetas");
    const tagIds = new Map(existingTags.map((t) => [t.name, t.id]));
    for (const name of tagNames) {
      if (tagIds.has(name)) continue;
      const row = must(await db.from("tags").insert({ workspace_id: workspace.id, name }).select("id").single(), `Crear la etiqueta ${name}`);
      tagIds.set(name, row.id);
      dd.tag_ids.push(row.id);
      created.etiquetas++;
    }
    await save();

    // 5. Contactos
    step("Creando contactos...");
    const ids = {
      ...cat,
      advisor: (key) => advisorIds[key],
      team: (key) => teamIds[key],
      contact: (key) => contactIds[key],
    };
    const fullCases = withContactTypeChanges(CASES);
    const keyDates = keyDatesByContact(CASES, now);
    const contactIds = {};
    const interactionAgo = (key) => {
      const conv = CONVERSATIONS.find((c) => c.contact === key);
      const mins = conv ? Math.min(...conv.messages.map((m) => m[2])) : null;
      const caseAgo = CASES.filter((c) => c.contact === key).map((c) => c.closedAgo ?? c.openedAgo ?? 60 * 24);
      return mins ?? (caseAgo.length ? Math.min(...caseAgo) : 60);
    };
    const contactRows = CONTACTS.map((c, i) =>
      buildContact(c, i, {
        now,
        workspaceId: workspace.id,
        ids,
        keyDates,
        lastInteractionAgo: interactionAgo(c.key),
        firstCaseAgo: Math.max(30 * 1440, ...CASES.filter((x) => x.contact === c.key).map((x) => x.openedAgo ?? x.createdAgo ?? 0)),
      }),
    );
    const inserted = await insertMany("contacts", contactRows, "id, display_name");
    for (const c of CONTACTS) {
      const row = inserted.find((r) => r.display_name === contactDisplayName(c));
      if (!row) fail(`No se creó el contacto ${contactDisplayName(c)}.`);
      contactIds[c.key] = row.id;
      dd.contact_ids.push(row.id);
    }
    created.contactos = inserted.length;
    await save();

    await insertMany(
      "contact_channels",
      CONTACTS.map((c, i) => ({
        contact_id: contactIds[c.key],
        channel_id: channelIds[c.channel],
        platform_sender_id: contactSenderId(c, i),
        platform_username: c.channel === "ig" ? c.handle : null,
      })),
    );
    const contactTags = CONTACTS.flatMap((c) =>
      [...c.tags, DEMO_TAG_NAME].map((name) => ({ contact_id: contactIds[c.key], tag_id: tagIds.get(name) })),
    );
    await insertMany("contact_tags", contactTags, "contact_id");

    // 6. Conversaciones y mensajes
    step("Creando conversaciones y mensajes...");
    const conversations = {};
    const conversationRows = {};
    for (const spec of CONVERSATIONS) {
      const contact = CONTACTS.find((c) => c.key === spec.contact);
      const built = buildConversation(spec, {
        now,
        advisorId: (key) => advisorIds[key],
        contactName: `${contact.first} ${contact.last}`,
      });
      const hasOpenCase = CASES.some((c) => c.contact === spec.contact && c.status === "open");
      const platform = CHANNELS.find((c) => c.key === contact.channel).platform;
      const conv = must(
        await db
          .from("conversations")
          .insert({
            workspace_id: workspace.id,
            channel_id: channelIds[contact.channel],
            contact_id: contactIds[spec.contact],
            platform,
            late_conversation_id: `demo-conv-${spec.contact}`,
            status: "open",
            last_message_at: built.last_message_at,
            last_message_preview: built.last_message_preview,
            unread_count: built.unread_count,
            is_automation_paused: built.hasHumanReply && hasOpenCase,
            created_at: built.messages[0]?.created_at ?? agoIso(now, 60),
          })
          .select("id")
          .single(),
        `Crear la conversación de ${spec.contact}`,
      );
      conversations[spec.contact] = conv.id;
      conversationRows[spec.contact] = built;
      await insertMany(
        "messages",
        built.messages.map((m) => ({
          conversation_id: conv.id,
          direction: m.direction,
          text: m.text,
          platform_message_id: m.platform_message_id,
          sent_by_user_id: m.sent_by_user_id,
          status: "sent",
          created_at: m.created_at,
        })),
      );
      created.conversaciones++;
      created.mensajes += built.messages.length;
    }

    // 7. Gestiones y registro de actividad
    step("Creando gestiones y su registro...");
    const caseIds = {};
    const caseRows = {};
    const ordered = [...fullCases].sort((a, b) => (b.openedAgo ?? b.createdAgo ?? 0) - (a.openedAgo ?? a.createdAgo ?? 0));
    for (const spec of ordered) {
      const contact = CONTACTS.find((c) => c.key === spec.contact);
      const { row, activities } = buildCase(spec, {
        workspaceId: workspace.id,
        now,
        ids,
        ownerId: owner.user_id,
        conversation: conversationRows[spec.contact] ?? null,
        conversationId: conversations[spec.contact] ?? null,
        contactFirstName: contact.first,
      });
      const inserted = must(await db.from("cases").insert(row).select("id").single(), `Crear la gestión ${spec.key}`);
      caseIds[spec.key] = inserted.id;
      caseRows[spec.key] = row;
      dd.case_ids.push(inserted.id);
      created.gestiones++;
      if (activities.length) {
        await insertMany(
          "activity",
          activities.map((a) => ({ ...a, case_id: inserted.id, conversation_id: a.conversation_id ?? conversations[spec.contact] ?? null })),
          "id",
        );
        created.actividad += activities.length;
      }
    }
    await save();

    // Último reparto de cada asesor (para que el turno parta de lo que ya pasó).
    for (const a of ADVISORS) {
      const last = fullCases
        .filter((c) => c.assignee === a.key && c.status === "open")
        .map((c) => caseRows[c.key].assigned_at)
        .sort()
        .pop();
      if (last) await db.from("workspace_members").update({ last_assigned_at: last }).eq("workspace_id", workspace.id).eq("user_id", advisorIds[a.key]);
    }

    // 8. Notas internas con menciones
    step("Creando notas internas...");
    const names = { owner: ownerName };
    for (const a of ADVISORS) names[a.key] = a.name;
    const authorOf = (key) => (key === "owner" ? owner.user_id : advisorIds[key]);
    for (const n of NOTES) {
      const spec = CASES.find((c) => c.key === n.case);
      const caseId = caseIds[n.case];
      const at = agoIso(now, n.ago);
      const body = fillNames(n.body, names);
      const mentions = n.mentions.map((k) => (k === "owner" ? owner.user_id : advisorIds[k]));
      const note = must(
        await db
          .from("case_notes")
          .insert({
            workspace_id: workspace.id,
            case_id: caseId,
            contact_id: contactIds[spec.contact],
            conversation_id: conversations[spec.contact] ?? null,
            author_id: authorOf(n.author),
            body,
            mentions,
            created_at: at,
          })
          .select("id")
          .single(),
        "Crear una nota",
      );
      await insertMany("activity", [
        {
          workspace_id: workspace.id,
          contact_id: contactIds[spec.contact],
          case_id: caseId,
          conversation_id: conversations[spec.contact] ?? null,
          type: "note_added",
          actor_id: authorOf(n.author),
          meta: { note_id: note.id, mentions },
          created_at: at,
        },
      ]);
      created.notas++;
      created.actividad++;
    }

    // 9. Notificaciones para el dueño
    step("Creando notificaciones...");
    for (const n of NOTIFICATIONS) {
      const spec = CASES.find((c) => c.key === n.case);
      const contact = CONTACTS.find((c) => c.key === spec.contact);
      const at = agoIso(now, n.ago);
      const row = must(
        await db
          .from("notifications")
          .insert({
            workspace_id: workspace.id,
            user_id: owner.user_id,
            type: n.type,
            title: fillNames(n.title.replace("{contact}", contactDisplayName(contact)), names),
            body: fillNames(n.body, names),
            link: `/dashboard/inbox?contact=${encodeURIComponent(contactIds[spec.contact])}&case=${encodeURIComponent(caseIds[n.case])}`,
            read_at: n.read ? at : null,
            created_at: at,
          })
          .select("id")
          .single(),
        "Crear una notificación",
      );
      dd.notification_ids.push(row.id);
      created.notificaciones++;
    }
    await save();

    // 10. Respuestas guardadas
    step("Creando respuestas guardadas...");
    for (const r of SAVED_REPLIES) {
      const row = must(
        await db
          .from("saved_replies")
          .insert({
            workspace_id: workspace.id,
            scope: r.scope,
            user_id: r.scope === "personal" ? owner.user_id : null,
            title: savedReplyTitle(r),
            shortcut: r.shortcut,
            body: r.body,
            created_by: owner.user_id,
          })
          .select("id")
          .single(),
        `Crear la respuesta ${r.title}`,
      );
      dd.saved_reply_ids.push(row.id);
      created.respuestas++;
    }
    await save();

    // 11. Borrador de difusión con plantilla
    step("Creando el borrador de difusión...");
    const broadcast = must(
      await db
        .from("broadcasts")
        .insert({ workspace_id: workspace.id, name: BROADCAST.name, status: BROADCAST.status, message_content: BROADCAST.message_content })
        .select("id")
        .single(),
      "Crear la difusión",
    );
    dd.broadcast_ids.push(broadcast.id);
    created.difusiones++;
    await save();

    // 12. Postventa con destino fijo a Atención (único cambio fuera de lo marcado)
    for (const o of ROUTING_OVERRIDES) {
      const type = cat.typeOf(o.caseType);
      dd.restore.case_types.push({ id: type.id, name: type.name, routing: type.routing, fixed_team_id: type.fixed_team_id });
      await save();
      must(
        await db.from("case_types").update({ routing: o.routing, fixed_team_id: teamIds[o.team] }).eq("id", type.id),
        `Cambiar el destino de ${o.caseType}`,
      );
      step(`Tipo "${o.caseType}": destino fijo a "${TEAMS.find((t) => t.key === o.team).name}" (antes: ${type.routing}).`);
    }

    dd.status = "ready";
    await save();
  } catch (err) {
    await save().catch(() => {});
    console.error(
      "\nLa carga se interrumpió. Lo creado hasta aquí quedó registrado en demo_data; para limpiarlo ejecuta:\n  node scripts/datos-prueba.mjs borrar" +
        (workspaceArg ? ` --espacio=${workspaceArg}` : ""),
    );
    throw err;
  }

  console.log("\nDatos de prueba cargados:");
  console.log(`  Asesores:        ${created.asesores} (usuarios sin contraseña, no pueden iniciar sesión; uno Ausente)`);
  console.log(`  Equipos:         ${created.equipos}`);
  console.log(`  Canales:         ${created.canales} (WhatsApp e Instagram de prueba)`);
  console.log(`  Contactos:       ${created.contactos} (+ ${created.etiquetas} etiqueta(s) nueva(s))`);
  console.log(`  Conversaciones:  ${created.conversaciones} con ${created.mensajes} mensajes`);
  console.log(`  Gestiones:       ${created.gestiones}`);
  console.log(`  Actividad:       ${created.actividad} registros`);
  console.log(`  Notas internas:  ${created.notas}`);
  console.log(`  Notificaciones:  ${created.notificaciones} (para ${ownerName})`);
  console.log(`  Respuestas:      ${created.respuestas}`);
  console.log(`  Difusiones:      ${created.difusiones} (borrador)`);
  for (const w of warnings) console.log(`\nAviso: ${w}`);
  console.log(
    "\nRecuerda: el cron de la app reparte las gestiones sin asignar y activa las recompras programadas cuando les toca; con esto los datos 'se mueven' solos.",
  );
}

// ── borrar ─────────────────────────────────────────────────────────────────

async function deleteIn(table, column, ids) {
  let deleted = 0;
  for (const part of chunk(ids, 100)) {
    const { data, error } = await db.from(table).delete().in(column, part).select(column);
    if (error) fail(`Borrar de ${table}: ${error.message}`);
    deleted += data?.length ?? 0;
  }
  return deleted;
}

async function borrar() {
  const workspace = await chooseWorkspace();
  console.log(`\nBorrar datos de prueba de "${workspace.name}" (${workspace.id})`);
  console.log(`Base: ${SUPABASE_URL}\n`);

  if (!hasDemoData(workspace.settings)) {
    fail(`No hay datos de prueba cargados (no existe workspaces.settings.${DEMO_DATA_KEY}).`);
  }
  const demoData = workspace.settings[DEMO_DATA_KEY];
  const plan = deletionPlan(demoData);
  const deleted = {};
  const count = (key, n) => {
    deleted[key] = (deleted[key] ?? 0) + n;
  };
  const stepOf = (kind) => plan.find((s) => s.kind === kind);

  // Lo que cuelga en cascada de los contactos: se cuenta antes de borrar.
  const contactIds = stepOf("contacts").ids;
  const casesCount = await countWhere("cases", "contact_id", contactIds);
  const convCount = await countWhere("conversations", "contact_id", contactIds);
  const activityCount = await countWhere("activity", "contact_id", contactIds);
  const notesCount = await countWhere("case_notes", "contact_id", contactIds);
  let messagesCount = 0;
  if (contactIds.length) {
    const convs = [];
    for (const part of chunk(contactIds, 100)) {
      convs.push(...must(await db.from("conversations").select("id").in("contact_id", part), "No se pudieron leer las conversaciones").map((c) => c.id));
    }
    messagesCount = await countWhere("messages", "conversation_id", convs);
  }

  // Gestiones reales asignadas a asesores de prueba: quedarán sin asignar (la FK las suelta).
  const userIds = stepOf("users").ids;
  let realAssigned = 0;
  if (userIds.length) {
    for (const part of chunk(userIds, 100)) {
      const { count: n } = await db
        .from("cases")
        .select("*", { count: "exact", head: true })
        .in("assignee_id", part)
        .not("contact_id", "in", `(${contactIds.length ? contactIds.join(",") : "00000000-0000-0000-0000-000000000000"})`);
      realAssigned += n ?? 0;
    }
  }

  for (const s of plan) {
    switch (s.kind) {
      case "notifications": {
        step("Borrando notificaciones...");
        let n = await deleteIn("notifications", "id", s.ids);
        for (const contactId of s.alsoByContactLink) {
          const { data, error } = await db
            .from("notifications")
            .delete()
            .eq("workspace_id", workspace.id)
            .like("link", `%contact=${contactId}%`)
            .select("id");
          if (error) fail(`Borrar notificaciones de un contacto: ${error.message}`);
          n += data?.length ?? 0;
        }
        count("notificaciones", n);
        break;
      }
      case "broadcasts":
        step("Borrando difusiones...");
        count("difusiones", await deleteIn("broadcasts", "id", s.ids));
        break;
      case "saved_replies":
        step("Borrando respuestas guardadas...");
        count("respuestas guardadas", await deleteIn("saved_replies", "id", s.ids));
        break;
      case "contacts":
        step("Borrando contactos (y conversaciones, mensajes, gestiones, notas y registro)...");
        count("contactos", await deleteIn("contacts", "id", s.ids));
        break;
      case "channels":
        step("Borrando canales de prueba...");
        count("canales", await deleteIn("channels", "id", s.ids));
        break;
      case "restore_case_types":
        for (const r of s.restore) {
          step(`Restaurando el destino de "${r.name}" (${r.routing}).`);
          // Si el equipo fijo anterior ya no existe, la FK falla: se restaura sin él.
          let res = await db.from("case_types").update({ routing: r.routing, fixed_team_id: r.fixed_team_id }).eq("id", r.id);
          if (res.error) {
            res = await db.from("case_types").update({ routing: r.routing, fixed_team_id: null }).eq("id", r.id);
            if (res.error) fail(`No se pudo restaurar "${r.name}": ${res.error.message}`);
          }
          count("tipos de gestión restaurados", 1);
        }
        break;
      case "teams":
        step("Borrando equipos...");
        count("equipos", await deleteIn("teams", "id", s.ids));
        break;
      case "members":
        step("Borrando membresías de los asesores...");
        count("membresías", await deleteIn("workspace_members", "user_id", s.ids));
        break;
      case "users":
        step("Borrando usuarios de Auth de los asesores...");
        for (const id of s.ids) {
          const { error } = await db.auth.admin.deleteUser(id);
          if (error && !/not found/i.test(error.message)) fail(`No se pudo borrar el usuario ${id}: ${error.message}`);
          count("asesores", 1);
        }
        break;
      case "invites":
        step("Borrando invitaciones...");
        count("invitaciones", await deleteIn("workspace_invites", "id", s.ids));
        break;
      case "tags":
        step("Borrando etiquetas creadas por el script...");
        count("etiquetas", await deleteIn("tags", "id", s.ids));
        break;
      default:
        break;
    }
  }

  // Dejar settings como estaban: sin demo_data.
  const { data: fresh, error: freshError } = await db.from("workspaces").select("settings").eq("id", workspace.id).single();
  if (freshError) fail(`No se pudo leer settings: ${freshError.message}`);
  const res = await db.from("workspaces").update({ settings: withoutDemoData(fresh.settings) }).eq("id", workspace.id);
  if (res.error) fail(`No se pudo limpiar demo_data: ${res.error.message}`);
  step("settings.demo_data eliminado.");

  console.log("\nDatos de prueba eliminados:");
  for (const [k, v] of Object.entries(deleted)) console.log(`  ${k}: ${v}`);
  console.log(
    `  (en cascada, antes de borrar: ${convCount} conversaciones, ${messagesCount} mensajes, ${casesCount} gestiones, ${activityCount} registros de actividad, ${notesCount} notas)`,
  );
  if (realAssigned > 0) {
    console.log(`\nAviso: ${realAssigned} gestión(es) real(es) estaban asignadas a asesores de prueba y quedaron sin asignar; el cron las reparte.`);
  }
}

// ── Principal ──────────────────────────────────────────────────────────────

(command === "cargar" ? cargar() : borrar())
  .then(() => {
    console.log("\nListo.\n");
  })
  .catch((err) => {
    console.error(`\nERROR: ${err instanceof ScriptError ? err.message : (err?.stack ?? err)}\n`);
    // Sin process.exit: deja cerrar las conexiones pendientes (en Windows
    // salir a la fuerza puede disparar un assert de libuv).
    process.exitCode = 1;
  });

