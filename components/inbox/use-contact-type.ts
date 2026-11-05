"use client";

// Tipo de contacto del chat abierto: lo que necesita la cabecera (chip y
// menú), la pregunta única "¿Ya nos compró antes?" y las líneas automáticas
// del hilo. Escribe con las acciones de servidor (updateContactType confirma el
// tipo; snoozeContactTypePrompt calla la pregunta 7 días) y actualiza la lista
// al instante sin esperar a recargar.

import { useCallback, useMemo, useState } from "react";
import { snoozeContactTypePrompt, updateContactType } from "@/lib/actions/contacts";
import type { ContactCasesView } from "@/lib/actions/cases";
import {
  chatLineText,
  firstName,
  isChatLineChange,
  shouldAskContactType,
  snoozeUntil,
  type ContactTypeOption,
} from "@/lib/cases/contact-type-model";
import { useToast } from "@/components/ui/toast";
import type { ContactRow, InboxConversation } from "./inbox-model";
import type { ThreadContactType } from "./message-thread";

export function useContactTypeThread({
  conversation,
  casesData,
  types,
  me,
  patchContact,
  reload,
}: {
  conversation: InboxConversation | null;
  casesData: ContactCasesView | null;
  /** Tipos del espacio (con archivados marcados). */
  types: readonly ContactTypeOption[];
  me: { userId: string; name: string };
  patchContact: (contactId: string, patch: Partial<ContactRow>) => void;
  /** Vuelve a leer las gestiones y la ficha del contacto. */
  reload: () => Promise<void>;
}): ThreadContactType | null {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const contact = conversation?.contacts ?? null;
  const contactId = conversation?.contact_id ?? null;
  const view = casesData && casesData.contact.id === contactId ? casesData : null;

  const options = useMemo(() => types.filter((t) => !t.archived), [types]);
  const typeName = useCallback((id: string | null) => types.find((t) => t.id === id)?.name ?? (id ? "otro tipo" : "Sin tipo"), [types]);

  const change = useCallback(
    async (typeId: string) => {
      if (!contactId || busy) return;
      setBusy(true);
      try {
        const result = await updateContactType(contactId, typeId);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        patchContact(contactId, {
          contact_type_id: typeId,
          contact_type_confirmed_at: new Date().toISOString(),
          contact_type_confirmed_by: me.userId,
          contact_type_prompt_snoozed_until: null,
        });
        toast.success(`Guardado en la ficha de ${firstName(contact?.display_name)}${me.name ? ` · cambiado por ${me.name}` : ""}`);
        await reload();
      } catch {
        toast.error("No se pudo guardar el tipo de contacto. Inténtalo de nuevo.");
      } finally {
        setBusy(false);
      }
    },
    [contactId, busy, contact?.display_name, me.userId, me.name, patchContact, reload, toast],
  );

  const snooze = useCallback(async () => {
    if (!contactId || busy) return;
    setBusy(true);
    try {
      const result = await snoozeContactTypePrompt(contactId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      patchContact(contactId, { contact_type_prompt_snoozed_until: snoozeUntil(new Date()) });
      await reload();
    } catch {
      toast.error("No se pudo posponer la pregunta. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }, [contactId, busy, patchContact, reload, toast]);

  const info = view?.contact.typeInfo ?? null;
  const confirmedAt = info?.confirmedAt ?? contact?.contact_type_confirmed_at ?? null;
  const snoozedUntil = [info?.snoozedUntil, contact?.contact_type_prompt_snoozed_until]
    .filter((v): v is string => !!v)
    .sort()
    .pop() ?? null;
  // La pregunta solo sale cuando ya se sabe si compró (la vista del contacto cargó).
  const ask = !!info && shouldAskContactType({ confirmedAt, snoozedUntil, hasWonCase: info.hasWonCase }, new Date());

  const events = useMemo(
    () =>
      (info?.history ?? [])
        .filter(isChatLineChange)
        .map((h) => ({ id: h.id, at: h.at, text: chatLineText(h, contact?.display_name, typeName) })),
    [info?.history, contact?.display_name, typeName],
  );

  if (!conversation) return null;
  const currentId = contact?.contact_type_id ?? null;
  const current = types.find((t) => t.id === currentId) ?? view?.currentContactType ?? null;
  return { current, options, busy, ask, onChange: change, onSnooze: snooze, events };
}
