// Reconciliación de la bandeja con lo que la base dice HOY (M-19): cuando una
// gestión se reasigna a otro asesor, la RLS deja de mostrársela al anterior y
// por eso Realtime ya no le avisa del cambio. Hay que volver a pedir las
// gestiones activas y quitar lo que ya no se ve.

import type { InboxCase, InboxConversation } from "./inbox-model";

/** Contactos que tenían gestiones activas en pantalla y ya no tienen ninguna visible. */
export function lostContactIds(previous: readonly InboxCase[], fresh: readonly InboxCase[]): string[] {
  const still = new Set(fresh.map((c) => c.contact_id));
  return [...new Set(previous.map((c) => c.contact_id))].filter((id) => !still.has(id));
}

/**
 * Quita los chats de los contactos que perdieron sus gestiones si la base ya no
 * se los entrega (`visibleIds`: los chats que siguen devolviéndose al usuario).
 */
export function dropHiddenConversations(
  conversations: readonly InboxConversation[],
  lostContacts: readonly string[],
  visibleIds: ReadonlySet<string>,
): InboxConversation[] {
  if (lostContacts.length === 0) return [...conversations];
  const lost = new Set(lostContacts);
  return conversations.filter((c) => !lost.has(c.contact_id) || visibleIds.has(c.id));
}

/** Las gestiones que llegaron de la base reemplazan a las de pantalla (la base manda). */
export function replaceActiveCases(fresh: readonly InboxCase[]): InboxCase[] {
  return [...fresh];
}

export const CASES_REFRESH_INTERVAL_MS = 60_000;
export const CASES_REFRESH_MIN_GAP_MS = 10_000;
