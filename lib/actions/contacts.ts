"use server";

// Acciones de servidor de la ficha de contacto (docs/FASE-1-TECNICO.md 4.3).
// Cada acción valida en el servidor, con getWorkspace() y la regla de
// visibilidad de lib/permissions.ts, antes de escribir con el cliente de
// servicio. La base exige además que solo un administrador cambie el
// responsable y el equipo (trigger guard_contact_update), pero el cliente de
// servicio no pasa por ese trigger: por eso se valida aquí también.
// Devuelven { ok: true, ... } o { error } con el mensaje en español.

import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { isDateString } from "@/lib/cases/dates";
import { GENERIC_ERROR, logActivity, type Db } from "@/lib/cases/io";
import {
  actorSeesContact,
  loadContactCaseSummaries,
  loadWorkspaceActor,
  type WorkspaceActor,
} from "@/lib/cases/visibility";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import { normalizePhone } from "@/components/contacts/contact-labels";
import { ilikePattern } from "@/components/cases/case-filters";

export type ContactActionResult<T extends object = object> = ({ ok: true } & T) | { error: string };

export interface ContactSearchResult {
  id: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "Datos no válidos.";
const NOT_FOUND = "No se encontró el contacto.";

function isId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function optionalId(value: unknown): value is string | null {
  return value === null || isId(value);
}

interface Session {
  userId: string;
  workspaceId: string;
  db: Db;
  actor: WorkspaceActor;
}

async function session(): Promise<Session | { error: string }> {
  const { user, workspace } = await getWorkspace();
  const db = await createServiceClient();
  const actor = await loadWorkspaceActor(db, workspace.id, user.id);
  if (!actor.role) return { error: "No eres miembro de este espacio de trabajo." };
  return { userId: user.id, workspaceId: workspace.id, db, actor };
}

interface ContactAccess {
  s: Session;
  contact: {
    id: string;
    contact_type_id: string | null;
    owner_id: string | null;
    team_id: string | null;
    phone: string | null;
    key_date: string | null;
  };
}

/** Carga el contacto del espacio actual y comprueba que el usuario lo ve. */
async function withContact(contactId: unknown): Promise<ContactAccess | { error: string }> {
  if (!isId(contactId)) return { error: INVALID };
  const s = await session();
  if ("error" in s) return s;
  const { data: contact } = await s.db
    .from("contacts")
    .select("id, contact_type_id, owner_id, team_id, phone, key_date")
    .eq("id", contactId)
    .eq("workspace_id", s.workspaceId)
    .maybeSingle();
  if (!contact) return { error: NOT_FOUND };
  const summaries = await loadContactCaseSummaries(s.db, contact.id);
  // Sin visibilidad respondemos "no encontrado" para no revelar que existe.
  if (!actorSeesContact(s.actor, contact, summaries)) return { error: NOT_FOUND };
  return { s, contact };
}

async function updateContact(
  ctx: ContactAccess,
  patch: { contact_type_id?: string | null; owner_id?: string | null; team_id?: string | null; phone?: string | null; key_date?: string | null },
): Promise<{ error: string } | null> {
  const { error } = await ctx.s.db
    .from("contacts")
    .update(patch)
    .eq("id", ctx.contact.id)
    .eq("workspace_id", ctx.s.workspaceId);
  if (error) {
    console.error("[contacts] update", error.message);
    return { error: GENERIC_ERROR };
  }
  return null;
}

// ── Búsqueda ───────────────────────────────────────────────────────────────

/**
 * Busca contactos por nombre, correo o teléfono para elegirlos (p. ej. en
 * "Nueva gestión"). Usa el cliente del usuario: la RLS deja solo los que ve.
 * Sin texto devuelve los de interacción más reciente.
 */
export async function searchContacts(
  text: string,
): Promise<ContactActionResult<{ contacts: ContactSearchResult[] }>> {
  if (typeof text !== "string") return { error: INVALID };
  const { workspace, supabase } = await getWorkspace();
  // Quita lo que rompería la condición `or` de PostgREST.
  const clean = text.replace(/[,()"*]/g, " ").trim().slice(0, 80);
  let query = supabase
    .from("contacts")
    .select("id, display_name, phone, email")
    .eq("workspace_id", workspace.id)
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .limit(10);
  if (clean) {
    const pattern = ilikePattern(clean);
    query = query.or(`display_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`);
  }
  const { data, error } = await query;
  if (error) return { error: GENERIC_ERROR };
  return {
    ok: true,
    contacts: (data ?? []).map((c) => ({
      id: c.id,
      displayName: c.display_name,
      phone: c.phone,
      email: c.email,
    })),
  };
}

// ── Crear contacto ─────────────────────────────────────────────────────────

/**
 * Registra a un cliente nuevo (por ejemplo, una venta por teléfono): nombre y
 * teléfono. Cualquier miembro puede; queda como su responsable. Si el teléfono
 * ya existe y la persona ve ese contacto, se devuelve ese en vez de duplicarlo.
 */
export async function createContact(input: {
  name: string;
  phone: string;
}): Promise<ContactActionResult<{ contact: ContactSearchResult; existed: boolean }>> {
  if (!input || typeof input.name !== "string" || typeof input.phone !== "string") return { error: INVALID };
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) return { error: "Escribe el nombre del cliente (al menos 2 letras)." };
  if (name.length > 100) return { error: "El nombre no puede tener más de 100 caracteres." };
  const phone = normalizePhone(input.phone);
  if (!phone.ok) return { error: phone.error };
  if (!phone.value) return { error: "Escribe el teléfono del cliente." };

  const s = await session();
  if ("error" in s) return s;

  const digits = phone.value.replace(/\D/g, "");
  const { data: same } = await s.db
    .from("contacts")
    .select("id, display_name, phone, email, owner_id, team_id")
    .eq("workspace_id", s.workspaceId)
    .in("phone", [phone.value, digits, `+${digits}`])
    .limit(1)
    .maybeSingle();
  if (same) {
    const summaries = await loadContactCaseSummaries(s.db, same.id);
    if (!actorSeesContact(s.actor, same, summaries)) {
      return { error: "Ya existe un contacto con ese teléfono. Pídele a un administrador que te lo asigne." };
    }
    return {
      ok: true,
      existed: true,
      contact: { id: same.id, displayName: same.display_name, phone: same.phone, email: same.email },
    };
  }

  const { data: def } = await s.db
    .from("contact_types")
    .select("id")
    .eq("workspace_id", s.workspaceId)
    .eq("is_default", true)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  const team = s.actor.memberships.find((m) => s.actor.teams.some((t) => t.id === m.teamId))?.teamId ?? null;
  const { data: created, error } = await s.db
    .from("contacts")
    .insert({
      workspace_id: s.workspaceId,
      display_name: name,
      phone: phone.value,
      owner_id: s.userId,
      team_id: team,
      contact_type_id: def?.id ?? null,
      source: { manual: true },
    })
    .select("id, display_name, phone, email")
    .single();
  if (error || !created) {
    console.error("[contacts] create", error?.message);
    return { error: GENERIC_ERROR };
  }
  return {
    ok: true,
    existed: false,
    contact: { id: created.id, displayName: created.display_name, phone: created.phone, email: created.email },
  };
}

// ── Cambios de la ficha ────────────────────────────────────────────────────

/** Tipo de contacto: cualquiera que vea el contacto. null lo quita. */
export async function updateContactType(
  contactId: string,
  contactTypeId: string | null,
): Promise<ContactActionResult> {
  if (!optionalId(contactTypeId)) return { error: INVALID };
  const ctx = await withContact(contactId);
  if ("error" in ctx) return ctx;
  const { s, contact } = ctx;
  if (contact.contact_type_id === contactTypeId) return { ok: true };

  if (contactTypeId) {
    const { data: type } = await s.db
      .from("contact_types")
      .select("id, archived_at")
      .eq("id", contactTypeId)
      .eq("workspace_id", s.workspaceId)
      .maybeSingle();
    if (!type || type.archived_at) return { error: "El tipo de contacto no existe o está archivado." };
  }
  const failure = await updateContact(ctx, { contact_type_id: contactTypeId });
  if (failure) return failure;
  await logActivity(s.db, {
    workspace_id: s.workspaceId,
    type: "contact_type_changed",
    contact_id: contact.id,
    actor_id: s.userId,
    from_value: contact.contact_type_id,
    to_value: contactTypeId,
    meta: { reason: "manual" },
  });
  return { ok: true };
}

/** Fecha clave ("YYYY-MM-DD"): cualquiera que vea el contacto. null la quita. */
export async function updateContactKeyDate(
  contactId: string,
  keyDate: string | null,
): Promise<ContactActionResult> {
  if (keyDate !== null && keyDate !== "" && !isDateString(keyDate)) {
    return { error: "La fecha no es válida." };
  }
  const ctx = await withContact(contactId);
  if ("error" in ctx) return ctx;
  const value = keyDate || null;
  if (ctx.contact.key_date === value) return { ok: true };
  const failure = await updateContact(ctx, { key_date: value });
  return failure ?? { ok: true };
}

/** Teléfono: cualquiera que vea el contacto. Vacío lo quita. */
export async function updateContactPhone(
  contactId: string,
  phone: string | null,
): Promise<ContactActionResult<{ phone: string | null }>> {
  const normalized = normalizePhone(phone);
  if (!normalized.ok) return { error: normalized.error };
  const ctx = await withContact(contactId);
  if ("error" in ctx) return ctx;
  if (ctx.contact.phone !== normalized.value) {
    const failure = await updateContact(ctx, { phone: normalized.value });
    if (failure) return failure;
  }
  return { ok: true, phone: normalized.value };
}

/** Responsable del contacto: solo Dueño o Administrador. null lo quita. */
export async function setContactOwner(
  contactId: string,
  ownerId: string | null,
): Promise<ContactActionResult> {
  if (!optionalId(ownerId)) return { error: INVALID };
  const ctx = await withContact(contactId);
  if ("error" in ctx) return ctx;
  const { s, contact } = ctx;
  if (!isAdminRole(s.actor.role)) return { error: ADMIN_ONLY_MESSAGE };
  if (contact.owner_id === ownerId) return { ok: true };

  if (ownerId) {
    const { data: member } = await s.db
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", s.workspaceId)
      .eq("user_id", ownerId)
      .maybeSingle();
    if (!member) return { error: "La persona no es miembro de este espacio de trabajo." };
  }
  const failure = await updateContact(ctx, { owner_id: ownerId });
  if (failure) return failure;
  await logActivity(s.db, {
    workspace_id: s.workspaceId,
    type: "owner_changed",
    contact_id: contact.id,
    actor_id: s.userId,
    from_value: contact.owner_id,
    to_value: ownerId,
    meta: { reason: "manual" },
  });
  return { ok: true };
}

/** Equipo del contacto: solo Dueño o Administrador. null lo quita. */
export async function setContactTeam(
  contactId: string,
  teamId: string | null,
): Promise<ContactActionResult> {
  if (!optionalId(teamId)) return { error: INVALID };
  const ctx = await withContact(contactId);
  if ("error" in ctx) return ctx;
  const { s, contact } = ctx;
  if (!isAdminRole(s.actor.role)) return { error: ADMIN_ONLY_MESSAGE };
  if (contact.team_id === teamId) return { ok: true };

  if (teamId && !s.actor.teams.some((t) => t.id === teamId)) {
    return { error: "El equipo no existe o está archivado." };
  }
  const failure = await updateContact(ctx, { team_id: teamId });
  if (failure) return failure;
  await logActivity(s.db, {
    workspace_id: s.workspaceId,
    type: "team_changed",
    contact_id: contact.id,
    actor_id: s.userId,
    from_value: contact.team_id,
    to_value: teamId,
    meta: { reason: "manual" },
  });
  return { ok: true };
}

// ── Etiquetas ──────────────────────────────────────────────────────────────

async function tagInWorkspace(s: Session, tagId: string): Promise<boolean> {
  const { data } = await s.db
    .from("tags")
    .select("id")
    .eq("id", tagId)
    .eq("workspace_id", s.workspaceId)
    .maybeSingle();
  return !!data;
}

/** Pone una etiqueta existente al contacto. */
export async function addContactTag(contactId: string, tagId: string): Promise<ContactActionResult> {
  if (!isId(tagId)) return { error: INVALID };
  const ctx = await withContact(contactId);
  if ("error" in ctx) return ctx;
  const { s, contact } = ctx;
  if (!(await tagInWorkspace(s, tagId))) return { error: "La etiqueta no existe." };
  const { data: existing } = await s.db
    .from("contact_tags")
    .select("tag_id")
    .eq("contact_id", contact.id)
    .eq("tag_id", tagId)
    .maybeSingle();
  if (existing) return { ok: true };
  const { error } = await s.db.from("contact_tags").insert({ contact_id: contact.id, tag_id: tagId });
  if (error) {
    console.error("[contacts] add tag", error.message);
    return { error: GENERIC_ERROR };
  }
  return { ok: true };
}

/** Quita una etiqueta del contacto (la etiqueta sigue existiendo). */
export async function removeContactTag(contactId: string, tagId: string): Promise<ContactActionResult> {
  if (!isId(tagId)) return { error: INVALID };
  const ctx = await withContact(contactId);
  if ("error" in ctx) return ctx;
  const { s, contact } = ctx;
  if (!(await tagInWorkspace(s, tagId))) return { error: "La etiqueta no existe." };
  const { error } = await s.db.from("contact_tags").delete().eq("contact_id", contact.id).eq("tag_id", tagId);
  if (error) {
    console.error("[contacts] remove tag", error.message);
    return { error: GENERIC_ERROR };
  }
  return { ok: true };
}
