// Lógica pura de la campana de notificaciones (docs/FASE-1-TECNICO.md 4.5):
// lista en memoria, contador y enlaces seguros. Sin React ni Supabase para
// poder probarla con vitest.

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** Cuántas notificaciones se muestran en la lista desplegable. */
export const NOTIFICATION_LIST_LIMIT = 20;

export function isUnread(n: Pick<NotificationItem, "read_at">): boolean {
  return n.read_at === null;
}

export function unreadIds(list: readonly NotificationItem[]): string[] {
  return list.filter(isUnread).map((n) => n.id);
}

/** Texto del contador: nada si es 0, "99+" si pasa de 99. */
export function badgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** Más recientes primero; en empate de fecha se conserva el orden recibido. */
function sortNewestFirst(list: NotificationItem[]): NotificationItem[] {
  return list
    .map((n, i) => ({ n, i }))
    .sort((a, b) => {
      const diff = Date.parse(b.n.created_at) - Date.parse(a.n.created_at);
      return diff !== 0 && !Number.isNaN(diff) ? diff : a.i - b.i;
    })
    .map(({ n }) => n);
}

/**
 * Agrega o reemplaza una notificación (por `id`), ordena de la más reciente a
 * la más antigua y recorta a `limit`. No muta la lista original.
 */
export function upsertNotification(
  list: readonly NotificationItem[],
  incoming: NotificationItem,
  limit: number = NOTIFICATION_LIST_LIMIT,
): NotificationItem[] {
  const without = list.filter((n) => n.id !== incoming.id);
  return sortNewestFirst([incoming, ...without]).slice(0, limit);
}

/** Marca como leídas las indicadas (o todas con `"all"`), sin tocar las que ya lo estaban. */
export function markAsRead(
  list: readonly NotificationItem[],
  ids: readonly string[] | "all",
  readAt: string,
): NotificationItem[] {
  const wanted = ids === "all" ? null : new Set(ids);
  return list.map((n) =>
    n.read_at === null && (wanted === null || wanted.has(n.id)) ? { ...n, read_at: readAt } : n,
  );
}

/**
 * Enlace interno seguro: solo rutas de este sitio ("/dashboard/..."). Rechaza
 * URL absolutas, "//host" y "/\host" para que una notificación no pueda sacar
 * al usuario de la aplicación.
 */
export function safeInternalLink(link: string | null | undefined): string | null {
  if (typeof link !== "string") return null;
  const value = link.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  return value;
}
