// Estado de "Ver como" para el servidor: quién es la persona REAL y qué aplicó
// la base a esta petición. Aquí y en lib/view-as/service.ts están las únicas
// lecturas directas de Auth permitidas (ver view-as/no-direct-auth.test.ts); el
// resto del código pide la identidad con getWorkspace(), getEffectiveUser() o
// los guardas de lib/api-auth.ts.

import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { rpcViewAsCurrent } from "@/lib/supabase/extra-rpc";
import type { SessionUser } from "@/lib/workspace";
import { isViewAsLocked } from "./lock";
import { parseViewAsInfo, type ViewAsInfo } from "./rules";

export interface RealSession {
  /** Persona verificada por el JWT (no cambia con la vista). */
  user: SessionUser;
  /** session_id del JWT: ata la vista a esta sesión de Auth. */
  authSessionId: string | null;
}

/** Persona real de la sesión (claims del JWT verificados), o null si no hay sesión. */
export const getRealSession = cache(async (): Promise<RealSession | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return {
    user: {
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : undefined,
      user_metadata: (claims.user_metadata as Record<string, unknown> | undefined) ?? {},
    },
    authSessionId: typeof claims.session_id === "string" ? claims.session_id : null,
  };
});

export interface ViewAsState {
  /** Hay cookie de vista (el candado de solo lectura está puesto). */
  locked: boolean;
  /** La base tiene una vista vigente y aplicó la identidad de la persona mirada. */
  active: boolean;
  /** Hay cookie pero la base ya no tiene vista vigente (caducó, se cerró o la cookie es falsa). */
  ended: boolean;
  info: ViewAsInfo | null;
}

export const NO_VIEW: ViewAsState = { locked: false, active: false, ended: false, info: null };

/**
 * Estado de la vista en esta petición. Sin cookie no hace ninguna consulta. Con
 * cookie pregunta a la base (view_as_current con la sesión del usuario): lo que
 * diga la base manda, no la cookie.
 */
export const getViewAsState = cache(async (): Promise<ViewAsState> => {
  if (!(await isViewAsLocked())) return NO_VIEW;
  const supabase = await createClient();
  const { data } = await rpcViewAsCurrent(supabase);
  const info = parseViewAsInfo(data);
  return info ? { locked: true, active: true, ended: false, info } : { locked: true, active: false, ended: true, info: null };
});

/** Usuario efectivo: la persona que se está viendo, o la real si no hay vista. */
export function effectiveUserFor(real: SessionUser, state: ViewAsState): SessionUser {
  if (!state.active || !state.info) return real;
  return {
    id: state.info.targetUserId,
    email: state.info.email ?? undefined,
    user_metadata: { full_name: state.info.name },
  };
}

/** Identidad efectiva de la petición (null si no hay sesión). */
export async function getEffectiveUser(): Promise<SessionUser | null> {
  const real = await getRealSession();
  if (!real) return null;
  return effectiveUserFor(real.user, await getViewAsState());
}

/**
 * Usuario REAL verificado contra el servidor de Auth (getUser). Lo usan los
 * guardas de rutas API, que siempre han confirmado la sesión así; la identidad
 * efectiva se arma después con effectiveUserFor.
 */
export async function getVerifiedAuthUser(supabase: Pick<SupabaseClient, "auth">): Promise<User | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

/** El `User` de Auth con los datos de la persona vista (si hay vista); si no, el mismo. */
export function effectiveAuthUser(real: User, state: ViewAsState): User {
  if (!state.active || !state.info) return real;
  return {
    ...real,
    id: state.info.targetUserId,
    email: state.info.email ?? undefined,
    user_metadata: { full_name: state.info.name },
    app_metadata: {},
  };
}

/**
 * Para rutas API: usuario efectivo confirmado contra Auth (como el antiguo
 * `supabase.auth.getUser()`), o null sin sesión. Con una vista activa devuelve
 * a la persona vista.
 */
export async function getEffectiveAuthUser(supabase: Pick<SupabaseClient, "auth">): Promise<User | null> {
  const real = await getVerifiedAuthUser(supabase);
  if (!real) return null;
  return effectiveAuthUser(real, await getViewAsState());
}
