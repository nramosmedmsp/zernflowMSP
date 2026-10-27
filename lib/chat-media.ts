// Archivos del chat (docs/PLAN-BANDEJA-CHAT.md, etapa C): reglas puras de
// tipos, tamaños por canal y rutas dentro del bucket privado "chat-media".
// Las rutas las arma y las valida el servidor: nunca se acepta una URL o una
// ruta del navegador sin revisarla con parseMediaPath.

import type { MessageMediaKind, Platform } from "@/lib/types/database";

export const CHAT_MEDIA_BUCKET = "chat-media";
/** Tope del bucket y de las copias de lo que llega (25 MB). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Los archivos de los chats se borran a los 2 meses (decisión del dueño). */
export const MEDIA_RETENTION_DAYS = 60;
/** Cuántos archivos se pueden adjuntar a la vez. */
export const MAX_ATTACHMENTS = 5;

const MB = 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FILE_RE = new RegExp(`^${UUID}\\.[a-z0-9]{1,5}$`);
const UUID_RE = new RegExp(`^${UUID}$`);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/webm": "webm",
};

/** Tipos que acepta el bucket (los mismos de la migración 00025). */
export const ALLOWED_MIMES: ReadonlySet<string> = new Set(Object.keys(EXT_BY_MIME));

/** "audio/ogg; codecs=opus" → "audio/ogg". */
export function baseMime(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

export function extensionFor(mime: string | null | undefined): string {
  return EXT_BY_MIME[baseMime(mime)] ?? "bin";
}

export function classifyMime(mime: string | null | undefined): MessageMediaKind {
  const m = baseMime(mime);
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "file";
}

/** Tipo que espera Zernio en attachmentType. */
export function zernioAttachmentType(kind: MessageMediaKind): "image" | "video" | "audio" | "file" {
  return kind === "sticker" ? "image" : kind;
}

/** Nombre de archivo seguro para mostrar y para la descarga. */
export function safeFileName(name: string | null | undefined, fallback = "archivo"): string {
  const clean = (name ?? "")
    .replace(/[\\/]/g, "-")
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "")
    .trim();
  const short = Array.from(clean).slice(0, 120).join("");
  return short || fallback;
}

// ── Reglas de envío por canal ───────────────────────────────────────────────

interface KindRule {
  mimes: readonly string[];
  maxBytes: number;
}

type SendRules = Partial<Record<"image" | "file" | "video", KindRule>>;

const JPEG_PNG = ["image/jpeg", "image/png"];

const SEND_RULES: Partial<Record<Platform, SendRules>> = {
  whatsapp: {
    image: { mimes: JPEG_PNG, maxBytes: 5 * MB },
    file: { mimes: ["application/pdf"], maxBytes: MAX_FILE_BYTES },
    video: { mimes: ["video/mp4", "video/3gpp"], maxBytes: 16 * MB },
  },
  // Instagram no acepta PDF por mensaje directo.
  instagram: {
    image: { mimes: JPEG_PNG, maxBytes: 8 * MB },
    video: { mimes: ["video/mp4", "video/quicktime"], maxBytes: MAX_FILE_BYTES },
  },
  facebook: {
    image: { mimes: [...JPEG_PNG, "image/gif"], maxBytes: MAX_FILE_BYTES },
    file: { mimes: ["application/pdf"], maxBytes: MAX_FILE_BYTES },
    video: { mimes: ["video/mp4"], maxBytes: MAX_FILE_BYTES },
  },
  telegram: {
    image: { mimes: [...JPEG_PNG, "image/gif"], maxBytes: 10 * MB },
    file: { mimes: ["application/pdf"], maxBytes: MAX_FILE_BYTES },
    video: { mimes: ["video/mp4"], maxBytes: MAX_FILE_BYTES },
  },
};

/** Fotos que el navegador puede convertir a JPEG más liviano antes de subir. */
const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export function canSendAttachments(platform: Platform): boolean {
  return !!SEND_RULES[platform];
}

