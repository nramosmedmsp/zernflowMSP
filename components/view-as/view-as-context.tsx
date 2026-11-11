"use client";

// Estado de "Ver como" para los componentes de cliente. Sin vista activa el
// valor por defecto es "no hay vista": todo se comporta como siempre.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ViewAsInfo } from "@/lib/view-as/rules";
import { viewAsBlockedNotice, viewAsComposerNote } from "@/lib/view-as/ui-rules";

export interface ViewAsClientState {
  /** Hay una vista vigente: la app es de solo lectura y no deja huella. */
  active: boolean;
  /** Hay candado (cookie) aunque la base ya cerró la vista. */
  locked: boolean;
  /** La base ya no tiene la vista (caducó o se cerró): se muestra la capa de fin. */
  ended: boolean;
  info: ViewAsInfo | null;
  /** Rol que se muestra en la franja ("Asesor de Ventas"). */
  roleText: string;
  /** Nota fija de la caja de mensaje (null sin vista). */
  composerNote: string | null;
  /** Aviso al tocar algo que escribiría (null sin vista). */
  blockedNotice: string | null;
}

export const NO_VIEW_CLIENT: ViewAsClientState = {
  active: false,
  locked: false,
  ended: false,
  info: null,
  roleText: "",
  composerNote: null,
  blockedNotice: null,
};

const Ctx = createContext<ViewAsClientState>(NO_VIEW_CLIENT);

export function ViewAsProvider({
  active,
  locked,
  ended,
  info,
  roleText,
  children,
}: {
  active: boolean;
  locked: boolean;
  ended: boolean;
  info: ViewAsInfo | null;
  roleText: string;
  children: ReactNode;
}) {
  const value = useMemo<ViewAsClientState>(
    () => ({
      active,
      locked,
      ended,
      info,
      roleText,
      composerNote: active && info ? viewAsComposerNote(info) : null,
      blockedNotice: active && info ? viewAsBlockedNotice(info) : null,
    }),
    [active, locked, ended, info, roleText],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Estado de "Ver como". Fuera de una vista: `active` es false. */
export function useViewAs(): ViewAsClientState {
  return useContext(Ctx);
}
