"use server";

// Importación de contactos desde CSV (docs/FASE-2-TECNICO.md 6). Solo Dueño o
// Administrador. El navegador lee el CSV, mapea las columnas y manda las filas
// en lotes de 200; el servidor vuelve a validar todo (no confía en la vista
// previa) y escribe con el cliente de servicio. El avance queda en
// `import_batches` lote a lote, y al terminar se registra `contacts_imported`
// en `activity`.

import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { scheduleCasesForKeyDate } from "@/lib/cases";
import { GENERIC_ERROR, logActivity, type Db } from "@/lib/cases/io";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import { MAX_IMPORT_ROWS } from "@/lib/import/mapping";
import { normalizeImportPhone, senderIdFromPhone } from "@/lib/import/phone";
import { isUuid, sanitizeImportOptions, sanitizeImportRows } from "@/lib/import/sanitize";
import {
  findFileDuplicates,
  phoneKey,
  validateImportRow,
  type ImportErrorEntry,
  type ImportLookups,
  type ImportOptions,
  type ValidatedRow,
} from "@/lib/import/validate";
import type { Json } from "@/lib/types/database";

export type ImportActionResult<T extends object = object> = ({ ok: true } & T) | { error: string };

export interface ImportContext {
  types: { id: string; name: string; archived: boolean }[];
  teams: { id: string; name: string }[];
  members: { userId: string; email: string | null }[];
  tags: { id: string; name: string }[];
  customFields: { id: string; slug: string; name: string }[];
  whatsappChannels: { id: string; name: string }[];
}

export interface ImportBatchResult {
  created: number;
  updated: number;
  skipped: number;
  /** Gestiones programadas por fecha clave. */
  scheduled: number;
  linked: number;
  errors: ImportErrorEntry[];
}

export interface ImportFinalResult {
  batchId: string;
  fileName: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportErrorEntry[];
}

const INVALID = "Datos no válidos.";
const CHUNK = 100;

interface Session {
  userId: string;
  workspaceId: string;
  db: Db;
}

async function adminSession(): Promise<Session | { error: string }> {
  const { user, workspace, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };
  return { userId: user.id, workspaceId: workspace.id, db: await createServiceClient() };
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ── Contexto ───────────────────────────────────────────────────────────────

async function loadContext(db: Db, workspaceId: string): Promise<ImportContext> {
  const [types, teams, members, tags, fields, channels] = await Promise.all([
    db.from("contact_types").select("id, name, archived_at").eq("workspace_id", workspaceId),
    db.from("teams").select("id, name").eq("workspace_id", workspaceId).is("archived_at", null),
    db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId),
    db.from("tags").select("id, name").eq("workspace_id", workspaceId),
    db.from("custom_field_definitions").select("id, slug, name").eq("workspace_id", workspaceId).order("name"),
    db
      .from("channels")
      .select("id, display_name, username")
      .eq("workspace_id", workspaceId)
      .eq("platform", "whatsapp")
      .eq("is_active", true),
  ]);
  const memberList = await Promise.all(
    (members.data ?? []).map(async (m) => {
      const {
        data: { user },
      } = await db.auth.admin.getUserById(m.user_id);
      return { userId: m.user_id, email: user?.email ?? null };
    }),
  );
  return {
    types: (types.data ?? []).map((t) => ({ id: t.id, name: t.name, archived: t.archived_at !== null })),
    teams: teams.data ?? [],
    members: memberList,
    tags: tags.data ?? [],
    customFields: fields.data ?? [],
    whatsappChannels: (channels.data ?? []).map((c) => ({
      id: c.id,
      name: c.display_name || c.username || "WhatsApp",
    })),
  };
}

/** Tipos, sedes, miembros, etiquetas, campos personalizados y canales de WhatsApp para mapear y validar. */
export async function getImportContext(): Promise<ImportActionResult<{ context: ImportContext }>> {
  const s = await adminSession();
  if ("error" in s) return s;
  return { ok: true, context: await loadContext(s.db, s.workspaceId) };
}

