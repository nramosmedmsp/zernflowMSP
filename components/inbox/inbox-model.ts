// Lógica pura de la bandeja (docs/FASE-1-TECNICO.md 4.1): alcance, estado, filtros,
// orden por espera y la gestión que representa a cada chat. Sin E/S, para
// probarla con vitest (inbox-model.test.ts).

import { limaDateOf } from "@/lib/cases/dates";
import type { Database, MemberAvailability, Platform, StageKind, TeamRole } from "@/lib/types/database";

export type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
export type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
export type InboxConversation = ConversationRow & { contacts: ContactRow | null };
/** Gestión abierta o programada tal como la entrega la RLS (select *). */
export type InboxCase = Database["public"]["Tables"]["cases"]["Row"];

export interface InboxMember {
  userId: string;
  name: string;
  email: string | null;
  availability: MemberAvailability;
  teams: { teamId: string; role: TeamRole }[];
}

export interface InboxCaseType {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
  stages: { id: string; name: string; color: string | null; kind: StageKind; archived: boolean }[];
}

export interface InboxMeta {
  userId: string;
  isAdmin: boolean;
  /** La visibilidad de asesores permite ver la cola sin asignar. */
  agentSeesQueue: boolean;
  supervisedTeamIds: string[];
  /** Equipos en los que soy miembro (cualquier rol). */
  myTeamIds: string[];
  workspaceHasTeams: boolean;
  workspaceName: string;
  caseTypes: InboxCaseType[];
  teams: { id: string; name: string }[];
  members: InboxMember[];
  /** Canales de prueba del espacio (lib/demo.ts): etiqueta "Prueba". */
  demoChannelIds?: string[];
}

/** De quién son los chats que se ven ("Ver"). */
export type InboxScope = "mine" | "unassigned" | "team" | "all";
/** Qué hay que hacer con ellos: por responder, seguimiento de hoy o todo. */
export type InboxState = "waiting" | "today" | "all";

export const SCOPE_LABELS: Record<InboxScope, string> = {
  mine: "Míos",
  unassigned: "Sin asignar",
  team: "Equipo",
  all: "Todos",
};

export const STATE_LABELS: Record<InboxState, string> = {
  waiting: "Por responder",
  today: "Seguimiento hoy",
  all: "Todo",
};

export const INBOX_STATES: readonly InboxState[] = ["waiting", "today", "all"];
export const DEFAULT_SCOPE: InboxScope = "mine";
export const DEFAULT_STATE: InboxState = "all";

export type StatusFilter = "" | "open" | "scheduled" | "none";

export interface InboxFilters {
  /** "" = todos, "none" = Sin clasificar. */
  caseTypeId: string;
  stageId: string;
  status: StatusFilter;
  /** "" = todos, "none" = sin asignar. */
  assigneeId: string;
  platform: "" | Platform;
  search: string;
}

export const EMPTY_FILTERS: InboxFilters = {
  caseTypeId: "",
  stageId: "",
  status: "",
  assigneeId: "",
  platform: "",
  search: "",
};

/** "Sin gestión" solo existe en el alcance Todos: en los demás se quita. */
export function filtersForScope(f: InboxFilters, scope: InboxScope): InboxFilters {
  return f.status === "none" && scope !== "all" ? { ...f, status: "" } : f;
}

export function activeFilterCount(f: InboxFilters): number {
  return [f.caseTypeId, f.stageId, f.status, f.assigneeId, f.platform].filter(Boolean).length;
}

export function availableScopes(meta: InboxMeta): InboxScope[] {
  const scopes: InboxScope[] = ["mine"];
  const supervises = meta.supervisedTeamIds.length > 0;
  if (meta.isAdmin || supervises || meta.agentSeesQueue) scopes.push("unassigned");
  if (meta.isAdmin || supervises) scopes.push("team");
  if (meta.isAdmin) scopes.push("all");
  return scopes;
}

/**
 * Equipos de "Equipo": los que supervisa y, si es administrador, también
 * en los que es miembro. null = todos (administrador sin equipos propios).
 */
export function teamScope(meta: InboxMeta): Set<string> | null {
  const ids = new Set(meta.supervisedTeamIds);
  if (meta.isAdmin) {
    for (const id of meta.myTeamIds) ids.add(id);
    if (ids.size === 0) return null;
  }
  return ids;
}

function sameLimaDay(iso: string | null, today: string): boolean {
  return !!iso && limaDateOf(new Date(iso)) === today;
}

