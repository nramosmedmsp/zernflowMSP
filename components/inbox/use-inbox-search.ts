"use client";

// Búsqueda de la Bandeja hecha en el servidor sobre TODOS los chats que la
// persona puede ver (search_inbox, 00045): sin tildes ni ñ, con teléfonos escritos
// de cualquier forma y también por el texto del último mensaje. Mientras llega la
// respuesta, la lista sigue filtrando lo ya cargado (instantáneo).

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InboxConversation } from "./inbox-model";
import { SEARCH_RESULT_LIMIT, shouldSearchServer } from "./inbox-paging";

const DEBOUNCE_MS = 300;

export interface InboxSearchState {
  /** Ids de chats que el servidor encontró para el texto actual (vacío si no se buscó). */
  hitIds: ReadonlySet<string> | null;
  searching: boolean;
  /** No se pudo preguntar al servidor: solo se filtró lo cargado. */
  failed: boolean;
  /** Había más resultados que el máximo mostrado. */
  limited: boolean;
}

const IDLE: InboxSearchState = { hitIds: null, searching: false, failed: false, limited: false };

export function useInboxSearch({
  workspaceId,
  text,
  onResults,
}: {
  workspaceId: string;
  text: string;
  onResults: (list: InboxConversation[]) => void;
}): InboxSearchState {
  const [state, setState] = useState<{ forText: string; value: InboxSearchState }>({ forText: "", value: IDLE });
  const onResultsRef = useRef(onResults);
  useEffect(() => {
    onResultsRef.current = onResults;
  }, [onResults]);

  // Espacios dobles o al borde: el nombre guardado lleva uno solo.
  const query = text.replace(/\s+/g, " ").trim();
  const active = shouldSearchServer(query);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setState({ forText: query, value: { hitIds: null, searching: true, failed: false, limited: false } });
      try {
        const { data, error } = await createClient()
          .rpc("search_inbox", { p_workspace: workspaceId, p_q: query, p_limit: SEARCH_RESULT_LIMIT + 1 })
          .select("*, contacts(*)");
        if (cancelled) return;
        if (error) throw error;
        const rows = (data ?? []) as unknown as InboxConversation[];
        const limited = rows.length > SEARCH_RESULT_LIMIT;
        const list = rows.slice(0, SEARCH_RESULT_LIMIT);
        onResultsRef.current(list);
        setState({ forText: query, value: { hitIds: new Set(list.map((c) => c.id)), searching: false, failed: false, limited } });
      } catch {
        if (!cancelled) setState({ forText: query, value: { hitIds: null, searching: false, failed: true, limited: false } });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, query, workspaceId]);

  if (!active) return IDLE;
  // Resultado de un texto anterior: no se usa; se espera a que llegue el del actual.
  if (state.forText !== query) return { ...IDLE, searching: true };
  return state.value;
}
