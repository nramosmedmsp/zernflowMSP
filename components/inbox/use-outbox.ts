"use client";

// Envíos de la bandeja (lib/inbox-outbox.ts). El estado vive en la vista de la
// bandeja: si el asesor cambia de chat mientras un mensaje sale y el envío
// falla, el aviso dice a quién era y el mensaje sigue en su chat con Reintentar.

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import type { InboxMessage, MessagesPage } from "@/lib/inbox-messages";
import {
  classifySendFailure,
  failedConversationIds,
  findLikelyDelivered,
  outboxReducer,
  settledIds,
  type OutboxItem,
} from "@/lib/inbox-outbox";

interface SendTarget {
  id: string;
  contactName: string | null;
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
    async (item: OutboxItem) => {
      let status: number | null = null;
      try {
        const res = await fetch("/api/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: item.conversationId, text: item.text, clientMessageId: item.clientId }),
        });
        status = res.status;
        const json = (await res.json().catch(() => ({}))) as Partial<InboxMessage> & { error?: string };
        if (!res.ok) throw new Error(json.error || `No se pudo enviar (${res.status})`);
        dispatch({ type: "sent", clientId: item.clientId, confirmedId: json.id ?? null });
        delivered.current?.(item.conversationId);
      } catch (err) {
        const { ambiguous } = classifySendFailure(status);
        const reason =
          status === null ? "Sin conexión. Revisa tu internet." : err instanceof Error ? err.message : "No se pudo enviar el mensaje";
        dispatch({ type: "failed", clientId: item.clientId, error: reason, ambiguous });
        toast.error(item.contactName ? `No se envió tu mensaje a ${item.contactName}. ${reason}` : `No se envió tu mensaje. ${reason}`);
      }
    },
    [toast],
  );

  const send = useCallback(
    (target: SendTarget, text: string) => {
      const item: OutboxItem = {
        clientId: crypto.randomUUID(),
        conversationId: target.id,
        contactName: target.contactName,
        text,
        createdAt: new Date().toISOString(),
        status: "sending",
        error: null,
        ambiguous: false,
        confirmedId: null,
      };
      dispatch({ type: "queued", item });
      void deliver(item);
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
    if (ids.length > 0) dispatch({ type: "settled", clientIds: ids });
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
