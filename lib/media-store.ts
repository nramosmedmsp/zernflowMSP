// Acceso al bucket privado "chat-media" con el cliente de servicio. Solo para
// el servidor, después de comprobar con el cliente del usuario (RLS) que la
// persona puede ver el chat o la respuesta guardada.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MessageMediaKind } from "@/lib/types/database";
import {
  CHAT_MEDIA_BUCKET,
  MAX_FILE_BYTES,
  ALLOWED_MIMES,
  baseMime,
  conversationMediaPath,
  extensionFor,
  inboundFetchPlan,
  kindFromAttachmentType,
  parseMediaPath,
  safeFileName,
  validateOutgoingAttachment,
} from "@/lib/chat-media";

type Db = SupabaseClient<Database>;

export interface StoredObject {
  size: number;
  mime: string;
}

function bucket(service: Db) {
  return service.storage.from(CHAT_MEDIA_BUCKET);
}

/** Tamaño y tipo reales del archivo guardado (no los que dice el navegador). */
export async function objectInfo(service: Db, path: string): Promise<StoredObject | null> {
  const { data, error } = await bucket(service).info(path);
  if (error || !data) return null;
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const size = Number(data.size ?? meta.size ?? NaN);
  const mime = baseMime(String(data.contentType ?? meta.mimetype ?? ""));
  if (!Number.isFinite(size)) return null;
  return { size, mime };
}

/** Enlace de subida firmado para el navegador (dura 2 horas, es de un solo archivo). */
export async function createUploadUrl(service: Db, path: string): Promise<{ path: string; token: string } | null> {
  const { data, error } = await bucket(service).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[media] createSignedUploadUrl", error?.message);
    return null;
  }
  return { path: data.path, token: data.token };
}

/** Enlace firmado de lectura. Con `downloadName`, el navegador lo descarga con ese nombre. */
export async function signedUrl(
  service: Db,
  path: string,
  seconds: number,
  downloadName?: string | null,
): Promise<string | null> {
  const { data, error } = await bucket(service).createSignedUrl(path, seconds, downloadName ? { download: safeFileName(downloadName) } : undefined);
  if (error || !data) {
    console.error("[media] createSignedUrl", error?.message);
    return null;
  }
  return data.signedUrl;
}

export async function copyObject(service: Db, from: string, to: string): Promise<boolean> {
  const { error } = await bucket(service).copy(from, to);
  if (error) console.error("[media] copy", error.message);
  return !error;
}

export async function removeObjects(service: Db, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  const { error } = await bucket(service).remove(paths);
  if (error) console.error("[media] remove", error.message);
  return !error;
}

// ── Copia de lo que llega ──────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 20_000;

async function readCapped(res: Response, cap: number): Promise<Uint8Array | "too_large"> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > cap) return "too_large";
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Veces que se intenta copiar un archivo recibido antes de darlo por perdido (M-13). */
export const MAX_MEDIA_ATTEMPTS = 3;

/** ¿Se puede volver a intentar la copia? Solo los "fallidos" (no los muy pesados ni los vencidos) y con límite. */
export function canRetryMedia(row: { status: string; fetch_attempts?: number | null }): boolean {
  return row.status === "failed" && (row.fetch_attempts ?? 1) < MAX_MEDIA_ATTEMPTS;
}

export interface InboundAttachmentInput {
  type?: string | null;
  url?: string | null;
  /** Nombre que mandó el cliente (documentos). */
  filename?: string | null;
}

export type FetchedMedia =
  | { status: "stored"; bytes: Uint8Array; mime: string; kind: MessageMediaKind }
  | { status: "too_large" | "failed"; kind: MessageMediaKind };

