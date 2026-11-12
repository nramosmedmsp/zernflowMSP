"use client";

// Chats y gestiones de la bandeja con realtime (conversations y cases). La RLS
// decide qué filas llegan, también por realtime.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { groupCasesByContact, type ContactRow, type InboxCase, type InboxConversation } from "./inbox-model";
import {
  CASES_REFRESH_INTERVAL_MS,
  CASES_REFRESH_MIN_GAP_MS,
  dropHiddenConversations,
  lostContactIds,
  replaceActiveCases,
} from "./inbox-refresh";
import { uniqueChannelName } from "@/lib/realtime-channel";
import {
  FETCH_IN_CHUNK,
  INBOX_PAGE_SIZE,
  MAX_INCREMENTAL_FETCH,
  applyCaseDiff,
  chunkList,
  diffActiveCases,
  loadActiveCases,
  loadActiveStamps,
  oldestMessageAt,
} from "./inbox-paging";

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
  initialCasesTruncated = false,
  recentPage = { hasMore: false, cursor: null },
  viewing = false,
}: {
  workspaceId: string;
  initialConversations: InboxConversation[];
  initialCases: InboxCase[];
  /** Hay más gestiones activas que el tope de lectura: los contadores pueden quedar cortos. */
  initialCasesTruncated?: boolean;
  /** Primera página de chats recientes: si hay más y desde dónde seguir ("Cargar más"). */
  recentPage?: { hasMore: boolean; cursor: string | null };
  /** "Ver como": Realtime llega con permisos del Dueño, así que solo dispara relecturas (con la identidad vista). */
  viewing?: boolean;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [cases, setCases] = useState(initialCases);
  const [casesTruncated, setCasesTruncated] = useState(initialCasesTruncated);
  // "Cargar más": solo el estado de esta pantalla; un router.refresh() no lo reinicia.
  const [hasMore, setHasMore] = useState(recentPage.hasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const cursorRef = useRef<string | null>(recentPage.cursor);
  const conversationsRef = useRef(conversations);
  const requestedContacts = useRef(new Set<string>());

  // Al refrescar la página (p. ej. después de sincronizar) llegan datos nuevos.
  // Se FUSIONA con lo que ya hay: un chat abierto desde una notificación o desde
  // Contactos (que no está entre los recientes) no debe desaparecer al volver a
  // la pestaña y refrescar la página (R2-B8).
  useEffect(() => {
    setConversations((prev) => {
      const incomingIds = new Set(initialConversations.map((c) => c.id));
      return [...initialConversations, ...prev.filter((c) => !incomingIds.has(c.id))];
    });
    for (const c of initialConversations) requestedContacts.current.add(c.contact_id);
  }, [initialConversations]);
  useEffect(() => {
    setCases(initialCases);
    setCasesTruncated(initialCasesTruncated);
  }, [initialCases, initialCasesTruncated]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  /** Agrega chats traídos aparte (por ejemplo, los que encontró la búsqueda del servidor). */
  const addConversations = useCallback((list: InboxConversation[]) => {
    setConversations((prev) => mergeConversations(prev, list));
  }, []);

  /** Siguiente página de chats, de más reciente a más antiguo (para "Todos / Todo"). */
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const supabase = createClient();
      let query = supabase
        .from("conversations")
        .select("*, contacts(*)")
        .eq("workspace_id", workspaceId)
        .not("last_message_at", "is", null)
        .order("last_message_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(INBOX_PAGE_SIZE);
      // lte (no lt): los chats con la misma hora del borde no se saltan; los repetidos se descartan abajo.
      if (cursorRef.current) query = query.lte("last_message_at", cursorRef.current);
      const { data, error } = await query;
      if (error) throw error;
      let page = (data ?? []) as InboxConversation[];
      const known = new Set(conversationsRef.current.map((c) => c.id));
      let fresh = page.filter((c) => !known.has(c.id));
      let more = page.length >= INBOX_PAGE_SIZE && fresh.length > 0;
      if (!more) {
        // Se acabaron los que tienen mensajes: faltan, a lo más, los chats todavía sin mensajes.
        const nulls = await supabase
          .from("conversations")
          .select("*, contacts(*)")
          .eq("workspace_id", workspaceId)
          .is("last_message_at", null)
          .limit(INBOX_PAGE_SIZE);
        if (nulls.error) throw nulls.error;
        const extra = ((nulls.data ?? []) as InboxConversation[]).filter((c) => !known.has(c.id));
        page = [...page, ...extra];
        fresh = [...fresh, ...extra];
      }
      cursorRef.current = oldestMessageAt(page) ?? cursorRef.current;
      setConversations((prev) => mergeConversations(prev, fresh));
      for (const c of fresh) requestedContacts.current.add(c.contact_id);
      setHasMore(more);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, workspaceId]);

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

  /** Cambia en la lista los datos del contacto (p. ej. su tipo) sin esperar a recargar la página. */
  const patchContact = useCallback((contactId: string, patch: Partial<ContactRow>) => {
    setConversations((prev) =>
      prev.map((c) => (c.contact_id === contactId && c.contacts ? { ...c, contacts: { ...c.contacts, ...patch } } : c)),
    );
  }, []);

  /** Vuelve a leer el contacto (tipo y confirmación pueden cambiar por una regla o por otra persona). */
  const refreshContact = useCallback(
    async (contactId: string) => {
      const { data } = await createClient().from("contacts").select("*").eq("id", contactId).maybeSingle();
      if (data) patchContact(contactId, data);
    },
    [patchContact],
  );

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
      // Solo id y fecha de cambio de todas las activas; completas, únicamente las nuevas o modificadas.
      const remote = await loadActiveStamps(supabase, workspaceId);
      if (!remote) return;
      setCasesTruncated(remote.truncated);
      const { removedIds, fetchIds } = diffActiveCases(casesRef.current, remote.stamps);
      let apply: (prev: InboxCase[]) => InboxCase[];
      if (fetchIds.length > MAX_INCREMENTAL_FETCH) {
        try {
          const all = await loadActiveCases(supabase, workspaceId);
          setCasesTruncated(all.truncated);
          apply = () => replaceActiveCases(all.cases);
        } catch {
          return;
        }
      } else {
        const fetched: InboxCase[] = [];
        for (const ids of chunkList(fetchIds, FETCH_IN_CHUNK)) {
          const { data, error } = await supabase.from("cases").select("*").in("id", ids);
          if (error || !data) return;
          fetched.push(...(data as InboxCase[]));
        }
        apply = (prev) => applyCaseDiff(prev, removedIds, fetched);
      }
      const lost = lostContactIds(casesRef.current, apply(casesRef.current));
      setCases(apply);
      if (lost.length === 0) return;
      const { data: visible, error: visibleError } = await supabase
        .from("conversations")
        .select("id")
        .eq("workspace_id", workspaceId)
        .in("contact_id", lost.slice(0, 500));
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
    // En vista el evento no se aplica tal cual: se vuelve a leer la fila (RLS de la persona vista).
    const rereadConversation = async (id: string | undefined) => {
      if (!id) return;
      const { data } = await supabase.from("conversations").select("*, contacts(*)").eq("id", id).maybeSingle();
      if (data) setConversations((prev) => mergeConversations(prev, [data as InboxConversation]));
    };
    const channel = supabase
      .channel(uniqueChannelName(`inbox-conversations-${workspaceId}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${workspaceId}` },
        async (payload) => {
          if (viewing) {
            if (payload.eventType === "DELETE") void refreshActiveCases(true);
            else await rereadConversation((payload.new as { id?: string }).id);
            return;
          }
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
  }, [workspaceId, viewing, refreshActiveCases]);

  // Realtime de gestiones: altas, cambios de etapa o responsable, cierres.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(uniqueChannelName(`inbox-cases-${workspaceId}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cases", filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          if (viewing) {
            void refreshActiveCases(true);
            return;
          }
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
  }, [workspaceId, ensureContactConversations, viewing, refreshActiveCases]);

  const casesByContact = useMemo(() => groupCasesByContact(cases), [cases]);

  return {
    conversations,
    cases,
    casesByContact,
    ensureContactConversations,
    refreshContactCases,
    refreshActiveCases,
    casesTruncated,
    hasMore,
    loadingMore,
    moreError,
    loadMore,
    addConversations,
    markConversationRead,
    patchContact,
    refreshContact,
  };
}
