// Lógica pura de la bandeja (docs/FASE-1-TECNICO.md 4.1): vistas, filtros,
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

export type InboxViewKey = "mine" | "today" | "unassigned" | "team" | "all";

export const VIEW_LABELS: Record<InboxViewKey, string> = {
  mine: "Mis gestiones",
  today: "Para hoy",
  unassigned: "Sin asignar",
  team: "Mi equipo",
  all: "Todas",
};

export type StatusFilter = "" | "open" | "scheduled" | "none";

export interface InboxFilters {
  /** "" = todos, "none" = Sin clasificar. */
  caseTypeId: string;
  stageId: string;
  status: StatusFilter;
  /** "" = todos, "none" = sin asignar. */
  assigneeId: string;
  platform: "" | Platform;
  waitingOnly: boolean;
  search: string;
}

export const EMPTY_FILTERS: InboxFilters = {
  caseTypeId: "",
  stageId: "",
  status: "",
  assigneeId: "",
  platform: "",
  waitingOnly: false,
  search: "",
};

export function activeFilterCount(f: InboxFilters): number {
  return [f.caseTypeId, f.stageId, f.status, f.assigneeId, f.platform].filter(Boolean).length + (f.waitingOnly ? 1 : 0);
}

export function availableViews(meta: InboxMeta): InboxViewKey[] {
  const views: InboxViewKey[] = ["mine", "today"];
  const supervises = meta.supervisedTeamIds.length > 0;
  if (meta.isAdmin || supervises || meta.agentSeesQueue) views.push("unassigned");
  if (meta.isAdmin || supervises) views.push("team");
  if (meta.isAdmin) views.push("all");
  return views;
}

/**
 * Equipos de "Mi equipo": los que supervisa y, si es administrador, también
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

/** ¿La gestión entra en la vista? (la RLS ya filtró lo que el usuario puede ver) */
export function caseMatchesView(
  c: InboxCase,
  view: InboxViewKey,
  meta: InboxMeta,
  contactTeamId: string | null,
  now: Date,
): boolean {
  switch (view) {
    case "mine":
      return c.assignee_id === meta.userId;
    case "today": {
      if (c.assignee_id !== meta.userId || c.status !== "open") return false;
      const today = limaDateOf(now);
      const due = !!c.next_action_at && limaDateOf(new Date(c.next_action_at)) <= today;
      const activatedToday = c.scheduled_for !== null && sameLimaDay(c.opened_at, today);
      return due || activatedToday;
    }
    case "unassigned":
      return c.status === "open" && c.assignee_id === null;
    case "team": {
      const scope = teamScope(meta);
      if (!scope) return true;
      return (c.team_id !== null && scope.has(c.team_id)) || (contactTeamId !== null && scope.has(contactTeamId));
    }
    case "all":
      return true;
  }
}

export function caseMatchesFilters(c: InboxCase, f: InboxFilters): boolean {
  if (f.caseTypeId === "none" && c.case_type_id !== null) return false;
  if (f.caseTypeId && f.caseTypeId !== "none" && c.case_type_id !== f.caseTypeId) return false;
  if (f.stageId && c.stage_id !== f.stageId) return false;
  if ((f.status === "open" || f.status === "scheduled") && c.status !== f.status) return false;
  if (f.assigneeId === "none" && c.assignee_id !== null) return false;
  if (f.assigneeId && f.assigneeId !== "none" && c.assignee_id !== f.assigneeId) return false;
  if (f.waitingOnly && !c.waiting_since) return false;
  return true;
}

function hasCaseFilters(f: InboxFilters): boolean {
  return !!(f.caseTypeId || f.stageId || f.assigneeId || f.waitingOnly || f.status === "open" || f.status === "scheduled");
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
  /** Gestión que se muestra en la fila (la primera que cumple vista y filtros). */
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

/** Filas de la bandeja para la vista y los filtros, ordenadas por espera. */
export function buildRows(
  conversations: readonly InboxConversation[],
  casesByContact: ReadonlyMap<string, InboxCase[]>,
  view: InboxViewKey,
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
      (c) => caseMatchesView(c, view, meta, contactTeamId, now) && caseMatchesFilters(c, filters),
    );

    if (filters.status === "none") {
      // "Sin gestión": chats del contacto sin gestiones abiertas ni programadas.
      if (view === "all" && all.length === 0 && !hasCaseFilters(filters)) {
        rows.push({ conversation, case: null, caseCount: 0 });
      }
      continue;
    }

    if (matching.length > 0) {
      rows.push({ conversation, case: matching[0], caseCount: all.length });
    } else if (view === "all" && !hasCaseFilters(filters)) {
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
