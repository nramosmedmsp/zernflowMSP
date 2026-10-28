// E/S compartida del motor de gestiones: cliente, registro de actividad y
// notificaciones. Siempre con el cliente de servicio (las tablas cases,
// activity y notifications no tienen políticas de escritura para usuarios).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityType, Database, Json } from "@/lib/types/database";

export type Db = SupabaseClient<Database>;

export type CaseRow = Database["public"]["Tables"]["cases"]["Row"];
export type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
export type CaseTypeRow = Database["public"]["Tables"]["case_types"]["Row"];
export type CaseStageRow = Database["public"]["Tables"]["case_stages"]["Row"];

/** Resultado de las operaciones del motor que llegan a la interfaz. */
export type EngineResult<T extends object = object> = ({ ok: true } & T) | { error: string };

export const GENERIC_ERROR = "No se pudo completar la operación. Inténtalo de nuevo.";

/** Enlace de una gestión en la bandeja (lo usan las notificaciones). */
export function caseLink(contactId: string, caseId: string): string {
  return `/dashboard/inbox?contact=${encodeURIComponent(contactId)}&case=${encodeURIComponent(caseId)}`;
}

export interface ActivityInput {
  workspace_id: string;
  type: ActivityType;
  contact_id?: string | null;
  case_id?: string | null;
  conversation_id?: string | null;
  actor_id?: string | null;
  from_value?: string | null;
  to_value?: string | null;
  meta?: Record<string, unknown>;
}

/** Registra en `activity`. Un fallo se anota en el log y no corta la operación. */
export async function logActivity(db: Db, rows: ActivityInput | ActivityInput[]): Promise<void> {
  const list = Array.isArray(rows) ? rows : [rows];
  if (list.length === 0) return;
  const { error } = await db.from("activity").insert(
    list.map((r) => ({
      workspace_id: r.workspace_id,
      type: r.type,
      contact_id: r.contact_id ?? null,
      case_id: r.case_id ?? null,
      conversation_id: r.conversation_id ?? null,
      actor_id: r.actor_id ?? null,
      from_value: r.from_value ?? null,
      to_value: r.to_value ?? null,
      meta: (r.meta ?? {}) as Json,
    })),
  );
  if (error) console.error("[cases] activity insert", error.message);
}

/** Tipos de notificación que crea el motor. */
export type NotificationType =
  | "case_assigned"
  | "case_unassigned"
  | "mention"
  | "case_activated"
  | "next_action_due"
  // Fase 2
  | "case_reassigned"
  | "wait_exceeded"
  | "auto_template_failed"
  // Fase 3
  | "sla_breached"
  // Diccionario de la tienda (corrector de la Bandeja)
  | "spell_word_request"
  | "spell_word_approved"
  | "spell_word_rejected";

export interface NotificationInput {
  workspace_id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** Crea notificaciones (una por persona, sin repetir). Los fallos solo se registran. */
export async function notify(db: Db, rows: NotificationInput[]): Promise<void> {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const key = `${r.user_id}|${r.type}|${r.link ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) return;
  const { error } = await db.from("notifications").insert(
    unique.map((r) => ({
      workspace_id: r.workspace_id,
      user_id: r.user_id,
      type: r.type,
      title: r.title.slice(0, 200),
      body: r.body ? r.body.slice(0, 500) : null,
      link: r.link ?? null,
    })),
  );
  if (error) console.error("[cases] notifications insert", error.message);
}

/** Dueño y administradores del espacio. */
export async function workspaceAdminIds(db: Db, workspaceId: string): Promise<string[]> {
  const { data } = await db
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .in("role", ["owner", "admin"]);
  return (data ?? []).map((r) => r.user_id);
}

/** Supervisores del equipo; sin equipo o sin supervisores, los administradores. */
export async function supervisorsOrAdmins(db: Db, workspaceId: string, teamId: string | null): Promise<string[]> {
  const supervisors = teamId ? await teamSupervisorIds(db, teamId) : [];
  return supervisors.length > 0 ? supervisors : workspaceAdminIds(db, workspaceId);
}

/** Supervisores de un equipo. */
export async function teamSupervisorIds(db: Db, teamId: string): Promise<string[]> {
  const { data } = await db
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId)
    .eq("role", "supervisor");
  return (data ?? []).map((r) => r.user_id);
}

export function contactName(contact: { display_name: string | null } | null | undefined): string {
  return contact?.display_name?.trim() || "Contacto sin nombre";
}

/** Primera etapa abierta (no archivada) de un tipo, o null. */
export async function firstOpenStageId(db: Db, caseTypeId: string): Promise<string | null> {
  const { data } = await db
    .from("case_stages")
    .select("id")
    .eq("case_type_id", caseTypeId)
    .eq("kind", "open")
    .is("archived_at", null)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/** Tipo de gestión del espacio (archivado o no), o null si no es del espacio. */
export async function loadCaseType(db: Db, workspaceId: string, caseTypeId: string): Promise<CaseTypeRow | null> {
  const { data } = await db
    .from("case_types")
    .select("*")
    .eq("id", caseTypeId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data ?? null;
}

export async function loadCase(db: Db, caseId: string): Promise<CaseRow | null> {
  const { data } = await db.from("cases").select("*").eq("id", caseId).maybeSingle();
  return data ?? null;
}

export async function loadContact(db: Db, workspaceId: string, contactId: string): Promise<ContactRow | null> {
  const { data } = await db
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data ?? null;
}

export async function isWorkspaceMember(db: Db, workspaceId: string, userId: string): Promise<boolean> {
  const { data } = await db
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

export async function loadActiveTeam(db: Db, workspaceId: string, teamId: string) {
  const { data } = await db
    .from("teams")
    .select("id, name, workspace_id, archived_at")
    .eq("id", teamId)
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .maybeSingle();
  return data ?? null;
}
