// Lectura del Registro de cambios (Configuración). El código que llama debe haber
// comprobado ANTES que quien mira es Dueño o Administrador (assertAuditLogReader);
// aquí además se acota todo al espacio y la base (política activity_select) solo deja
// leer estas filas a un administrador del espacio.
//
// Paginación por clave (fecha, id), nunca por OFFSET: cada página pide 50 filas más una
// para saber si hay más, con el índice parcial idx_activity_audit_log (00049).

import type { Db } from "@/lib/cases/io";
import { isAdminRole } from "@/lib/permissions";
import { displayName } from "@/lib/team-rules";
import { logPeriodSince, parseLogPeriod, type LogPeriod } from "@/lib/view-as/ui-rules";
import {
  AUDIT_ROW_FILTER,
  auditActorLabel,
  auditCategoryFilter,
  auditLookupIds,
  describeAudit,
  parseAuditCategory,
  type AuditCategory,
} from "@/lib/audit-labels";

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_NOT_ALLOWED_MESSAGE = "Solo el Dueño o un Administrador pueden ver el registro de cambios.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))\|(\d{1,19})$/;

export function canReadAuditLog(role: string | null | undefined): boolean {
  return isAdminRole(role);
}

export interface AuditFilters {
  /** "" = todas; "system" = lo automático; o el id de una persona. */
  person: string;
  category: AuditCategory | "";
  period: LogPeriod;
}

export const DEFAULT_AUDIT_FILTERS: AuditFilters = { person: "", category: "", period: "30" };

/** Filtros desde la dirección o desde el navegador: lo inválido se ignora, nunca se usa tal cual. */
export function parseAuditFilters(raw: { persona?: unknown; tipo?: unknown; periodo?: unknown } | null | undefined): AuditFilters {
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const person = first(raw?.persona);
  return {
    person: person === "system" ? "system" : typeof person === "string" && UUID.test(person) ? person.toLowerCase() : "",
    category: parseAuditCategory(first(raw?.tipo)),
    period: parseLogPeriod(typeof first(raw?.periodo) === "string" ? (first(raw?.periodo) as string) : undefined),
  };
}

export interface AuditCursor {
  createdAt: string;
  id: string;
}

export function encodeAuditCursor(row: { created_at: string; id: number | string }): string {
  return `${row.created_at}|${row.id}`;
}

export function parseAuditCursor(raw: unknown): AuditCursor | null {
  if (typeof raw !== "string") return null;
  const m = CURSOR.exec(raw);
  return m ? { createdAt: m[1], id: m[2] } : null;
}

export interface AuditEntry {
  id: string;
  createdAt: string;
  actorName: string;
  title: string;
  details: string[];
  category: AuditCategory | null;
}

export interface AuditPage {
  entries: AuditEntry[];
  /** Clave para pedir la siguiente página; null cuando ya no hay más. */
  nextCursor: string | null;
}

export interface AuditPerson {
  id: string;
  name: string;
}

interface RawRow {
  id: number | string;
  contact_id: string | null;
  type: string;
  actor_id: string | null;
  from_value: string | null;
  to_value: string | null;
  meta: unknown;
  created_at: string;
}

const COLUMNS = "id, contact_id, type, actor_id, from_value, to_value, meta, created_at";
/** Filas cuyo texto nombra a un cliente (los datos eliminados nunca se nombran). */
const NAMES_CONTACT = new Set(["contact_data_corrected", "contact_data_exported", "contact_subscribed", "contact_unsubscribed"]);

/** Nombres de personas por id, con el cliente de servicio (Auth). Lo que no existe no aparece. */
export async function loadPersonNames(service: Db, ids: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    [...new Set(ids)].filter((id) => UUID.test(id)).map(async (id) => {
      try {
        const { data } = await service.auth.admin.getUserById(id);
        const user = data?.user;
        if (user) out[id] = displayName({ id: user.id, email: user.email, user_metadata: user.user_metadata });
      } catch {
        // sin nombre: se mostrará «Persona eliminada»
      }
    }),
  );
  return out;
}

