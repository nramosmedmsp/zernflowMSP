"use client";

// Mensajes de un chat (GET /api/v1/messages). Un hook por chat abierto: la
// vista lo monta de nuevo al cambiar de conversación (key), y además cada
// pedido lleva un número para descartar respuestas viejas. Así nunca se
// mezclan los mensajes de dos clientes.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { applyStatusUpdate, mergeMessages, type InboxMessage, type MessagesPage } from "@/lib/inbox-messages";
import type { MessageStatus } from "@/lib/types/database";
import { useReconnect } from "./use-reconnect";

export type ThreadStatus = "loading" | "ready" | "error";

/** Tras enviar, se revisan los ticks cada 20 s durante 3 minutos (por si no llega el aviso en vivo). */
const TICKS_POLL_MS = 20_000;
const TICKS_WINDOW_MS = 3 * 60_000;

function awaitingTicks(messages: InboxMessage[], now: number): boolean {
  return messages.some(
    (m) =>
      m.direction === "outbound" &&
      (m.status === "sent" || m.status === "delivered") &&
      now - (new Date(m.created_at).getTime() || 0) < TICKS_WINDOW_MS,
  );
}

async function fetchPage(conversationId: string, signal: AbortSignal, cursor?: string): Promise<MessagesPage> {
  const qs = new URLSearchParams({ conversationId });
  if (cursor) qs.set("cursor", cursor);
  const res = await fetch(`/api/v1/messages?${qs}`, { signal });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json as { error?: string } | null)?.error || "No se pudieron cargar los mensajes");
  return json as MessagesPage;
}

export function useThreadMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [status, setStatus] = useState<ThreadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Número del último pedido de la página reciente: una respuesta de un pedido
  // anterior (o de otro chat) se descarta.
  const seq = useRef(0);
  const latest = useRef<InboxMessage[]>([]);
  useEffect(() => {
    latest.current = messages;
  }, [messages]);
  const controller = useRef<AbortController | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    if (!conversationId) return;
    const mine = ++seq.current;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      const page = await fetchPage(conversationId, ctrl.signal);
      if (mine !== seq.current) return;
      setMessages((prev) => mergeMessages(prev, page.messages));
      // La primera carga define desde dónde se piden los anteriores.
      if (!loaded.current) setOlderCursor(page.hasMore ? page.olderCursor : null);
      loaded.current = true;
      setError(null);
      setStatus("ready");
    } catch (err) {
      if (ctrl.signal.aborted || mine !== seq.current) return;
      const message = err instanceof Error ? err.message : "No se pudieron cargar los mensajes";
      console.error("Failed to load messages:", err);
      setError(message);
      // Si ya había mensajes se conservan; solo la primera carga queda en error.
      if (!loaded.current) setStatus("error");
    }
  }, [conversationId]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchPage(conversationId, new AbortController().signal, olderCursor);
      setMessages((prev) => mergeMessages(prev, page.messages));
      setOlderCursor(page.hasMore ? page.olderCursor : null);
    } catch (err) {
      console.error("Failed to load older messages:", err);
      setError(err instanceof Error ? err.message : "No se pudieron cargar los mensajes anteriores");
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, olderCursor, loadingOlder]);

  // Primera carga.
  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [refresh]);

  // Mensaje nuevo: la conversación cambia su last_message_at. Otros cambios
  // (no leídos, bot en pausa) no vuelven a pedir los mensajes.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refresh(), 400);
  }, [refresh]);

  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();
    let lastMessageAt: string | null | undefined;
    let subscribedBefore = false;
    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
        (payload) => {
          const next = (payload.new as { last_message_at?: string | null }).last_message_at ?? null;
          if (next === lastMessageAt) return;
          lastMessageAt = next;
          scheduleRefresh();
        },
      )
      // Entregado / leído / no entregado en vivo (webhook → messages).
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as { platform_message_id?: string | null; status?: MessageStatus; error_text?: string | null };
          if (!row.status) return;
          setMessages((prev) =>
            applyStatusUpdate(prev, { platform_message_id: row.platform_message_id ?? null, status: row.status!, error_text: row.error_text }),
          );
        },
      )
      .subscribe((state) => {
        if (state !== "SUBSCRIBED") return;
        // Al volver a conectarse pudo perderse un mensaje.
        if (subscribedBefore) scheduleRefresh();
        subscribedBefore = true;
      });
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [conversationId, scheduleRefresh]);

  useReconnect(scheduleRefresh);

  // Respaldo de los ticks: justo después de enviar, si el aviso en vivo no
  // llega, se vuelve a pedir la lista de vez en cuando (solo con la pestaña visible).
  const waiting = awaitingTicks(messages, Date.now());
  useEffect(() => {
    if (!conversationId || !waiting) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!awaitingTicks(latest.current, Date.now())) return;
      void refresh();
    }, TICKS_POLL_MS);
    return () => clearInterval(timer);
  }, [conversationId, waiting, refresh]);

  return {
    messages,
    status,
    error,
    hasOlder: !!olderCursor,
    loadingOlder,
    loadOlder,
    refresh,
  };
}