// ── Contactos existentes ───────────────────────────────────────────────────

interface ExistingMaps {
  byPhone: Map<string, string>;
  byEmail: Map<string, string>;
}

/**
 * Busca contactos del espacio por teléfono (en `contacts.phone` y en los
 * remitentes de WhatsApp de `contact_channels`) y por correo. El teléfono se
 * compara por dígitos; solo encuentra los guardados como "+51999999999" o
 * "51999999999". El correo, en minúsculas.
 */
async function findExisting(db: Db, workspaceId: string, phones: string[], emails: string[]): Promise<ExistingMaps> {
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const digitsList = [...new Set(phones.map(phoneKey).filter(Boolean))];
  const emailList = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];

  let channelIds: string[] | null = null;
  for (const part of chunks(digitsList, CHUNK)) {
    const variants = part.flatMap((d) => [`+${d}`, d]);
    const { data } = await db.from("contacts").select("id, phone").eq("workspace_id", workspaceId).in("phone", variants);
    for (const c of data ?? []) if (c.phone && !byPhone.has(phoneKey(c.phone))) byPhone.set(phoneKey(c.phone), c.id);

    if (channelIds === null) {
      const { data: channels } = await db.from("channels").select("id").eq("workspace_id", workspaceId);
      channelIds = (channels ?? []).map((c) => c.id);
    }
    if (channelIds.length) {
      const { data: links } = await db
        .from("contact_channels")
        .select("contact_id, platform_sender_id")
        .in("channel_id", channelIds)
        .in("platform_sender_id", part);
      for (const l of links ?? []) if (!byPhone.has(l.platform_sender_id)) byPhone.set(l.platform_sender_id, l.contact_id);
    }
  }
  for (const part of chunks(emailList, CHUNK)) {
    const { data } = await db.from("contacts").select("id, email").eq("workspace_id", workspaceId).in("email", part);
    for (const c of data ?? []) if (c.email && !byEmail.has(c.email.toLowerCase())) byEmail.set(c.email.toLowerCase(), c.id);
  }
  return { byPhone, byEmail };
}

/** Para la vista previa: teléfonos ("+51...") y correos del archivo que ya existen en el CRM. */
export async function findExistingContacts(
  phones: string[],
  emails: string[],
): Promise<ImportActionResult<{ byPhone: Record<string, string>; byEmail: Record<string, string> }>> {
  if (
    !Array.isArray(phones) ||
    !Array.isArray(emails) ||
    phones.length > MAX_IMPORT_ROWS ||
    emails.length > MAX_IMPORT_ROWS ||
    ![...phones, ...emails].every((x) => typeof x === "string" && x.length <= 200)
  ) {
    return { error: INVALID };
  }
  const s = await adminSession();
  if ("error" in s) return s;
  const found = await findExisting(s.db, s.workspaceId, phones, emails);
  return { ok: true, byPhone: Object.fromEntries(found.byPhone), byEmail: Object.fromEntries(found.byEmail) };
}

// ── Inicio y fin ───────────────────────────────────────────────────────────