async function lookup(db: Db, table: "broadcasts" | "channels" | "flows", workspaceId: string, ids: string[], column: string) {
  if (ids.length === 0) return {} as Record<string, string>;
  const { data } = (await (db as unknown as { from: (t: string) => any })
    .from(table)
    .select(`id, ${column}`)
    .eq("workspace_id", workspaceId)
    .in("id", ids)) as { data: Record<string, string | null>[] | null };
  const out: Record<string, string> = {};
  for (const r of data ?? []) {
    const name = r[column];
    if (typeof name === "string" && name.trim()) out[r.id as string] = name.trim();
  }
  return out;
}

/**
 * Una página del registro. `db` es el cliente de la sesión (la política de `activity` deja
 * leer estas filas al administrador); `service` solo se usa para los nombres (Auth).
 */
export async function loadAuditPage(
  db: Db,
  service: Db,
  params: { workspaceId: string; filters: AuditFilters; cursor?: string | null; now?: number },
): Promise<AuditPage | { error: string }> {
  const { workspaceId, filters } = params;
  const cursor = parseAuditCursor(params.cursor);

  let query = db
    .from("activity")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .or(AUDIT_ROW_FILTER);
  if (filters.category) query = query.or(auditCategoryFilter(filters.category));
  if (filters.person === "system") query = query.is("actor_id", null);
  else if (filters.person) query = query.eq("actor_id", filters.person);
  const since = logPeriodSince(filters.period, params.now ?? Date.now());
  if (since) query = query.gte("created_at", since);
  if (cursor) {
    query = query.or(`created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AUDIT_PAGE_SIZE + 1);
  if (error) {
    console.error("[audit-log] lectura", error.message);
    return { error: "No se pudo cargar el registro. Inténtalo de nuevo." };
  }

  const all = (data ?? []) as unknown as RawRow[];
  const rows = all.slice(0, AUDIT_PAGE_SIZE);
  const hasMore = all.length > AUDIT_PAGE_SIZE;

  const ids = auditLookupIds(rows);
  const contactIds = [...new Set(rows.filter((r) => r.contact_id && NAMES_CONTACT.has(r.type)).map((r) => r.contact_id as string))];
  const [names, broadcasts, channels, flows, contacts] = await Promise.all([
    loadPersonNames(service, [...rows.map((r) => r.actor_id).filter((x): x is string => !!x), ...ids.people]),
    lookup(db, "broadcasts", workspaceId, ids.broadcasts, "name"),
    lookup(db, "channels", workspaceId, ids.channels, "display_name"),
    lookup(db, "flows", workspaceId, ids.flows, "name"),
    contactIds.length
      ? db
          .from("contacts")
          .select("id, display_name")
          .eq("workspace_id", workspaceId)
          .is("erased_at", null)
          .in("id", contactIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ]);
  const contactNames: Record<string, string> = {};
  for (const c of (contacts.data ?? []) as { id: string; display_name: string | null }[]) {
    if (c.display_name?.trim()) contactNames[c.id] = c.display_name.trim();
  }

  const entries: AuditEntry[] = rows.map((row) => {
    const d = describeAudit(row, {
      people: names,
      broadcasts,
      channels,
      flows,
      contactName: row.contact_id ? (contactNames[row.contact_id] ?? null) : null,
    });
    return {
      id: String(row.id),
      createdAt: row.created_at,
      actorName: auditActorLabel(row.actor_id, names),
      title: d.title,
      details: d.details,
      category: d.category,
    };
  });
  return { entries, nextCursor: hasMore && rows.length > 0 ? encodeAuditCursor(rows[rows.length - 1]) : null };
}

/** Personas para el filtro: las del equipo ahora más las que aparecen como autoras en el registro. */
export async function loadAuditPeople(db: Db, service: Db, workspaceId: string): Promise<AuditPerson[]> {
  const [members, actors] = await Promise.all([
    db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId),
    db
      .from("activity")
      .select("actor_id")
      .eq("workspace_id", workspaceId)
      .or(AUDIT_ROW_FILTER)
      .not("actor_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  const ids = new Set<string>();
  for (const m of (members.data ?? []) as { user_id: string }[]) ids.add(m.user_id);
  for (const a of (actors.data ?? []) as { actor_id: string | null }[]) if (a.actor_id) ids.add(a.actor_id);
  const names = await loadPersonNames(service, [...ids]);
  return [...ids]
    .map((id) => ({ id, name: names[id] ?? "Persona eliminada" }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}