/** Descarga un adjunto (con la clave de Zernio solo si el host es zernio.com). */
export async function fetchAttachment(att: InboundAttachmentInput, apiKey: string | null): Promise<FetchedMedia> {
  const kind = kindFromAttachmentType(att.type);
  const plan = att.url ? inboundFetchPlan(att.url) : { ok: false as const };
  if (!plan.ok || !att.url) return { status: "failed", kind };
  if (plan.withApiKey && !apiKey) return { status: "failed", kind };
  try {
    const res = await fetch(att.url, {
      headers: plan.withApiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return { status: "failed", kind };
    const mime = baseMime(res.headers.get("content-type"));
    const body = await readCapped(res, MAX_FILE_BYTES);
    if (body === "too_large") return { status: "too_large", kind };
    if (!ALLOWED_MIMES.has(mime)) return { status: "failed", kind };
    return { status: "stored", bytes: body, mime, kind: kindFromAttachmentType(att.type, mime) };
  } catch (err) {
    console.error("[media] fetch inbound", err);
    return { status: "failed", kind };
  }
}

/**
 * Guarda una copia de los adjuntos de un mensaje entrante y registra cada uno
 * en message_media (también los que no se pudieron guardar, para mostrarlo).
 * WhatsApp borra los archivos a los pocos días: se copian al recibirlos.
 */
export async function storeInboundMedia(
  service: Db,
  params: {
    workspaceId: string;
    conversationId: string;
    platformMessageId: string;
    attachments: InboundAttachmentInput[];
    apiKey: string | null;
    /** Índice del primer adjunto de la lista (por defecto 0). */
    firstIndex?: number;
    /**
     * Reintento de un archivo que había fallado: reemplaza la fila existente y
     * guarda en cuántos intentos va. Sin esto, una fila ya registrada se respeta.
     */
    retryAttempt?: number;
  },
): Promise<void> {
  const list = params.attachments.slice(0, 5);
  const offset = params.firstIndex ?? 0;
  await Promise.all(
    list.map(async (att, i) => {
      const index = offset + i;
      const fetched = await fetchAttachment(att, params.apiKey);
      let storagePath: string | null = null;
      let status: "stored" | "too_large" | "failed" = fetched.status;
      let mime: string | null = null;
      let size: number | null = null;
      if (fetched.status === "stored") {
        storagePath = conversationMediaPath(params.workspaceId, params.conversationId, "in", fetched.mime);
        const { error } = await bucket(service).upload(storagePath, fetched.bytes, { contentType: fetched.mime, upsert: false });
        if (error) {
          console.error("[media] upload inbound", error.message);
          storagePath = null;
          status = "failed";
        } else {
          mime = fetched.mime;
          size = fetched.bytes.byteLength;
        }
      }
      const row = {
        workspace_id: params.workspaceId,
        conversation_id: params.conversationId,
        platform_message_id: params.platformMessageId,
        attachment_index: index,
        direction: "inbound" as const,
        kind: fetched.kind,
        storage_path: storagePath,
        mime_type: mime,
        file_name: att.filename ? safeFileName(att.filename) : null,
        size_bytes: size,
        status,
        fetch_attempts: params.retryAttempt ?? 1,
      };
      // En un reintento sin nombre de archivo se conserva el que ya estaba guardado.
      if (params.retryAttempt !== undefined && !att.filename) delete (row as Partial<typeof row>).file_name;
      const { error } = await service
        .from("message_media")
        .upsert(row, {
          onConflict: "conversation_id,platform_message_id,attachment_index",
          ignoreDuplicates: params.retryAttempt === undefined,
        });
      if (error) console.error("[media] message_media inbound", error.message);
    }),
  );
}

// ── Archivo que envía el asesor ────────────────────────────────────────────

export interface OutgoingMedia {
  /** Ruta del archivo en la carpeta del chat. */
  path: string;
  /** Enlace firmado para que Zernio y la plataforma lo descarguen. */
  url: string;
  kind: MessageMediaKind;
  mime: string;
  size: number;
  name: string;
}

/** Zernio y Meta descargan el archivo después de recibir el pedido: el enlace dura 24 horas. */
const SEND_URL_SECONDS = 24 * 60 * 60;

/**
 * Revisa el archivo que el navegador subió (o el de una respuesta guardada) y
 * lo deja listo para enviar por este chat. Nunca acepta rutas de otro chat ni
 * de otra empresa, y lee el tamaño y el tipo del archivo guardado.
 */
export async function prepareOutgoingMedia(
  userClient: Db,
  service: Db,
  params: {
    conversation: { id: string; workspace_id: string; platform: Database["public"]["Tables"]["conversations"]["Row"]["platform"] };
    path: unknown;
    name: unknown;
  },
): Promise<OutgoingMedia | { error: string }> {
  const { conversation } = params;
  const parsed = parseMediaPath(params.path);
  if (!parsed || parsed.workspaceId !== conversation.workspace_id) return { error: "El archivo no es válido." };

  let path: string;
  if (parsed.kind === "conv") {
    if (parsed.conversationId !== conversation.id || parsed.direction !== "out") return { error: "El archivo no es válido." };
    path = params.path as string;
  } else {
    // Archivo de una respuesta guardada: la RLS dice si la persona ve esa respuesta.
    const { data: reply } = await userClient
      .from("saved_replies")
      .select("id")
      .eq("attachment_url", params.path as string)
      .limit(1)
      .maybeSingle();
    if (!reply) return { error: "No se encontró el archivo de la respuesta guardada." };
    const source = await objectInfo(service, params.path as string);
    if (!source) return { error: "No se encontró el archivo de la respuesta guardada." };
    path = conversationMediaPath(conversation.workspace_id, conversation.id, "out", source.mime);
    if (!(await copyObject(service, params.path as string, path))) return { error: "No se pudo preparar el archivo." };
  }

  const info = await objectInfo(service, path);
  if (!info) return { error: "El archivo no terminó de subir. Inténtalo de nuevo." };
  const check = validateOutgoingAttachment(conversation.platform, info);
  if (!check.ok) return { error: check.error };
  if (check.compress) return { error: "La foto pesa demasiado para este canal." };

  const url = await signedUrl(service, path, SEND_URL_SECONDS);
  if (!url) return { error: "No se pudo preparar el archivo." };
  const name = safeFileName(typeof params.name === "string" ? params.name : null, `archivo.${extensionFor(info.mime)}`);
  return { path, url, kind: check.kind, mime: info.mime, size: info.size, name };
}