/** Crea el registro de la importación (`import_batches`) y devuelve su id. */
export async function startImport(input: {
  fileName: string;
  total: number;
  options: ImportOptions;
}): Promise<ImportActionResult<{ batchId: string }>> {
  const options = sanitizeImportOptions(input?.options);
  const total = input?.total;
  if (!options || typeof total !== "number" || !Number.isInteger(total) || total < 1 || total > MAX_IMPORT_ROWS) {
    return { error: total > MAX_IMPORT_ROWS ? `El archivo puede tener hasta ${MAX_IMPORT_ROWS} filas.` : INVALID };
  }
  const s = await adminSession();
  if ("error" in s) return s;
  if (options.channelId) {
    const { data: channel } = await s.db
      .from("channels")
      .select("id")
      .eq("id", options.channelId)
      .eq("workspace_id", s.workspaceId)
      .eq("platform", "whatsapp")
      .maybeSingle();
    if (!channel) return { error: "El canal de WhatsApp no existe." };
  }
  const fileName = typeof input.fileName === "string" ? input.fileName.slice(0, 200) : "";
  const { data, error } = await s.db
    .from("import_batches")
    .insert({
      workspace_id: s.workspaceId,
      created_by: s.userId,
      file_name: fileName,
      total,
      options: options as unknown as Json,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[import] start", error?.message);
    return { error: GENERIC_ERROR };
  }
  return { ok: true, batchId: data.id };
}

/** Cierra la importación: devuelve los totales y deja el registro en `activity`. */
export async function finishImport(batchId: string): Promise<ImportActionResult<{ result: ImportFinalResult }>> {
  if (!isUuid(batchId)) return { error: INVALID };
  const s = await adminSession();
  if ("error" in s) return s;
  const { data: batch } = await s.db
    .from("import_batches")
    .select("*")
    .eq("id", batchId)
    .eq("workspace_id", s.workspaceId)
    .maybeSingle();
  if (!batch) return { error: "No se encontró la importación." };
  const errors = (Array.isArray(batch.errors) ? batch.errors : []) as unknown as ImportErrorEntry[];
  await logActivity(s.db, {
    workspace_id: s.workspaceId,
    type: "contacts_imported",
    actor_id: s.userId,
    to_value: batch.id,
    meta: {
      batch_id: batch.id,
      file_name: batch.file_name,
      total: batch.total,
      created: batch.created,
      updated: batch.updated,
      skipped: batch.skipped,
      errors: errors.length,
    },
  });
  return {
    ok: true,
    result: {
      batchId: batch.id,
      fileName: batch.file_name,
      total: batch.total,
      created: batch.created,
      updated: batch.updated,
      skipped: batch.skipped,
      errors,
    },
  };
}

// ── Lote ───────────────────────────────────────────────────────────────────

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Tags por nombre: usa las existentes y crea las que faltan si se pidió. */
async function resolveTags(
  db: Db,
  workspaceId: string,
  rows: ValidatedRow[],
  known: { id: string; name: string }[],
  createTags: boolean,
): Promise<Map<string, string>> {
  const ids = new Map(known.map((t) => [norm(t.name), t.id]));
  if (!createTags) return ids;
  const missing = new Map<string, string>();
  for (const r of rows) for (const name of r.contact.tagNames) if (!ids.has(norm(name))) missing.set(norm(name), name);
  if (missing.size === 0) return ids;
  const { error } = await db
    .from("tags")
    .upsert(
      [...missing.values()].map((name) => ({ workspace_id: workspaceId, name })),
      { onConflict: "workspace_id,name", ignoreDuplicates: true },
    );
  if (error) console.error("[import] tags", error.message);
  const { data } = await db.from("tags").select("id, name").eq("workspace_id", workspaceId);
  for (const t of data ?? []) ids.set(norm(t.name), t.id);
  return ids;
}

function contactPayload(r: ValidatedRow, workspaceId: string, fileName: string) {
  const c = r.contact;
  return {
    workspace_id: workspaceId,
    display_name: c.displayName ?? c.phone ?? c.email,
    email: c.email,
    phone: c.phone,
    contact_type_id: c.contactTypeId,
    team_id: c.teamId,
    owner_id: c.ownerId,
    key_date: c.keyDate,
    source: { import: fileName } as Json,
  };
}

/** Procesa hasta 200 filas: crea o actualiza contactos, etiquetas, campos, canal y gestiones. */
export async function processImportBatch(input: {
  batchId: string;
  rows: unknown;
  options: unknown;
}): Promise<ImportActionResult<{ result: ImportBatchResult }>> {
  const rows = sanitizeImportRows(input?.rows);
  const options = sanitizeImportOptions(input?.options);
  if (!rows || !options || !isUuid(input?.batchId) || rows.length === 0) return { error: INVALID };
  const s = await adminSession();
  if ("error" in s) return s;
  const { db, workspaceId, userId } = s;

  const { data: batch } = await db
    .from("import_batches")
    .select("*")
    .eq("id", input.batchId)
    .eq("workspace_id", workspaceId)
    .eq("created_by", userId)
    .maybeSingle();
  if (!batch) return { error: "No se encontró la importación." };
  const priorErrors = (Array.isArray(batch.errors) ? batch.errors : []) as unknown as ImportErrorEntry[];
  if (batch.created + batch.updated + batch.skipped + priorErrors.length + rows.length > batch.total) {
    return { error: "El lote supera el total de filas de la importación." };
  }

  const result: ImportBatchResult = { created: 0, updated: 0, skipped: 0, scheduled: 0, linked: 0, errors: [] };

  // Duplicados dentro del lote, además de los que marcó el navegador entre lotes.
  const dups = findFileDuplicates(rows);
  for (const r of rows) if (!r.fileDuplicateOf && dups.has(r.line)) r.fileDuplicateOf = dups.get(r.line) ?? null;

  const ctx = await loadContext(db, workspaceId);
  const phones = rows.flatMap((r) => {
    const p = normalizeImportPhone(r.values.phone);
    return p.ok && p.value ? [p.value] : [];
  });
  const existing = await findExisting(db, workspaceId, phones, rows.map((r) => r.values.email ?? ""));
  const lookups: ImportLookups = {
    types: ctx.types,
    teams: ctx.teams,
    members: ctx.members,
    tags: ctx.tags,
    customFields: ctx.customFields,
    existingByPhone: existing.byPhone,
    existingByEmail: existing.byEmail,
  };
  const validated = rows.map((r) => validateImportRow(r, lookups, options));

  for (const v of validated) {
    if (v.status === "error") result.errors.push({ line: v.line, message: v.errors.join(" ") });
    else if (v.status === "skip") result.skipped++;
  }
  const toCreate = validated.filter((v) => v.status === "create");
  const toUpdate = validated.filter((v) => v.status === "update");
  const touched: { contactId: string; row: ValidatedRow }[] = [];

  // Crear: en bloque; si el bloque falla, de a una para aislar la fila mala.
  for (const part of chunks(toCreate, CHUNK)) {
    const payload = part.map((r) => contactPayload(r, workspaceId, batch.file_name));
    const { data, error } = await db.from("contacts").insert(payload).select("id");
    if (!error && data && data.length === part.length) {
      data.forEach((c, i) => touched.push({ contactId: c.id, row: part[i] }));
      result.created += part.length;
      continue;
    }
    if (error) console.error("[import] bulk insert", error.message);
    for (let i = 0; i < part.length; i++) {
      const one = await db.from("contacts").insert(payload[i]).select("id").single();
      if (one.error || !one.data) {
        console.error("[import] insert", one.error?.message);
        result.errors.push({ line: part[i].line, message: "No se pudo crear el contacto." });
      } else {
        touched.push({ contactId: one.data.id, row: part[i] });
        result.created++;
      }
    }
  }

  // Actualizar: solo los datos que trae la fila.
  for (const r of toUpdate) {
    const c = r.contact;
    const patch: Record<string, string | null> = {};
    if (c.displayName) patch.display_name = c.displayName;
    if (c.email) patch.email = c.email;
    if (c.phone) patch.phone = c.phone;
    if (c.contactTypeId) patch.contact_type_id = c.contactTypeId;
    if (c.teamId) patch.team_id = c.teamId;
    if (c.ownerId) patch.owner_id = c.ownerId;
    if (c.keyDate) patch.key_date = c.keyDate;
    if (Object.keys(patch).length > 0) {
      const { error } = await db
        .from("contacts")
        .update(patch)
        .eq("id", r.existingId as string)
        .eq("workspace_id", workspaceId);
      if (error) {
        console.error("[import] update", error.message);
        result.errors.push({ line: r.line, message: "No se pudo actualizar el contacto." });
        continue;
      }
    }
    touched.push({ contactId: r.existingId as string, row: r });
    result.updated++;
  }

  // Etiquetas.
  const tagIds = await resolveTags(db, workspaceId, touched.map((t) => t.row), ctx.tags, options.createTags);
  const tagLinks = touched.flatMap((t) =>
    [...new Set(t.row.contact.tagNames.map((n) => tagIds.get(norm(n))).filter((x): x is string => !!x))].map((tag_id) => ({
      contact_id: t.contactId,
      tag_id,
    })),
  );
  for (const part of chunks(tagLinks, 500)) {
    const { error } = await db.from("contact_tags").upsert(part, { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
    if (error) console.error("[import] contact_tags", error.message);
  }

  // Campos personalizados.
  const fieldRows = touched.flatMap((t) =>
    t.row.contact.customValues.map((cv) => ({ contact_id: t.contactId, field_id: cv.fieldId, value: cv.value })),
  );
  for (const part of chunks(fieldRows, 500)) {
    const { error } = await db.from("contact_custom_fields").upsert(part, { onConflict: "contact_id,field_id" });
    if (error) console.error("[import] custom fields", error.message);
  }

  // Canal de WhatsApp: platform_sender_id = teléfono sin "+" (como lo usa Zernio).
  if (options.channelId) {
    const withPhone = touched.filter((t) => t.row.contact.phone);
    const senderIds = withPhone.map((t) => senderIdFromPhone(t.row.contact.phone as string));
    const linkedSenders = new Set<string>();
    const linkedContacts = new Set<string>();
    for (const part of chunks(senderIds, CHUNK)) {
      const { data } = await db
        .from("contact_channels")
        .select("contact_id, platform_sender_id")
        .eq("channel_id", options.channelId)
        .in("platform_sender_id", part);
      for (const l of data ?? []) linkedSenders.add(l.platform_sender_id);
    }
    for (const part of chunks(
      withPhone.map((t) => t.contactId),
      CHUNK,
    )) {
      const { data } = await db
        .from("contact_channels")
        .select("contact_id")
        .eq("channel_id", options.channelId)
        .in("contact_id", part);
      for (const l of data ?? []) linkedContacts.add(l.contact_id);
    }
    const inserts = withPhone
      .map((t) => ({
        contact_id: t.contactId,
        channel_id: options.channelId as string,
        platform_sender_id: senderIdFromPhone(t.row.contact.phone as string),
      }))
      .filter((l) => !linkedSenders.has(l.platform_sender_id) && !linkedContacts.has(l.contact_id));
    for (const part of chunks(inserts, 500)) {
      const { error } = await db.from("contact_channels").insert(part);
      if (error) console.error("[import] contact_channels", error.message);
      else result.linked += part.length;
    }
  }

  // Gestiones programadas según la fecha clave.
  if (options.scheduleCases) {
    for (const t of touched) {
      if (!t.row.contact.keyDate) continue;
      try {
        const res = await scheduleCasesForKeyDate(db, workspaceId, t.contactId, { actorId: userId });
        result.scheduled += res.scheduled.length;
      } catch (e) {
        console.error("[import] schedule", e instanceof Error ? e.message : e);
      }
    }
  }

  result.errors.sort((a, b) => a.line - b.line);
  const { error: saveError } = await db
    .from("import_batches")
    .update({
      created: batch.created + result.created,
      updated: batch.updated + result.updated,
      skipped: batch.skipped + result.skipped,
      errors: [...priorErrors, ...result.errors] as unknown as Json,
    })
    .eq("id", batch.id);
  if (saveError) console.error("[import] save batch", saveError.message);

  return { ok: true, result };
}