/** ¿La gestión entra en el alcance? (la RLS ya filtró lo que el usuario puede ver) */
export function caseMatchesScope(
  c: InboxCase,
  scope: InboxScope,
  meta: InboxMeta,
  contactTeamId: string | null,
): boolean {
  switch (scope) {
    case "mine":
      return c.assignee_id === meta.userId;
    case "unassigned":
      return c.status === "open" && c.assignee_id === null;
    case "team": {
      const teams = teamScope(meta);
      if (!teams) return true;
      return (c.team_id !== null && teams.has(c.team_id)) || (contactTeamId !== null && teams.has(contactTeamId));
    }
    case "all":
      return true;
  }
}

/**
 * ¿La gestión entra en el estado? Por responder = el cliente escribió y nadie
 * contestó; Seguimiento hoy = próximo contacto vencido o de hoy, o activada hoy.
 */
export function caseMatchesState(c: InboxCase, state: InboxState, now: Date): boolean {
  switch (state) {
    case "waiting":
      return !!c.waiting_since;
    case "today": {
      if (c.status !== "open") return false;
      const today = limaDateOf(now);
      const due = !!c.next_action_at && limaDateOf(new Date(c.next_action_at)) <= today;
      const activatedToday = c.scheduled_for !== null && sameLimaDay(c.opened_at, today);
      return due || activatedToday;
    }
    case "all":
      return true;
  }
}

/** Etiqueta del alcance; "Equipo" lleva el nombre del equipo si es uno solo. */
export function scopeLabel(meta: InboxMeta, scope: InboxScope): string {
  if (scope === "team") {
    const ids = teamScope(meta);
    if (ids && ids.size === 1) {
      const [id] = [...ids];
      return meta.teams.find((t) => t.id === id)?.name || SCOPE_LABELS.team;
    }
  }
  return SCOPE_LABELS[scope];
}

const SCOPE_NOUN: Record<InboxScope, string> = {
  mine: "Tus chats",
  unassigned: "Chats sin asignar",
  team: "Chats del equipo",
  all: "Todos los chats",
};

/** Una línea que explica qué se está viendo. */
export function viewHint(scope: InboxScope, state: InboxState): string {
  if (state === "waiting") return `${SCOPE_NOUN[scope]} esperando respuesta.`;
  if (state === "today") return `${SCOPE_NOUN[scope]} con contacto hoy o atrasado.`;
  switch (scope) {
    case "mine":
      return "Chats asignados a ti. Primero los que más esperan.";
    case "unassigned":
      return "Chats que nadie ha tomado todavía.";
    case "team":
      return "Chats de tu equipo.";
    case "all":
      return "Todos los chats de la tienda, incluso sin gestión.";
  }
}

/** Alcance y estado guardados: valida lo leído y cae en Míos si el alcance no está disponible. */
export function parseStoredView(
  raw: string | null,
  scopes: readonly InboxScope[],
): { scope: InboxScope; state: InboxState } {
  let scope: InboxScope = DEFAULT_SCOPE;
  let state: InboxState = DEFAULT_STATE;
  try {
    const v = raw ? (JSON.parse(raw) as { scope?: unknown; state?: unknown }) : null;
    if (v && scopes.includes(v.scope as InboxScope)) scope = v.scope as InboxScope;
    if (v && INBOX_STATES.includes(v.state as InboxState)) state = v.state as InboxState;
  } catch {
    // Datos corruptos: se usan los valores por defecto.
  }
  return { scope, state };
}

/** Texto de la lista vacía; con filtros o búsqueda, el genérico. */
export function emptyText(scope: InboxScope, state: InboxState, filtered: boolean): string {
  if (filtered) return "No se encontraron conversaciones";
  const texts: Record<InboxScope, Record<InboxState, string>> = {
    mine: {
      waiting: "No tienes chats por responder",
      today: "No tienes seguimientos para hoy",
      all: "No tienes chats asignados",
    },
    unassigned: {
      waiting: "No hay chats sin asignar por responder",
      today: "No hay chats sin asignar con seguimiento hoy",
      all: "No hay chats sin asignar",
    },
    team: {
      waiting: "Tu equipo no tiene chats por responder",
      today: "Tu equipo no tiene seguimientos para hoy",
      all: "Tu equipo no tiene chats",
    },
    all: {
      waiting: "No hay chats por responder",
      today: "Nadie tiene seguimientos para hoy",
      all: "No hay conversaciones",
    },
  };
  return texts[scope][state];
}

