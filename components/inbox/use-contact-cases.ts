"use client";

// Gestiones del contacto del chat (getContactCases) con realtime de `cases`
// filtrado por contacto: cualquier cambio vuelve a pedir la vista al servidor.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getContactCases, type ContactCasesView } from "@/lib/actions/cases";
import { uniqueChannelName } from "@/lib/realtime-channel";

export function useContactCases(contactId: string | null) {
  const [data, setData] = useState<ContactCasesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  // Contacto del chat abierto ahora: un pedido de otro contacto (por ejemplo, una
  // acción que terminó después de cambiar de chat) no debe pisar ni cancelar el actual.
  const activeContact = useRef(contactId);
  activeContact.current = contactId;

  const load = useCallback(async (id: string, quiet: boolean) => {
    if (id !== activeContact.current) return;
    const current = ++requestId.current;
    if (!quiet) setLoading(true);
    try {
      const result = await getContactCases(id);
      if (current !== requestId.current || id !== activeContact.current) return;
      if ("error" in result) {
        setError(result.error);
        setData(null);
      } else {
        setError(null);
        setData(result.data);
      }
    } catch {
      if (current === requestId.current) setError("No se pudieron cargar las gestiones. Inténtalo de nuevo.");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!contactId) {
      requestId.current++;
      setData(null);
      setError(null);
      return;
    }
    void load(contactId, false);
  }, [contactId, load]);

  // Realtime: otra persona (o el motor) cambió una gestión de este contacto.
  useEffect(() => {
    if (!contactId) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(uniqueChannelName(`contact-cases-${contactId}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cases", filter: `contact_id=eq.${contactId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void load(contactId, true), 400);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [contactId, load]);

  const reload = useCallback(async () => {
    // Siempre con el contacto abierto en este momento, no el de cuando se creó la acción.
    const id = activeContact.current;
    if (id) await load(id, true);
  }, [load]);

  // Solo devolvemos la vista si corresponde al contacto pedido.
  const view = data && data.contact.id === contactId ? data : null;
  return { data: view, error, loading: loading && !view, reload };
}
