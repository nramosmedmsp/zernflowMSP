// Borrado de los datos de un cliente (PRIV-06). Servidor, con el cliente de
// servicio; los permisos (Dueño o Administrador, confirmación escrita, "Ver como")
// los comprueba la acción que lo llama (lib/actions/contact-privacy.ts).
//
// Dos fases, para no dejar nada a medias:
//   1. La base hace todo lo que es de filas en UNA transacción
//      (erase_contact_data, migración 00044): anonimiza el contacto, quita
//      mensajes, notas, canales, campos... y anota en contact_erasures qué
//      archivos del almacenamiento hay que borrar. Si falla, no cambia nada.
//   2. La app borra esos archivos del bucket. Si algo falla, la lista pendiente
//      queda guardada (files_pending, last_file_error) y se reintenta con
//      retryErasureFiles hasta que quede vacía.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media";
import { logActivity } from "@/lib/cases/io";
import type { Database } from "@/lib/types/database";

export { erasureConfirmationMatches, erasureConfirmationWord } from "@/lib/erase-confirmation";

type Db = SupabaseClient<Database>;

/** Archivos por llamada al almacenamiento. */
export const REMOVE_CHUNK = 100;

export interface ErasureSummary {
  conversations: number;
  messages: number;
  files: number;
  notes: number;
  casesKept: number;
  claimsKept: number;
}

export type EraseOutcome =
  | { ok: true; alreadyErased: true }
  | {
      ok: true;
      alreadyErased: false;
      erasureId: string;
      summary: ErasureSummary;
      /** Archivos que no se pudieron borrar (0 = todo borrado). */
      filesPending: number;
    }
  | { ok: false; code: "not_found" | "failed" };

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseErasureSummary(raw: unknown): ErasureSummary {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    conversations: toNumber(r.conversations),
    messages: toNumber(r.messages),
    files: toNumber(r.files),
    notes: toNumber(r.notes),
    casesKept: toNumber(r.cases_kept),
    claimsKept: toNumber(r.claims_kept),
  };
}

export interface RemoveFilesResult {
  pending: string[];
  error: string | null;
}

/** Borra del bucket los archivos de la lista; devuelve los que quedaron sin borrar. */
export async function removeFiles(db: Db, paths: readonly string[]): Promise<RemoveFilesResult> {
  const pending: string[] = [];
  let error: string | null = null;
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const chunk = paths.slice(i, i + REMOVE_CHUNK);
    try {
      const res = await db.storage.from(CHAT_MEDIA_BUCKET).remove([...chunk]);
      if (res.error) {
        pending.push(...chunk);
        error = res.error.message || "No se pudo borrar un grupo de archivos.";
      }
    } catch (err) {
      pending.push(...chunk);
      error = err instanceof Error ? err.message : "No se pudo borrar un grupo de archivos.";
    }
  }
  return { pending, error };
}

/** Guarda en contact_erasures cuántos archivos faltan (y por qué) tras un intento. */
async function saveFileProgress(db: Db, erasureId: string, attemptsBefore: number, result: RemoveFilesResult): Promise<void> {
  const { error } = await db
    .from("contact_erasures")
    .update({
      files_pending: result.pending,
      files_done_at: result.pending.length === 0 ? new Date().toISOString() : null,
      last_file_error: result.pending.length === 0 ? null : (result.error ?? "No se pudo borrar algún archivo.").slice(0, 300),
      file_attempts: attemptsBefore + 1,
    })
    .eq("id", erasureId);
  if (error) console.error("[contact-erase] no se pudo guardar el avance de los archivos:", error.message);
}

/**
 * Borra los datos del cliente. `contactId` tiene que ser de `workspaceId`
 * (la acción ya comprobó permisos y confirmación).
 */
export async function eraseContactData(
  db: Db,
  params: { workspaceId: string; contactId: string; actorId: string },
): Promise<EraseOutcome> {
  const { data, error } = await db.rpc("erase_contact_data", {
    p_workspace_id: params.workspaceId,
    p_contact_id: params.contactId,
    p_actor_id: params.actorId,
  });
  if (error) {
    if (error.message?.includes("contact_not_found")) return { ok: false, code: "not_found" };
    console.error("[contact-erase] erase_contact_data:", error.message);
    return { ok: false, code: "failed" };
  }
  const result = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  if (result.already_erased === true) return { ok: true, alreadyErased: true };

  const erasureId = typeof result.erasure_id === "string" ? result.erasure_id : "";
  const paths = Array.isArray(result.paths) ? result.paths.filter((p): p is string => typeof p === "string") : [];
  if (!erasureId) {
    console.error("[contact-erase] la base no devolvió el id del borrado");
    return { ok: false, code: "failed" };
  }

  let filesPending = 0;
  if (paths.length > 0) {
    const removed = await removeFiles(db, paths);
    filesPending = removed.pending.length;
    await saveFileProgress(db, erasureId, 0, removed);
  }
  return { ok: true, alreadyErased: false, erasureId, summary: parseErasureSummary(result.summary), filesPending };
}

export type RetryOutcome =
  | { ok: true; filesPending: number }
  | { ok: false; code: "not_found" | "failed" };

/** Reintenta borrar los archivos que quedaron pendientes de un borrado. */
export async function retryErasureFiles(
  db: Db,
  params: { workspaceId: string; erasureId: string; actorId: string },
): Promise<RetryOutcome> {
  const { data: row, error } = await db
    .from("contact_erasures")
    .select("id, contact_id, files_pending, file_attempts")
    .eq("id", params.erasureId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[contact-erase] leer borrado:", error.message);
    return { ok: false, code: "failed" };
  }
  if (!row) return { ok: false, code: "not_found" };
  const paths = row.files_pending ?? [];
  if (paths.length === 0) return { ok: true, filesPending: 0 };

  const removed = await removeFiles(db, paths);
  await saveFileProgress(db, row.id, row.file_attempts ?? 0, removed);
  await logActivity(db, {
    workspace_id: params.workspaceId,
    type: "contact_data_erase_files_retried",
    contact_id: row.contact_id,
    actor_id: params.actorId,
    meta: { erasure_id: row.id, pending: removed.pending.length },
  });
  return { ok: true, filesPending: removed.pending.length };
}