/** Tipos para el selector de archivos del canal. */
export function acceptFor(platform: Platform): string {
  const rules = SEND_RULES[platform];
  if (!rules) return "";
  const mimes = new Set<string>();
  for (const rule of Object.values(rules)) rule?.mimes.forEach((m) => mimes.add(m));
  if (rules.image) mimes.add("image/webp");
  return [...mimes].join(",");
}

/** Peso máximo de una foto en este canal (para achicarla antes de subir). */
export function imageMaxBytes(platform: Platform): number {
  return SEND_RULES[platform]?.image?.maxBytes ?? 5 * MB;
}

/** Fotos de las respuestas guardadas: las de WhatsApp, el canal más estricto. */
export const REPLY_IMAGE_MAX_BYTES = 5 * MB;

/**
 * Archivo de una respuesta guardada: foto JPG o PNG de hasta 5 MB (el navegador
 * achica las más grandes) o PDF de hasta 25 MB. Así sirve en WhatsApp.
 */
export function validateReplyAttachment(file: { mime: string; size: number }): OutgoingCheck {
  const mime = baseMime(file.mime);
  const kind = classifyMime(mime);
  if (kind === "image") {
    if (JPEG_PNG.includes(mime) && file.size <= REPLY_IMAGE_MAX_BYTES) return { ok: true, kind, compress: false };
    if (COMPRESSIBLE.has(mime)) return { ok: true, kind, compress: true };
    return { ok: false, error: "Ese formato de foto no se puede usar. Usa JPG o PNG." };
  }
  if (mime !== "application/pdf") return { ok: false, error: "Solo se pueden adjuntar fotos y PDF." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: `El PDF pesa más de ${sizeText(MAX_FILE_BYTES)}.` };
  return { ok: true, kind: "file", compress: false };
}

