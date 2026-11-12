// Reglas puras de la interfaz de "Ver como": textos, buscador del selector,
// tiempos de la capa de fin y detección de escrituras bloqueadas. Sin React ni
// servidor, para probarlo con vitest.

import type { ViewAsInfo, ViewAsPersonOption } from "./rules";
import { VIEW_AS_READ_ONLY_CODE } from "./guard";

/** La capa "La vista terminó" aparece este tiempo antes de la caducidad. */
/** Nota corta junto a los botones que cambian datos del cliente en "Ver como". */
export const VIEW_AS_UNAVAILABLE_NOTE = "No disponible en «Ver como»";

export const VIEW_AS_END_LEAD_MS = 5_000;
/** Cada cuánto se avisa al servidor que la vista sigue abierta. */
export const VIEW_AS_TOUCH_INTERVAL_MS = 60_000;
/** Cada cuánto la campana vuelve a leer en vista (no llegan eventos del otro usuario). */
export const VIEW_AS_BELL_POLL_MS = 30_000;

/** Nombre corto para los avisos: "Diego" (persona) o "Asesor de Ventas" (rol). */
export function viewAsShortName(info: Pick<ViewAsInfo, "kind" | "name" | "label">): string {
  if (info.kind === "role") return info.label;
  const first = info.name.trim().split(/\s+/)[0];
  return first || info.name;
}

/** Nota sobre la caja de mensaje. */
export function viewAsComposerNote(info: Pick<ViewAsInfo, "kind" | "name" | "label">): string {
  return `Solo lectura: estás viendo como ${viewAsShortName(info)}. Sal de «Ver como» para responder.`;
}

/** Aviso al tocar un botón que escribiría. */
export function viewAsBlockedNotice(info: Pick<ViewAsInfo, "kind" | "name" | "label">): string {
  return `Solo lectura: estás viendo como ${viewAsShortName(info)}. No se guardó nada.`;
}

/**
 * Nota de «Míos» vacío en una vista por rol. `seesQueue`: este rol tiene la
 * pestaña «Sin asignar» (según «Qué ve cada asesor» en Atención).
 */
export function viewAsMineEmptyNote(info: Pick<ViewAsInfo, "kind" | "teamName">, seesQueue = true): string | null {
  if (info.kind !== "role") return null;
  const queue = info.teamName ? `la cola real de ${info.teamName}` : "la cola real de la tienda";
  return seesQueue
    ? `Esta vista de ejemplo no tiene chats propios, por eso «Míos» sale vacío. En «Sin asignar» ves ${queue}. Elige una persona para ver sus chats.`
    : "Esta vista de ejemplo no tiene chats propios y, con la configuración actual de Atención, este rol solo ve los chats que le asignen. Elige una persona para ver sus chats.";
}

const WS_ROLE_TEXT: Record<string, string> = { owner: "Dueño", admin: "Administrador", member: "Miembro" };
const TEAM_ROLE_TEXT: Record<string, string> = { supervisor: "Supervisor", agent: "Asesor" };

/**
 * Rol que se muestra en la franja ámbar. Por rol: la etiqueta ("Asesor de
 * Ventas"). Por persona: Dueño / Administrador, o sus roles por equipo, o Miembro.
 */
export function viewAsRoleText(
  info: Pick<ViewAsInfo, "kind" | "label">,
  workspaceRole: string,
  teamRoles: readonly { role: string; teamName: string }[],
): string {
  if (info.kind === "role") return info.label;
  if (workspaceRole === "owner" || workspaceRole === "admin") return WS_ROLE_TEXT[workspaceRole];
  const parts = teamRoles
    .map((t) => `${TEAM_ROLE_TEXT[t.role] ?? t.role} de ${t.teamName}`)
    .sort((a, b) => a.localeCompare(b, "es"));
  return parts.length > 0 ? parts.join(" · ") : (WS_ROLE_TEXT[workspaceRole] ?? "Miembro");
}

/** Quita acentos y pasa a minúsculas para buscar. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Buscador del selector: nombre, correo, rol y equipos; todas las palabras deben aparecer. */
export function filterViewAsPeople(people: readonly ViewAsPersonOption[], query: string): ViewAsPersonOption[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...people];
  return people.filter((p) => {
    const haystack = normalizeSearch(`${p.name} ${p.email} ${p.roleLabel} ${p.teams.join(" ")}`);
    return words.every((w) => haystack.includes(w));
  });
}

