"use client";

// Chats y gestiones de la bandeja con realtime (conversations y cases). La RLS
// decide qué filas llegan, también por realtime.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { groupCasesByContact, type InboxCase, type InboxConversation } from "./inbox-model";
import {
  CASES_REFRESH_INTERVAL_MS,
  CASES_REFRESH_MIN_GAP_MS,
  dropHiddenConversations,
  lostContactIds,
  replaceActiveCases,
} from "./inbox-refresh";

const MAX_ACTIVE_CASES = 1000;

function isActive(c: InboxCase): boolean {
  return c.status === "open" || c.status === "scheduled";
}

function mergeConversations(prev: InboxConversation[], incoming: InboxConversation[]): InboxConversation[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((c) => [c.id, c]));
  for (const c of incoming) byId.set(c.id, { ...byId.get(c.id), ...c });
  return [...byId.values()];
}

export function useInboxData({
  workspaceId,
  initialConversations,
  initialCases,
}: {
  workspaceId: string;
  initialConversations: InboxConversation[];
  initialCases: InboxCase[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [cases, setCases] = useState(initialCases);
  const requestedContacts = useRef(new Set<string>());

  // Al refrescar la página (p. ej. después de sincronizar) llegan datos nuevos.
  useEffect(() => {
    setConversations(initialConversations);
    requestedContacts.current = new Set(initialConversations.map((c) => c.contact_id));
  }, [initialConversations]);
  useEffect(() => {
    setCases(initialCases);
  }, [initialCases]);

  /** Trae los chats del contacto si todavía no están (RLS). Devuelve los del contacto. */
  const ensureContactConversations = useCallback(
    async (contactId: string, force = false): Promise<InboxConversation[]> => {
      if (!force && requestedContacts.current.has(contactId)) return [];
      requestedContacts.current.add(contactId);
      const { data } = await createClient()
        .from("conversations")
        .select("*, contacts(*)")
        .eq("workspace_id", workspaceId)
        .eq("contact_id", contactId);
      const list = (data ?? []) as InboxConversation[];
      setConversations((prev) => mergeConversations(prev, list));
      return list;
    },
    [workspaceId],
  );

  /** Vuelve a leer las gestiones activas de un contacto (tras una acción o un cambio). */
  const refreshContactCases = useCallback(async (contactId: string) => {
    const { data } = await createClient()
      .from("cases")
      .select("*")
      .eq("contact_id", contactId)
      .in("status", ["open", "scheduled"]);
    setCases((prev) => [...prev.filter((c) => c.contact_id !== contactId), ...((data ?? []) as InboxCase[])]);
  }, []);

  // M-19: la gestión que se reasignó a otro asesor deja de llegarle a este por
  // Realtime (la RLS ya no se la muestra). Se vuelven a pedir las activas al
  // volver a la pestaña, cada 60 s y a pedido, y se quita lo que ya no se ve.
  const casesRef = useRef(cases);
  useEffect(() => {
    casesRef.current = cases;
  }, [cases]);
  const lastRefresh = useRef(0);
  const refreshActiveCases = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (!force && now - lastRefresh.current < CASES_REFRESH_MIN_GAP_MS) return;
      lastRefresh.current = now;
      const supabase = createClient();
      const { data, error } = await supabase
        .from("cases")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("status", ["open", "scheduled"])
        .order("waiting_since", { ascending: true, nullsFirst: false })
        .limit(MAX_ACTIVE_CASES);
      if (error || !data) return;
      const fresh = replaceActiveCases(data as InboxCase[]);
      const lost = lostContactIds(casesRef.current, fresh);
      setCases(fresh);
      if (lost.length === 0) return;
      const { data: visible, error: visibleError } = await supabase
        .from("conversations")
        .select("id")
        .eq("workspace_id", workspaceId)
        .in("contact_id", lost);
      if (visibleError || !visible) return;
      const visibleIds = new Set(visible.map((c) => c.id as string));
      setConversations((prev) => dropHiddenConversations(prev, lost, visibleIds));
    },
    [workspaceId],
  );

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshActiveCases();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = setInterval(onVisible, CASES_REFRESH_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(timer);
    };
  }, [refreshActiveCases]);

  const markConversationRead = useCallback((conversationId: string) => {
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c)));
  }, []);

  // Realtime de conversaciones (nuevas y actualizadas).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`inbox-conversations-${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${workspaceId}` },
        async (payload) => {
          if (payload.eventType === "UPDATE") {
            const updated = payload.new as InboxConversation;
            setConversations((prev) =>
              prev.some((c) => c.id === updated.id)
                ? prev.map((c) => (c.id === updated.id ? { ...c, ...updated, contacts: c.contacts } : c))
                : prev,
            );
          } else if (payload.eventType === "INSERT") {
            const inserted = payload.new as InboxConversation;
            const { data } = await supabase
              .from("conversations")
              .select("*, contacts(*)")
              .eq("id", inserted.id)
              .maybeSingle();
            if (data) setConversations((prev) => mergeConversations(prev, [data as InboxConversation]));
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string };
            if (old.id) setConversations((prev) => prev.filter((c) => c.id !== old.id));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  // Realtime de gestiones: altas, cambios de etapa o responsable, cierres.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`inbox-cases-${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cases", filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string };
            if (old.id) setCases((prev) => prev.filter((c) => c.id !== old.id));
            return;
          }
          const row = payload.new as InboxCase;
          setCases((prev) => {
            const rest = prev.filter((c) => c.id !== row.id);
            return isActive(row) ? [...rest, row] : rest;
          });
          if (isActive(row)) void ensureContactConversations(row.contact_id);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, ensureContactConversations]);

  const casesByContact = useMemo(() => groupCasesByContact(cases), [cases]);

  return {
    conversations,
    cases,
    casesByContact,
    ensureContactConversations,
    refreshContactCases,
    refreshActiveCases,
    markConversationRead,
  };
}
