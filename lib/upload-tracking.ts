// Subidas pendientes y limpieza de archivos que nunca se enviaron (SEG-10).
//
// Cada enlace de subida que entrega el servidor (chat o respuesta guardada) se
// anota en `media_uploads` (migración 00043). Eso permite:
//   1. un TOPE por usuario de subidas sin usar (registerUpload);
//   2. que el cron diario borre del bucket los archivos que NADIE usó pasadas
//      ORPHAN_UPLOAD_AGE_MS horas (cleanOrphanUploads).
//
// Un archivo cuenta como usado si (a) se marcó used_at al enviar/guardar, o (b)
// aparece en message_media.storage_path (mensaje enviado) o en
// saved_replies.attachment_url (respuesta guardada). La limpieza comprueba (b)
// SIEMPRE antes de borrar, aunque used_at falte, y solo borra rutas con la forma
// exacta de una subida nuestra: {espacio}/conv/{chat}/out/{uuid}.ext o
// {espacio}/replies/{uuid}.ext del mismo espacio que la fila.
//
// Si la tabla no existe (migración sin aplicar) o la base falla, el tope NO
// bloquea (se deja pasar y se registra) y la limpieza no borra nada.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMediaPath } from "@/lib/chat-media";
import { removeObjects } from "@/lib/media-store";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/** Subidas sin usar que un usuario puede tener a la vez (últimas 24 h). */
export const PENDING_UPLOADS_MAX = 40;
export const PENDING_UPLOADS_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * Plazo antes de borrar un archivo sin usar. El enlace de subida dura 2 h y el
 * enlace firmado de envío 24 h después de enviar: a las 48 h nadie lo puede
 * estar usando ni Zernio descargándolo.
 */
export const ORPHAN_UPLOAD_AGE_MS = 48 * 60 * 60 * 1000;

export const PENDING_UPLOADS_MESSAGE =
  "Tienes varios archivos subidos que todavía no enviaste. Envíalos, o espera un momento, y vuelve a intentar.";

export type UploadSource = "chat" | "reply";

export type RegisterResult = { ok: true } | { ok: false; reason: "too_many_pending" };

/**
 * Anota el enlace de subida entregado. Devuelve `too_many_pending` si el usuario
 * ya tiene PENDING_UPLOADS_MAX sin usar. Un fallo de la base NO bloquea.
 */
export async function registerUpload(
  db: Db,
  upload: { workspaceId: string; userId: string; path: string; source: UploadSource },
  now: Date = new Date(),
): Promise<RegisterResult> {
  try {
    const since = new Date(now.getTime() - PENDING_UPLOADS_WINDOW_MS).toISOString();
    const { count, error } = await db
      .from("media_uploads")
      .select("path", { count: "exact", head: true })
      .eq("user_id", upload.userId)
      .is("used_at", null)
      .gte("created_at", since);
    if (error) {
      console.error("[uploads] no se pudo contar las subidas pendientes, se deja pasar:", error.message);
      return { ok: true };
    }
    if ((count ?? 0) >= PENDING_UPLOADS_MAX) return { ok: false, reason: "too_many_pending" };

    const { error: insertError } = await db.from("media_uploads").insert({
      path: upload.path,
      workspace_id: upload.workspaceId,
      user_id: upload.userId,
      source: upload.source,
      created_at: now.toISOString(),
    });
    if (insertError) console.error("[uploads] no se pudo anotar la subida:", insertError.message);
  } catch (err) {
    console.error("[uploads] no se pudo anotar la subida:", err);
  }
  return { ok: true };
}

/** Marca como usadas las subidas (al enviar el mensaje o guardar la respuesta). Nunca lanza. */
export async function markUploadsUsed(db: Db, paths: string[], now: Date = new Date()): Promise<void> {
  const list = paths.filter((p) => typeof p === "string" && p.length > 0);
  if (list.length === 0) return;
  try {
    const { error } = await db
      .from("media_uploads")
      .update({ used_at: now.toISOString() })
      .in("path", list)
      .is("used_at", null);
    if (error) console.error("[uploads] no se pudo marcar la subida como usada:", error.message);
  } catch (err) {
    console.error("[uploads] no se pudo marcar la subida como usada:", err);
  }
}