/** Milisegundos hasta que debe aparecer la capa de fin (0 o menos: ya). */
export function msUntilEndLayer(expiresAt: string | number, now: number): number {
  const exp = typeof expiresAt === "number" ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return 0;
  return exp - VIEW_AS_END_LEAD_MS - now;
}

/** Pasos del reloj de la capa (para no depender de un setTimeout gigante). */
export const MAX_TIMER_MS = 2_000_000_000;

/**
 * ¿Esta respuesta de red es una escritura bloqueada por "Solo lectura"? Sirve
 * para las lecturas/escrituras directas del navegador a PostgREST (error 25006,
 * "read-only transaction") y para el 403 del candado del servidor.
 */
export function isReadOnlyRejection(status: number, bodyText: string): boolean {
  // PostgREST responde 405 al error 25006 (transacción de solo lectura).
  if (![400, 403, 405, 409, 500].includes(status)) return false;
  if (bodyText.includes(VIEW_AS_READ_ONLY_CODE)) return true;
  return /"code"\s*:\s*"25006"/.test(bodyText) || /read-only transaction/i.test(bodyText);
}

/** La cookie crm_ro_hit trae la hora (ms) del último bloqueo; ¿es más nueva que la que ya se atendió? */
export function newReadOnlyHit(cookieHeader: string, lastSeen: number): number | null {
  const m = /(?:^|;\s*)crm_ro_hit=(\d+)/.exec(cookieHeader);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) && value > lastSeen ? value : null;
}

/** Entradas de `listCaseMembers` que son la identidad de ejemplo (no se pueden asignar ni mencionar). */
export function withoutSample<T extends { sample?: boolean }>(members: readonly T[]): T[] {
  return members.filter((m) => !m.sample);
}

/** Ruta a la que se entra al iniciar o cambiar de vista. */
export const VIEW_AS_ENTRY_PATH = "/dashboard/inbox";

/** Duración legible del registro: "4 min 12 s", "58 s", "1 h 05 min". */
export function formatViewDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

export interface ViewLogRow {
  id: string;
  started_at: string;
  last_seen_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  expires_at: string;
}

/**
 * Duración de una vista: hasta que se cerró; si venció sin "Salir", hasta la
 * última actividad; si sigue abierta, hasta ahora (sin pasar de la caducidad).
 */
export function viewDurationMs(row: ViewLogRow, now: number): number {
  const start = Date.parse(row.started_at);
  const exp = Date.parse(row.expires_at);
  let end: number;
  if (row.ended_at) {
    end = row.end_reason === "expired" && row.last_seen_at ? Date.parse(row.last_seen_at) : Date.parse(row.ended_at);
  } else if (now >= exp) {
    end = row.last_seen_at ? Date.parse(row.last_seen_at) : exp;
  } else {
    end = now;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.min(end, Math.max(exp, start)) - start);
}

/** ¿La vista sigue en curso en este momento? */
export function isViewInProgress(row: Pick<ViewLogRow, "ended_at" | "expires_at">, now: number): boolean {
  return !row.ended_at && Date.parse(row.expires_at) > now;
}

export type LogPeriod = "7" | "30" | "90" | "all";
export const LOG_PERIODS: { value: LogPeriod; label: string }[] = [
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "all", label: "Todo el registro" },
];

export function parseLogPeriod(raw: string | string[] | undefined): LogPeriod {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "7" || v === "30" || v === "90" || v === "all" ? v : "30";
}

/** Fecha mínima del periodo (ISO), o null para todo. */
export function logPeriodSince(period: LogPeriod, now: number): string | null {
  if (period === "all") return null;
  return new Date(now - Number(period) * 86_400_000).toISOString();
}

/** Segunda línea de "A quién" en el registro: "Vista de ejemplo" si es por rol (la primera línea ya trae rol y equipo). */
export function viewLogTargetDetail(row: { target_kind: string; target_label: string; target_detail: string | null }): string {
  if (row.target_kind === "role") return "Vista de ejemplo";
  return row.target_detail ?? "Persona";
}