function sizeText(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

export type OutgoingCheck =
  | { ok: true; kind: MessageMediaKind; compress: boolean }
  | { ok: false; error: string };

/**
 * ¿Se puede enviar este archivo por este canal? `compress` dice si hay que
 * convertir la foto a JPEG más liviana antes (WhatsApp no acepta webp y limita
 * las fotos a 5 MB).
 */
export function validateOutgoingAttachment(
  platform: Platform,
  file: { mime: string; size: number },
): OutgoingCheck {
  const rules = SEND_RULES[platform];
  if (!rules) return { ok: false, error: "Este canal no permite enviar archivos." };
  const mime = baseMime(file.mime);
  const kind = classifyMime(mime);

  if (kind === "image") {
    const rule = rules.image;
    if (!rule) return { ok: false, error: "Este canal no permite enviar fotos." };
    const fits = rule.mimes.includes(mime) && file.size <= rule.maxBytes;
    if (fits) return { ok: true, kind, compress: false };
    if (COMPRESSIBLE.has(mime)) return { ok: true, kind, compress: true };
    return { ok: false, error: "Ese formato de foto no se puede enviar. Usa JPG o PNG." };
  }

  const rule = kind === "video" ? rules.video : kind === "file" ? rules.file : undefined;
  if (!rule || !rule.mimes.includes(mime)) {
    if (mime === "application/pdf" && platform === "instagram") {
      return { ok: false, error: "Instagram no permite enviar PDF. Manda una foto o un enlace." };
    }
    return { ok: false, error: kind === "video" ? "Ese video no se puede enviar por este canal. Usa MP4." : "Solo se pueden enviar fotos y PDF." };
  }
  if (file.size > rule.maxBytes) {
    return { ok: false, error: `El archivo pesa más de ${sizeText(rule.maxBytes)}, el máximo de este canal.` };
  }
  return { ok: true, kind, compress: false };
}

// ── Rutas en el bucket ──────────────────────────────────────────────────────

export type MediaPath =
  | { kind: "conv"; workspaceId: string; conversationId: string; direction: "in" | "out"; file: string }
  | { kind: "replies"; workspaceId: string; file: string };

/** Archivo de un chat: {empresa}/conv/{chat}/{in|out}/{uuid}.{ext}. */
export function conversationMediaPath(
  workspaceId: string,
  conversationId: string,
  direction: "in" | "out",
  mime: string | null | undefined,
  id: string = crypto.randomUUID(),
): string {
  return `${workspaceId}/conv/${conversationId}/${direction}/${id}.${extensionFor(mime)}`;
}

/** Archivo de una respuesta guardada: {empresa}/replies/{uuid}.{ext}. */
export function replyMediaPath(workspaceId: string, mime: string | null | undefined, id: string = crypto.randomUUID()): string {
  return `${workspaceId}/replies/${id}.${extensionFor(mime)}`;
}

/** Valida y separa una ruta del bucket; null si no tiene la forma esperada. */
export function parseMediaPath(path: unknown): MediaPath | null {
  if (typeof path !== "string" || path.length > 200) return null;
  const parts = path.split("/");
  if (parts.length === 5 && parts[1] === "conv") {
    const [workspaceId, , conversationId, direction, file] = parts;
    if (!UUID_RE.test(workspaceId) || !UUID_RE.test(conversationId) || !FILE_RE.test(file)) return null;
    if (direction !== "in" && direction !== "out") return null;
    return { kind: "conv", workspaceId, conversationId, direction, file };
  }
  if (parts.length === 3 && parts[1] === "replies") {
    const [workspaceId, , file] = parts;
    if (!UUID_RE.test(workspaceId) || !FILE_RE.test(file)) return null;
    return { kind: "replies", workspaceId, file };
  }
  return null;
}

// ── Lo que llega ───────────────────────────────────────────────────────────

export interface InboundAttachment {
  type?: string | null;
  url?: string | null;
}

/** Hosts a los que se puede pedir un archivo entrante. La clave de Zernio solo va a zernio.com. */
export function inboundFetchPlan(url: string): { ok: true; withApiKey: boolean } | { ok: false } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false };
  }
  if (u.protocol !== "https:") return { ok: false };
  const host = u.hostname.toLowerCase();
  if (host === "zernio.com" || host.endsWith(".zernio.com")) return { ok: true, withApiKey: true };
  const allowed = [
    "fbcdn.net",
    "cdninstagram.com",
    "fbsbx.com",
    "facebook.com",
    "instagram.com",
    "telegram.org",
    "whatsapp.net",
  ];
  if (allowed.some((h) => host === h || host.endsWith(`.${h}`))) return { ok: true, withApiKey: false };
  return { ok: false };
}

/**
 * ¿El enlace tiene que pasar por nuestro servidor? Los de Zernio piden la
 * clave (WhatsApp) y los de Telegram llevan el token del bot. Los demás
 * (CDN de Meta, archivos de los flujos) se muestran directo.
 */
export function needsProxy(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  return host === "zernio.com" || host.endsWith(".zernio.com") || host === "api.telegram.org";
}

/** Tipo de archivo según lo que diga la plataforma (si no hay MIME). */
export function kindFromAttachmentType(type: string | null | undefined, mime?: string | null): MessageMediaKind {
  const t = (type ?? "").toLowerCase();
  if (t === "sticker") return "sticker";
  if (t === "image" || t === "video" || t === "audio") return t;
  if (mime) return classifyMime(mime);
  return "file";
}

/** "220 KB", "1.2 MB" (en Perú el decimal va con punto). */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toLocaleString("es-PE", { maximumFractionDigits: 1 })} MB`;
}

/** Enlace para descargar con su nombre: solo nuestras rutas lo saben hacer. */
export function downloadHref(url: string): string {
  if (!url.startsWith("/api/v1/media/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

/** Fecha desde la que los archivos de los chats ya vencieron (ISO). */
export function retentionCutoff(now: Date, days = MEDIA_RETENTION_DAYS): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
