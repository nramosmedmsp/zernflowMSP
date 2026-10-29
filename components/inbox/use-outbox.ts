"use client";

// Envíos de la bandeja (lib/inbox-outbox.ts). El estado vive en la vista de la
// bandeja: si el asesor cambia de chat mientras un mensaje sale y el envío
// falla, el aviso dice a quién era y el mensaje sigue en su chat con Reintentar.

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media";
import type { InboxMessage, MessagesPage } from "@/lib/inbox-messages";
import type { Platform } from "@/lib/types/database";
import {
  classifySendFailure,
  failedConversationIds,
  findLikelyDelivered,
  outboxReducer,
  settledIds,
  splitOutgoing,
  type OutboxAttachment,
  type OutboxItem,
} from "@/lib/inbox-outbox";

interface SendTarget {
  id: string;
  contactName: string | null;
  platform: Platform;
}

/** La subida falló: el mensaje no salió (se puede reintentar sin riesgo). */
class UploadError extends Error {}

/**
 * Sube el archivo directo al bucket con un enlace firmado (Vercel corta los
 * pedidos de más de ~4,5 MB). Devuelve la ruta que luego revisa el servidor.
 */
async function uploadAttachment(conversationId: string, attachment: OutboxAttachment): Promise<string> {
  if (attachment.path) return attachment.path;
  if (!attachment.file) throw new UploadError("El archivo ya no está disponible. Vuelve a adjuntarlo.");
  let res: Response;
  try {
    res = await fetch("/api/v1/media/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, mime: attachment.mime, size: attachment.size }),
    });
  } catch {
    throw new UploadError("Sin conexión. Revisa tu internet.");
  }
  const json = (await res.json().catch(() => ({}))) as { path?: string; token?: string; error?: string };
  if (!res.ok || !json.path || !json.token) throw new UploadError(json.error || "No se pudo subir el archivo.");
  const { error } = await createClient()
    .storage.from(CHAT_MEDIA_BUCKET)
    .uploadToSignedUrl(json.path, json.token, attachment.file, { contentType: attachment.mime });
  if (error) throw new UploadError("No se pudo subir el archivo. Inténtalo de nuevo.");
  return json.path;
}

function revokePreview(item: OutboxItem) {
  const url = item.attachment?.localUrl;
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function useOutbox({ onDelivered }: { onDelivered?: (conversationId: string) => void } = {}) {
  const [items, dispatch] = useReducer(outboxReducer, []);
  const toast = useToast();
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const delivered = useRef(onDelivered);
  useEffect(() => {
    delivered.current = onDelivered;
  }, [onDelivered]);

  const deliver = useCallback(
    async (item: OutboxItem): Promise<boolean> => {
      let status: number | null = null;
      try {
        let attachment: { path: string; name: string } | undefined;
        if (item.attachment) {
          try {
            const path = await uploadAttachment(item.conversationId, item.attachment);
            if (!item.attachment.path) dispatch({ type: "uploaded", clientId: item.clientId, path });
            attachment = { path, name: item.attachment.name };
          } catch (err) {
            // Nada salió: se puede reintentar sin revisar el chat.
            status = 400;
            throw err;
          }
        }
        const res = await fetch("/api/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: item.conversationId, text: item.text, clientMessageId: item.clientId, attachment }),
        });
        status = res.status;
        const json = (await res.json().catch(() => ({}))) as Partial<InboxMessage> & { error?: string };
        if (!res.ok) throw new Error(json.error || `No se pudo enviar (${res.status})`);
        dispatch({ type: "sent", clientId: item.clientId, confirmedId: json.id ?? null });
        delivered.current?.(item.conversationId);
        return true;
      } catch (err) {
        const { ambiguous } = classifySendFailure(status);
        const reason =
          status === null ? "Sin conexión. Revisa tu internet." : err instanceof Error ? err.message : "No se pudo enviar el mensaje";
        dispatch({ type: "failed", clientId: item.clientId, error: reason, ambiguous });
        toast.error(item.contactName ? `No se envió tu mensaje a ${item.contactName}. ${reason}` : `No se envió tu mensaje. ${reason}`);
        return false;
      }
    },
    [toast],
  );

  /**
   * Envía el texto y los archivos: un mensaje por archivo, uno detrás de otro
   * para que lleguen en orden (lib/inbox-outbox.ts, splitOutgoing).
   */
  const send = useCallback(
    (target: SendTarget, text: string, attachments: OutboxAttachment[] = []) => {
      const at = Date.now();
      const items: OutboxItem[] = splitOutgoing(target.platform, text, attachments).map((part, i) => ({
        clientId: crypto.randomUUID(),
        conversationId: target.id,
        contactName: target.contactName,
        text: part.text,
        // Un milisegundo de diferencia mantiene el orden en el chat.
        createdAt: new Date(at + i).toISOString(),
        status: "sending",
        error: null,
        ambiguous: false,
        confirmedId: null,
        attachment: part.file,
      }));
      for (const item of items) dispatch({ type: "queued", item });
      void (async () => {
        for (const [i, item] of items.entries()) {
          if (await deliver(item)) continue;
          // Si una parte falla, las siguientes no salen (llegarían antes que ella):
          // quedan para reintentar en orden.
          for (const rest of items.slice(i + 1)) {
            dispatch({
              type: "failed",
              clientId: rest.clientId,
              error: "No se envió porque falló el mensaje anterior. Reintenta en orden.",
              ambiguous: false,
            });
          }
          break;
        }
      })();
    },
    [deliver],
  );

  /**
   * Reintenta con la misma clave. Si la falla fue dudosa, primero revisa si el
   * mensaje ya está en el chat para no mandarlo dos veces.
   */
  const retry = useCallback(
    async (clientId: string) => {
      const item = itemsRef.current.find((i) => i.clientId === clientId);
      if (!item || item.status !== "failed") return;
      dispatch({ type: "retrying", clientId });
      if (item.ambiguous) {
        try {
          const res = await fetch(`/api/v1/messages?conversationId=${encodeURIComponent(item.conversationId)}&limit=30`);
          if (res.ok) {
            const page = (await res.json()) as MessagesPage;
            const found = findLikelyDelivered(item, page.messages);
            if (found) {
              dispatch({ type: "sent", clientId, confirmedId: found.id });
              return;
            }
          }
        } catch {
          // Sin respuesta: se intenta el envío de todos modos (misma clave).
        }
      }
      await deliver(item);
    },
    [deliver],
  );

  /** El chat cargó sus mensajes: quita los envíos que ya aparecen ahí. */
  const settle = useCallback((conversationId: string, serverMessages: InboxMessage[]) => {
    const ids = settledIds(itemsRef.current, conversationId, serverMessages);
    if (ids.length === 0) return;
    for (const item of itemsRef.current) if (ids.includes(item.clientId)) revokePreview(item);
    dispatch({ type: "settled", clientIds: ids });
  }, []);

  // Avisa antes de cerrar la pestaña si un mensaje todavía está saliendo.
  const sending = items.some((i) => i.status === "sending");
  useEffect(() => {
    if (!sending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [sending]);

  const failedIds = useMemo(() => failedConversationIds(items), [items]);

  return { items, send, retry, settle, failedIds };
}
