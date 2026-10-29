"use client";

// Notas internas del contacto (case_notes) con realtime. Se muestran en el
// chat las de esa conversación y las que no tienen conversación.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";
import { uniqueChannelName } from "@/lib/realtime-channel";

export type CaseNote = Database["public"]["Tables"]["case_notes"]["Row"];

export function useCaseNotes(contactId: string | null, conversationId: string | null) {
  const [notes, setNotes] = useState<CaseNote[]>([]);

  useEffect(() => {
    // Las notas de otro contacto se descartan al leer (ver `visible`).
    if (!contactId) return;
    let cancelled = false;
    const supabase = createClient();

    void supabase
      .from("case_notes")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: true })
      .limit(500)
      .then(({ data }) => {
        if (!cancelled) setNotes((prev) => upsert(prev.filter((n) => n.contact_id === contactId), data ?? []));
      });

    const channel = supabase
      .channel(uniqueChannelName(`case-notes-${contactId}`))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "case_notes", filter: `contact_id=eq.${contactId}` },
        (payload) => setNotes((prev) => upsert(prev, [payload.new as CaseNote])),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [contactId]);

  const addLocal = useCallback((note: CaseNote) => setNotes((prev) => upsert(prev, [note])), []);

  const visible = notes.filter(
    (n) => n.contact_id === contactId && (n.conversation_id === null || n.conversation_id === conversationId),
  );
  return { notes: visible, addLocal };
}

function upsert(prev: CaseNote[], incoming: CaseNote[]): CaseNote[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((n) => [n.id, n]));
  for (const n of incoming) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