export function caseMatchesFilters(c: InboxCase, f: InboxFilters): boolean {
  if (f.caseTypeId === "none" && c.case_type_id !== null) return false;
  if (f.caseTypeId && f.caseTypeId !== "none" && c.case_type_id !== f.caseTypeId) return false;
  if (f.stageId && c.stage_id !== f.stageId) return false;
  if ((f.status === "open" || f.status === "scheduled") && c.status !== f.status) return false;
  if (f.assigneeId === "none" && c.assignee_id !== null) return false;
  if (f.assigneeId && f.assigneeId !== "none" && c.assignee_id !== f.assigneeId) return false;
  return true;
}

function hasCaseFilters(f: InboxFilters): boolean {
  return !!(f.caseTypeId || f.stageId || f.assigneeId || f.status === "open" || f.status === "scheduled");
}

function time(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NaN : t;
}

/**
 * Orden de las gestiones de un contacto para elegir la que representa al
 * chat: abiertas antes que programadas, las mías primero y la que más espera.
 */
export function compareCases(a: InboxCase, b: InboxCase, userId: string): number {
  if (a.status !== b.status) return a.status === "open" ? -1 : 1;
  const aMine = a.assignee_id === userId;
  const bMine = b.assignee_id === userId;
  if (aMine !== bMine) return aMine ? -1 : 1;
  const aw = time(a.waiting_since);
  const bw = time(b.waiting_since);
  if (!Number.isNaN(aw) || !Number.isNaN(bw)) {
    if (Number.isNaN(aw)) return 1;
    if (Number.isNaN(bw)) return -1;
    if (aw !== bw) return aw - bw;
  }
  return time(b.created_at) - time(a.created_at);
}

export function groupCasesByContact(cases: readonly InboxCase[]): Map<string, InboxCase[]> {
  const map = new Map<string, InboxCase[]>();
  for (const c of cases) {
    if (c.status !== "open" && c.status !== "scheduled") continue;
    const list = map.get(c.contact_id);
    if (list) list.push(c);
    else map.set(c.contact_id, [c]);
  }
  return map;
}

