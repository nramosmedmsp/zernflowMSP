// Carga de la Bandeja sin recortes silenciosos (Tanda 4, BD-7 / CONF-12).
//
// * Gestiones activas: se leen TODAS por páginas hasta el final (tope de
//   seguridad MAX_ACTIVE_CASES); si se llega al tope se avisa en pantalla. Los
//   contadores de las vistas salen de ellas, por eso deben estar completas.
// * La relectura (cada 60 s) no vuelve a traer todo: pide solo id + fecha de
//   cambio y trae completas únicamente las nuevas o modificadas (`diffActiveCases`).
// * Chats sin gestión activa (solo se ven en "Todos / Todo"): páginas de
//   INBOX_PAGE_SIZE con "Cargar más".

import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/metrics/paging";
import type { Database } from "@/lib/types/database";
import type { InboxCase } from "./inbox-model";

type Db = SupabaseClient<Database>;

/** Chats por página en "Todos / Todo" y en la primera carga. */
export const INBOX_PAGE_SIZE = 100;
/** Tope de seguridad de gestiones activas leídas (por página de 1 000). */
export const MAX_ACTIVE_CASES = 10_000;
/** Resultados máximos que muestra la búsqueda del servidor. */
export const SEARCH_RESULT_LIMIT = 100;
/** Letras mínimas para buscar en el servidor (antes solo filtra lo ya cargado). */
export const MIN_SERVER_SEARCH_CHARS = 2;
/** Si cambiaron más gestiones que esto entre dos relecturas, se vuelve a leer todo. */
export const MAX_INCREMENTAL_FETCH = 500;
export const FETCH_IN_CHUNK = 150;

export interface ActiveCases {
  cases: InboxCase[];
  /** Hay más gestiones activas que el tope: los contadores pueden quedar cortos. */
  truncated: boolean;
}

/** Todas las gestiones activas visibles para la persona (la RLS decide), las más urgentes primero. */
export async function loadActiveCases(db: Db, workspaceId: string): Promise<ActiveCases> {
  const res = await readAllPages<InboxCase>(
    (from, to) =>
      db
        .from("cases")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("status", ["open", "scheduled"])
        .order("waiting_since", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: InboxCase[] | null; error: { message: string } | null }>,
    { max: MAX_ACTIVE_CASES },
  );
  if (res.error) throw new Error(`No se pudieron leer las gestiones: ${res.error}`);
  return { cases: res.rows, truncated: res.truncated };
}

export interface CaseStamp {
  id: string;
  updated_at: string;
}

/** Solo id y fecha de cambio de las gestiones activas (liviano, para comparar). */
export async function loadActiveStamps(db: Db, workspaceId: string): Promise<{ stamps: CaseStamp[]; truncated: boolean } | null> {
  const res = await readAllPages<CaseStamp>(
    (from, to) =>
      db
        .from("cases")
        .select("id, updated_at")
        .eq("workspace_id", workspaceId)
        .in("status", ["open", "scheduled"])
        .order("waiting_since", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: CaseStamp[] | null; error: { message: string } | null }>,
    { max: MAX_ACTIVE_CASES },
  );
  if (res.error) return null;
  return { stamps: res.rows, truncated: res.truncated };
}

/**
 * Compara lo que hay en pantalla con lo que la base dice hoy: qué gestiones ya no
 * se ven (cerradas o reasignadas a otra persona) y cuáles hay que traer completas
 * (nuevas o con fecha de cambio distinta).
 */
export function diffActiveCases(
  local: readonly Pick<InboxCase, "id" | "updated_at">[],
  remote: readonly CaseStamp[],
): { removedIds: string[]; fetchIds: string[] } {
  const localById = new Map(local.map((c) => [c.id, c.updated_at]));
  const remoteIds = new Set(remote.map((r) => r.id));
  // Se comparan instantes, no textos: Realtime y la API pueden escribir la misma hora con otro formato.
  const same = (a: string | undefined, b: string) => a !== undefined && (a === b || Date.parse(a) === Date.parse(b));
  const fetchIds = remote.filter((r) => !same(localById.get(r.id), r.updated_at)).map((r) => r.id);
  const removedIds = local.filter((c) => !remoteIds.has(c.id)).map((c) => c.id);
  return { removedIds, fetchIds };
}

/** Aplica el resultado de `diffActiveCases`: quita lo que ya no se ve y reemplaza o agrega lo traído. */
export function applyCaseDiff(local: readonly InboxCase[], removedIds: readonly string[], fetched: readonly InboxCase[]): InboxCase[] {
  const removed = new Set(removedIds);
  const fresh = new Map(fetched.map((c) => [c.id, c]));
  const out: InboxCase[] = [];
  for (const c of local) {
    if (removed.has(c.id)) continue;
    out.push(fresh.get(c.id) ?? c);
    fresh.delete(c.id);
  }
  out.push(...fresh.values());
  return out;
}

export function chunkList<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** ¿Vale la pena preguntar al servidor por este texto? */
export function shouldSearchServer(text: string): boolean {
  return text.trim().length >= MIN_SERVER_SEARCH_CHARS;
}

/** Cursor para "Cargar más": el último mensaje más antiguo de los chats ya cargados por página. */
export function oldestMessageAt(list: readonly { last_message_at: string | null }[]): string | null {
  let oldest: string | null = null;
  for (const c of list) {
    if (!c.last_message_at) continue;
    if (oldest === null || c.last_message_at < oldest) oldest = c.last_message_at;
  }
  return oldest;
}
