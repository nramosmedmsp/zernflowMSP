"use client";

// Borradores en el navegador (lib/drafts.ts): acceso seguro a localStorage y
// aviso a la lista cuando cambian.

import { useEffect, useState } from "react";
import { draftConversationIds, type DraftScope, type DraftStorage } from "@/lib/drafts";

const EVENT = "zf:drafts";

export function draftStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** La caja de texto guardó o borró un borrador. */
export function notifyDraftsChanged() {
  window.dispatchEvent(new Event(EVENT));
}

/** Chats con borrador de mensaje de esta persona: id → texto. */
export function useDraftPreviews(scope: DraftScope): Map<string, string> {
  const [drafts, setDrafts] = useState<Map<string, string>>(() => new Map());
  const { userId, workspaceId } = scope;
  useEffect(() => {
    const read = () => setDrafts(draftConversationIds(draftStorage(), { userId, workspaceId }));
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, [userId, workspaceId]);
  return drafts;
}
