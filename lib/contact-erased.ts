// Cliente eliminado = ficha SOLO DE LECTURA (PRIV-06).
//
// Criterio único: `contacts.erased_at` no es nulo. Solo lo escribe erase_contact_data
// (migración 00044), en la misma transacción que vacía el contacto, y nada lo vuelve a
// poner en nulo. (`marketing_source = 'erased'` y la fila de contact_erasures dicen lo
// mismo, pero erased_at ya viene en el contacto: no hace falta otra consulta.)
//
// Este archivo es puro (sin servidor ni React): lo usan las acciones, las rutas y las
// pantallas. La comprobación contra la base está en lib/contact-erased-guard.ts.

import { formatDateTime } from "@/lib/format";

/** Mensaje cuando alguien intenta cambiar o escribir sobre un cliente eliminado. */
export const ERASED_READONLY_MESSAGE = "Los datos de este cliente se eliminaron. La ficha es solo de lectura.";

/** Nombre que se muestra cuando el contacto eliminado no tiene nombre. */
export const ERASED_DISPLAY_NAME = "Cliente eliminado";

/** Aviso del chat de un cliente eliminado (en lugar de la caja de mensaje). */
export const ERASED_CHAT_MESSAGE =
  "Los datos de este cliente se eliminaron. No se pueden enviar mensajes ni escribir notas en este chat.";

/** Lugar de los campos de nota de una gestión de un cliente eliminado (el servidor rechaza esas notas). */
export const ERASED_NO_NOTES_MESSAGE = "Cliente eliminado: no se pueden escribir notas.";
export const ERASED_SUPERVISOR_ADVANCE_MESSAGE = "Un supervisor puede pasar la gestión de etapa.";

/** Aviso en la guía de la gestión; la segunda frase solo si el requisito de nota está frenando el avance. */
export function erasedNoNotesNotice(noteBlocksAdvance: boolean): string {
  return noteBlocksAdvance ? `${ERASED_NO_NOTES_MESSAGE} ${ERASED_SUPERVISOR_ADVANCE_MESSAGE}` : ERASED_NO_NOTES_MESSAGE;
}

export interface ErasableContact {
  erased_at?: string | null;
}

/** ¿Se eliminaron los datos de este cliente? */
export function isContactErased(contact: ErasableContact | null | undefined): boolean {
  return !!contact && typeof contact.erased_at === "string" && contact.erased_at.length > 0;
}

/**
 * Aviso de la ficha. `byName` solo se pasa a Dueño y Administrador (quien eliminó
 * los datos); para el resto se omite.
 */
export function erasedNotice(erasedAt: string | null | undefined, byName?: string | null): string {
  const when = erasedAt ? formatDateTime(erasedAt) : "";
  const who = byName ? ` por ${byName}` : "";
  const head = when ? `Los datos de este cliente se eliminaron el ${when}${who}.` : `Los datos de este cliente se eliminaron${who}.`;
  return `${head} La ficha es solo de lectura.`;
}

/** Nombre para mostrar: el de siempre, y «Cliente eliminado» si es un cliente eliminado sin nombre. */
export function displayNameFor(
  contact: (ErasableContact & { display_name?: string | null }) | null | undefined,
  fallback: string,
): string {
  const name = contact?.display_name?.trim();
  if (name) return name;
  return isContactErased(contact) ? ERASED_DISPLAY_NAME : fallback;
}