export interface InboxRow {
  conversation: InboxConversation;
  /** Gestión que se muestra en la fila (la primera que cumple alcance, estado y filtros). */
  case: InboxCase | null;
  /** Gestiones activas del contacto. */
  caseCount: number;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function matchesSearch(conversation: InboxConversation, search: string): boolean {
  const q = normalize(search.trim());
  if (!q) return true;
  const fields = [
    conversation.contacts?.display_name,
    conversation.contacts?.email,
    conversation.contacts?.phone,
    conversation.last_message_preview,
  ];
  return fields.some((f) => !!f && normalize(f).includes(q));
}

/** Filas de la bandeja para el alcance, el estado y los filtros, ordenadas por espera. */
export function buildRows(
  conversations: readonly InboxConversation[],
  casesByContact: ReadonlyMap<string, InboxCase[]>,
  scope: InboxScope,
  state: InboxState,
  filters: InboxFilters,
  meta: InboxMeta,
  now: Date,
): InboxRow[] {
  const rows: InboxRow[] = [];
  for (const conversation of conversations) {
    if (filters.platform && conversation.platform !== filters.platform) continue;
    if (!matchesSearch(conversation, filters.search)) continue;

    const all = [...(casesByContact.get(conversation.contact_id) ?? [])].sort((a, b) =>
      compareCases(a, b, meta.userId),
    );
    const contactTeamId = conversation.contacts?.team_id ?? null;
    const matching = all.filter(
      (c) => caseMatchesScope(c, scope, meta, contactTeamId) && caseMatchesState(c, state, now) && caseMatchesFilters(c, filters),
    );

    if (filters.status === "none") {
      // "Sin gestión": chats del contacto sin gestiones abiertas ni programadas.
      if (scope === "all" && state === "all" && all.length === 0 && !hasCaseFilters(filters)) {
        rows.push({ conversation, case: null, caseCount: 0 });
      }
      continue;
    }

    if (matching.length > 0) {
      rows.push({ conversation, case: matching[0], caseCount: all.length });
    } else if (scope === "all" && state === "all" && !hasCaseFilters(filters)) {
      rows.push({ conversation, case: all[0] ?? null, caseCount: all.length });
    }
  }
  return sortRows(rows);
}

/** Primero los que más esperan (waiting_since más antiguo); luego por último mensaje. */
export function sortRows(rows: InboxRow[]): InboxRow[] {
  return rows.sort((a, b) => {
    const aw = time(a.case?.waiting_since);
    const bw = time(b.case?.waiting_since);
    const aWaiting = !Number.isNaN(aw);
    const bWaiting = !Number.isNaN(bw);
    if (aWaiting !== bWaiting) return aWaiting ? -1 : 1;
    if (aWaiting && bWaiting && aw !== bw) return aw - bw;
    const at = time(a.conversation.last_message_at ?? a.conversation.created_at);
    const bt = time(b.conversation.last_message_at ?? b.conversation.created_at);
    return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
  });
}

/** "hace 5 min" → "Esperando hace 5 min"; una fecha → "Esperando desde 3 oct 2026". */
export function waitingText(relative: string): string {
  if (!relative) return "";
  if (relative === "ahora") return "Esperando desde ahora";
  if (relative.startsWith("hace ") || relative === "ayer") return `Esperando ${relative}`;
  return `Esperando desde ${relative}`;
}

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** ¿El chat de WhatsApp está fuera de la ventana de 24 horas? */
export function outsideWhatsAppWindow(
  platform: Platform,
  lastInboundAt: string | null,
  now: number,
): boolean {
  if (platform !== "whatsapp" || !lastInboundAt) return false;
  const t = time(lastInboundAt);
  return !Number.isNaN(t) && now - t > WHATSAPP_WINDOW_MS;
}

/**
 * Lo que queda de la ventana de 24 horas de WhatsApp: "Quedan 21 h" o
 * "Quedan 40 min" (urgente en la última hora). null si no aplica o ya cerró.
 */
export function whatsAppWindowChip(
  platform: Platform,
  lastInboundAt: string | null,
  now: number,
): { text: string; urgent: boolean } | null {
  if (platform !== "whatsapp" || !lastInboundAt) return null;
  const t = time(lastInboundAt);
  if (Number.isNaN(t)) return null;
  const left = WHATSAPP_WINDOW_MS - (now - t);
  if (left <= 0) return null;
  const minutes = Math.max(1, Math.ceil(left / 60_000));
  if (minutes < 60) return { text: `Quedan ${minutes} min`, urgent: true };
  return { text: `Quedan ${Math.floor(minutes / 60)} h`, urgent: false };
}

/** El más reciente de dos instantes ISO (o el que exista). */
export function latestIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = time(a);
  const tb = time(b);
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? null : (b as string);
  if (Number.isNaN(tb)) return a as string;
  return ta >= tb ? (a as string) : (b as string);
}

/** Nombre de un miembro por id, con respaldo legible. */
export function memberName(members: readonly InboxMember[], userId: string | null | undefined): string {
  if (!userId) return "Sin asignar";
  return members.find((m) => m.userId === userId)?.name ?? "Otra persona";
}

/**
 * Quién envió un mensaje propio: "Tú", el nombre del asesor o "Bot · flujo".
 * null si no se sabe (por ejemplo, enviado desde otra app).
 */
export function messageAuthor(
  message: { direction: string; sent_by_user_id: string | null; sent_by_flow_id: string | null; flow_name?: string | null },
  members: readonly InboxMember[],
  meId: string,
): string | null {
  if (message.direction !== "outbound") return null;
  if (message.sent_by_flow_id) return message.flow_name ? `Bot · ${message.flow_name}` : "Bot";
  if (!message.sent_by_user_id) return null;
  if (message.sent_by_user_id === meId) return "Tú";
  return members.find((m) => m.userId === message.sent_by_user_id)?.name ?? "Otro asesor";
}

// ── Menciones en notas internas ─────────────────────────────────────────────

/**
 * Consulta de mención en curso: el texto entre una "@" (al inicio o tras un
 * espacio) y el cursor, sin saltos de línea. null si no hay.
 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.includes("\n") || query.length > 40 || /\s{2}/.test(query)) return null;
  return { start: at, query };
}

export function filterMembers(members: readonly InboxMember[], query: string, limit = 6): InboxMember[] {
  const q = normalize(query.trim());
  return members
    .filter((m) => !q || normalize(m.name).includes(q) || (!!m.email && normalize(m.email).includes(q)))
    .slice(0, limit);
}

/** Ids mencionados que siguen presentes en el texto como "@Nombre". */
export function mentionedIds(text: string, picked: ReadonlyMap<string, string>): string[] {
  const ids: string[] = [];
  for (const [userId, name] of picked) {
    if (text.includes(`@${name}`)) ids.push(userId);
  }
  return ids;
}