/** ¿La ruta tiene la forma exacta de una subida nuestra, del mismo espacio que su fila? */
export function isOwnedUploadPath(path: string, workspaceId: string, source: UploadSource): boolean {
  const parsed = parseMediaPath(path);
  if (!parsed || parsed.workspaceId !== workspaceId) return false;
  if (source === "reply") return parsed.kind === "replies";
  return parsed.kind === "conv" && parsed.direction === "out";
}

export interface CleanupResult {
  /** Filas revisadas. */
  checked: number;
  /** Ya usadas (se marcaron y no se tocan). */
  used: number;
  /** Archivos borrados del bucket. */
  removed: number;
  /** Filas con ruta rara: se descartan del registro sin borrar ningún archivo. */
  skipped: number;
  /** El almacenamiento falló: se reintenta mañana. */
  failed: boolean;
}

const BATCH = 200;
const MAX_BATCHES = 10;

/**
 * Borra del bucket los archivos subidos hace más de ORPHAN_UPLOAD_AGE_MS que
 * nadie usó. Devuelve null si no pudo ni leer el registro.
 */
export async function cleanOrphanUploads(
  db: Db,
  now: Date = new Date(),
  opts: { batch?: number; maxBatches?: number } = {},
): Promise<CleanupResult | null> {
  const batchSize = opts.batch ?? BATCH;
  const cutoff = new Date(now.getTime() - ORPHAN_UPLOAD_AGE_MS).toISOString();
  const result: CleanupResult = { checked: 0, used: 0, removed: 0, skipped: 0, failed: false };

  for (let i = 0; i < (opts.maxBatches ?? MAX_BATCHES); i++) {
    const { data: rows, error } = await db
      .from("media_uploads")
      .select("path, workspace_id, source")
      .is("used_at", null)
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(batchSize);
    if (error) {
      console.error("[uploads] no se pudo leer las subidas sin usar:", error.message);
      return i === 0 ? null : result;
    }
    if (!rows || rows.length === 0) break;
    result.checked += rows.length;

    const paths = rows.map((r) => r.path);
    // ¿Alguna ya está en un mensaje enviado o en una respuesta guardada?
    const [sent, replies] = await Promise.all([
      db.from("message_media").select("storage_path").in("storage_path", paths),
      db.from("saved_replies").select("attachment_url").in("attachment_url", paths),
    ]);
    if (sent.error || replies.error) {
      // Sin poder comprobarlo no se borra nada.
      console.error("[uploads] no se pudo comprobar el uso de las subidas:", sent.error?.message ?? replies.error?.message);
      result.failed = true;
      break;
    }
    const inUse = new Set<string>([
      ...(sent.data ?? []).map((r) => r.storage_path).filter((p): p is string => !!p),
      ...(replies.data ?? []).map((r) => r.attachment_url).filter((p): p is string => !!p),
    ]);

    const usedPaths = rows.filter((r) => inUse.has(r.path)).map((r) => r.path);
    const strange = rows.filter((r) => !inUse.has(r.path) && !isOwnedUploadPath(r.path, r.workspace_id, r.source));
    const doomed = rows.filter((r) => !inUse.has(r.path) && isOwnedUploadPath(r.path, r.workspace_id, r.source));

    if (usedPaths.length > 0) {
      await markUploadsUsed(db, usedPaths, now);
      result.used += usedPaths.length;
    }
    if (strange.length > 0) {
      // Nunca se borra el archivo de una ruta que no reconocemos; solo se olvida la fila.
      const { error: delError } = await db.from("media_uploads").delete().in("path", strange.map((r) => r.path));
      if (delError) {
        console.error("[uploads] no se pudieron descartar filas raras:", delError.message);
        result.failed = true;
        break;
      }
      result.skipped += strange.length;
    }
    if (doomed.length > 0) {
      const doomedPaths = doomed.map((r) => r.path);
      // Si el almacenamiento falla, no se olvidan las filas: se reintenta mañana.
      if (!(await removeObjects(db, doomedPaths))) {
        result.failed = true;
        break;
      }
      const { error: delError } = await db.from("media_uploads").delete().in("path", doomedPaths);
      if (delError) {
        console.error("[uploads] no se pudo limpiar el registro de subidas:", delError.message);
        result.failed = true;
        break;
      }
      result.removed += doomed.length;
    }
    if (rows.length < batchSize) break;
  }
  return result;
}
