const PREVIEW_LENGTH = 100;

/**
 * Truncates a message for `conversations.last_message_preview`.
 *
 * Slices by code point, never by UTF-16 code unit: a plain `slice` cuts an
 * emoji's surrogate pair in half whenever one straddles the limit, and
 * PostgREST rejects the resulting lone surrogate with `PGRST102 Empty or
 * invalid json`, which silently dropped whole conversations during inbox
 * backfill.
 */
export function messagePreview(text: string | null | undefined): string {
  return Array.from(text ?? "").slice(0, PREVIEW_LENGTH).join("");
}

interface PreviewAttachment {
  type?: string | null;
  payload?: unknown;
}

function attachmentLabel(att: PreviewAttachment): string {
  const payload = (att.payload && typeof att.payload === "object" ? att.payload : {}) as Record<string, unknown>;
  switch ((att.type ?? "").toLowerCase()) {
    case "image":
      return "📷 Foto";
    case "video":
      return "🎥 Video";
    case "audio":
      return payload.voice === true || payload.isVoice === true ? "🎤 Nota de voz" : "🎵 Audio";
    case "file":
    case "document":
      return "📄 Documento";
    case "sticker":
      return "Sticker";
    case "location":
      return "📍 Ubicación";
    default:
      return "📎 Archivo";
  }
}

/**
 * Vista previa de un mensaje entrante para la lista: el texto, o una etiqueta
 * cuando trae foto, audio, documento o es una respuesta a una historia
 * ("📷 Foto · ¿es original?"). Nunca queda vacía.
 */
export function inboundPreview(message: {
  text?: string | null;
  attachments?: PreviewAttachment[] | null;
  storyReply?: unknown;
  isStoryMention?: boolean | null;
}): string {
  const text = (message.text ?? "").trim();
  let label = "";
  if (message.isStoryMention) label = "Te mencionó en su historia";
  else if (message.storyReply) label = "↩️ Respondió a tu historia";
  else if (message.attachments && message.attachments.length > 0) label = attachmentLabel(message.attachments[0]);
  if (!label) return messagePreview(text || "Mensaje sin texto");
  return messagePreview(text ? `${label} · ${text}` : label);
}
