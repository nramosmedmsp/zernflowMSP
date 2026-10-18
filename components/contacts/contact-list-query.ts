// Consulta de la lista de contactos (pura, probada con vitest): lee los
// filtros de la URL y arma la consulta que corre en el servidor con el cliente
// del usuario, para que la RLS decida qué contactos ve.

import { ilikePattern } from "@/components/cases/case-filters";
import { isDateString } from "@/lib/cases/dates";
import { NO_VALUE_FILTER } from "./contact-filters";

export const CONTACTS_PAGE_SIZE = 50;

export const CONTACT_SORTS = ["recent", "name", "created", "key_date"] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];

export const CONTACT_SORT_LABELS: Record<ContactSort, string> = {
  recent: "Última interacción",
  name: "Nombre",
  created: "Fecha de creación",
  key_date: "Fecha clave",
};

export interface ContactListParams {
  search: string;
  /** "" = todos, "none" = sin tipo, o el id del tipo. */
  typeId: string;
  ownerId: string;
  teamId: string;
  /** "" = todas. */
  tagId: string;
  /** Rango de fecha clave "YYYY-MM-DD"; "" = sin límite. */
  keyFrom: string;
  keyTo: string;
  sort: ContactSort;
  dir: "asc" | "desc";
  /** Desde 1. */
  page: number;
}

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SEARCH = 80;

const DEFAULT_DIR: Record<ContactSort, "asc" | "desc"> = {
  recent: "desc",
  name: "asc",
  created: "desc",
  key_date: "asc",
};

export function defaultDirFor(sort: ContactSort): "asc" | "desc" {
  return DEFAULT_DIR[sort];
}

function read(raw: RawParams, key: string): string {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? "";
  const v = raw[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function idParam(value: string): string {
  return value === NO_VALUE_FILTER || UUID_RE.test(value) ? value : "";
}

/** Valores no válidos se descartan (la URL la puede escribir cualquiera). */
export function parseContactListParams(raw: RawParams): ContactListParams {
  const sortRaw = read(raw, "sort");
  const sort = (CONTACT_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as ContactSort) : "recent";
  const dirRaw = read(raw, "dir");
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : DEFAULT_DIR[sort];
  const tag = read(raw, "tag");
  const from = read(raw, "from");
  const to = read(raw, "to");
  const page = Number.parseInt(read(raw, "page"), 10);
  return {
    search: read(raw, "q").trim().slice(0, MAX_SEARCH),
    typeId: idParam(read(raw, "type")),
    ownerId: idParam(read(raw, "owner")),
    teamId: idParam(read(raw, "team")),
    tagId: UUID_RE.test(tag) ? tag : "",
    keyFrom: isDateString(from) ? from : "",
    keyTo: isDateString(to) ? to : "",
    sort,
    dir,
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100_000) : 1,
  };
}

/** Parámetros de la URL; omite lo que está en su valor por defecto. */
export function contactListSearchParams(p: ContactListParams): URLSearchParams {
  const out = new URLSearchParams();
  if (p.search) out.set("q", p.search);
  if (p.typeId) out.set("type", p.typeId);
  if (p.ownerId) out.set("owner", p.ownerId);
  if (p.teamId) out.set("team", p.teamId);
  if (p.tagId) out.set("tag", p.tagId);
  if (p.keyFrom) out.set("from", p.keyFrom);
  if (p.keyTo) out.set("to", p.keyTo);
  if (p.sort !== "recent") out.set("sort", p.sort);
  if (p.dir !== DEFAULT_DIR[p.sort]) out.set("dir", p.dir);
  if (p.page > 1) out.set("page", String(p.page));
  return out;
}

export function contactListHref(p: ContactListParams, basePath = "/dashboard/contacts"): string {
  const qs = contactListSearchParams(p).toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function hasContactFilters(p: ContactListParams): boolean {
  return !!(p.search || p.typeId || p.ownerId || p.teamId || p.tagId || p.keyFrom || p.keyTo);
}

/** Rango (desde, hasta) de filas de PostgREST para la página; `to` es inclusivo. */
export function contactPageRange(page: number, pageSize = CONTACTS_PAGE_SIZE): { from: number; to: number } {
  const from = (Math.max(1, page) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function contactPageCount(total: number, pageSize = CONTACTS_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Columnas de la consulta; con filtro de etiqueta se agrega un join interno con otro alias. */
export const CONTACT_LIST_SELECT = "*, contact_tags(tag_id, tags(*))";
export const CONTACT_LIST_SELECT_BY_TAG = "*, contact_tags(tag_id, tags(*)), tag_filter:contact_tags!inner(tag_id)";

export function contactListSelect(p: ContactListParams): string {
  return p.tagId ? CONTACT_LIST_SELECT_BY_TAG : CONTACT_LIST_SELECT;
}

/** Lo mínimo del constructor de consultas de Supabase que usamos (cada método devuelve el mismo constructor). */
export interface ContactQueryBuilder {
  eq(column: string, value: string): this;
  is(column: string, value: null): this;
  or(filters: string): this;
  gte(column: string, value: string): this;
  lte(column: string, value: string): this;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this;
  range(from: number, to: number): this;
}

/** Texto de búsqueda sin lo que rompería la condición `or` de PostgREST. */
export function cleanSearch(text: string): string {
  return text.replace(/[,()"*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH);
}

function applyId<Q extends ContactQueryBuilder>(q: Q, column: string, value: string): Q {
  if (!value) return q;
  return value === NO_VALUE_FILTER ? q.is(column, null) : q.eq(column, value);
}

/** Filtros, orden y página sobre una consulta de `contacts` (el espacio se filtra aparte). */
export function applyContactListQuery<Q extends ContactQueryBuilder>(query: Q, p: ContactListParams): Q {
  let q = query;
  const text = cleanSearch(p.search);
  if (text) {
    const pattern = ilikePattern(text);
    q = q.or(`display_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`);
  }
  q = applyId(q, "contact_type_id", p.typeId);
  q = applyId(q, "owner_id", p.ownerId);
  q = applyId(q, "team_id", p.teamId);
  if (p.tagId) q = q.eq("tag_filter.tag_id", p.tagId);
  if (p.keyFrom) q = q.gte("key_date", p.keyFrom);
  if (p.keyTo) q = q.lte("key_date", p.keyTo);

  const ascending = p.dir === "asc";
  switch (p.sort) {
    case "name":
      q = q.order("display_name", { ascending, nullsFirst: false });
      break;
    case "created":
      q = q.order("created_at", { ascending });
      break;
    case "key_date":
      q = q.order("key_date", { ascending, nullsFirst: false });
      break;
    default:
      q = q.order("last_interaction_at", { ascending, nullsFirst: false });
  }
  // Desempate estable para que las páginas no repitan ni salten filas.
  q = q.order("id", { ascending: true });
  const { from, to } = contactPageRange(p.page);
  return q.range(from, to);
}
