// Lógica pura de la lista de gestiones (docs/PLAN-CRM.md 7.2): pestañas,
// parámetros de la URL, el cálculo de "Para hoy" y textos. Sin dependencias
// de React ni de servidor, para probarla con vitest.

import { addDays, limaDateOf, limaDateTimeIso } from "@/lib/cases/dates";
import type { CaseStatus } from "@/lib/types/database";

export const CASES_PATH = "/dashboard/cases";
export const CASES_PAGE_SIZE = 25;

export type CaseTab = "open" | "today" | "scheduled" | "closed";
export const CASE_TABS: readonly { key: CaseTab; label: string }[] = [
  { key: "open", label: "Abiertas" },
  { key: "today", label: "Para hoy" },
  { key: "scheduled", label: "Programadas" },
  { key: "closed", label: "Cerradas" },
];

export type ClosedPeriod = "30" | "90" | "all";
export const CLOSED_PERIODS: readonly { key: ClosedPeriod; label: string }[] = [
  { key: "30", label: "Últimos 30 días" },
  { key: "90", label: "Últimos 90 días" },
  { key: "all", label: "Todas" },
];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  scheduled: "Programada",
  open: "Abierta",
  won: "Ganada",
  lost: "Perdida",
  resolved: "Resuelta",
  cancelled: "Cancelada",
};

export const CLOSED_STATUSES: readonly CaseStatus[] = ["won", "lost", "resolved", "cancelled"];

/** Valor del filtro para "sin tipo", "sin equipo" o "sin responsable". */
export const NONE_FILTER = "none";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface CaseListParams {
  tab: CaseTab;
  /** Id del tipo de gestión, "none" (sin clasificar) o "". */
  type: string;
  stage: string;
  /** "" (según la pestaña), "me", "all", "none" o el id de un miembro. */
  assignee: string;
  team: string;
  q: string;
  page: number;
  period: ClosedPeriod;
}

export const DEFAULT_CASE_PARAMS: CaseListParams = {
  tab: "open",
  type: "",
  stage: "",
  assignee: "",
  team: "",
  q: "",
  page: 1,
  period: "30",
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function idOrNone(value: string): string {
  return value === NONE_FILTER || isUuid(value) ? value : "";
}

export function parseCaseTab(value: unknown): CaseTab {
  return CASE_TABS.some((t) => t.key === value) ? (value as CaseTab) : "open";
}

/** Lee y sanea los parámetros de la URL. Nunca falla: lo inválido se ignora. */
export function parseCaseListParams(raw: RawParams): CaseListParams {
  const assignee = first(raw.assignee);
  const page = Number.parseInt(first(raw.page), 10);
  const period = first(raw.period);
  return {
    tab: parseCaseTab(first(raw.tab)),
    type: idOrNone(first(raw.type)),
    stage: isUuid(first(raw.stage)) ? first(raw.stage) : "",
    assignee:
      assignee === "me" || assignee === "all" || assignee === NONE_FILTER || isUuid(assignee) ? assignee : "",
    team: idOrNone(first(raw.team)),
    q: first(raw.q).trim().slice(0, 100),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
    period: period === "90" || period === "all" ? period : "30",
  };
}

/** URL de la lista con los parámetros que no son los de por defecto. */
export function buildCasesHref(params: Partial<CaseListParams>): string {
  const p = { ...DEFAULT_CASE_PARAMS, ...params };
  const qs = new URLSearchParams();
  if (p.tab !== "open") qs.set("tab", p.tab);
  if (p.type) qs.set("type", p.type);
  if (p.stage) qs.set("stage", p.stage);
  if (p.assignee) qs.set("assignee", p.assignee);
  if (p.team) qs.set("team", p.team);
  if (p.q) qs.set("q", p.q);
  if (p.tab === "closed" && p.period !== "30") qs.set("period", p.period);
  if (p.page > 1) qs.set("page", String(p.page));
  const text = qs.toString();
  return text ? `${CASES_PATH}?${text}` : CASES_PATH;
}

export type AssigneeFilter = { kind: "all" } | { kind: "none" } | { kind: "user"; userId: string };

/**
 * Filtro de responsable efectivo. En "Para hoy" se muestran las mías; solo
 * administradores y supervisores pueden ver las de otros (la RLS sigue
 * decidiendo qué gestiones ve cada uno).
 */
export function resolveAssigneeFilter(
  tab: CaseTab,
  raw: string,
  userId: string,
  canSeeOthers: boolean,
): AssigneeFilter {
  if (tab === "today" && !canSeeOthers) return { kind: "user", userId };
  if (raw === "me") return { kind: "user", userId };
  if (raw === NONE_FILTER) return { kind: "none" };
  if (raw === "all") return { kind: "all" };
  if (isUuid(raw)) return { kind: "user", userId: raw };
  return tab === "today" ? { kind: "user", userId } : { kind: "all" };
}

// ── Para hoy ───────────────────────────────────────────────────────────────

export interface TodayBounds {
  /** Inicio del día en Lima (inclusive). */
  startIso: string;
  /** Inicio del día siguiente en Lima (exclusivo). */
  endIso: string;
}

export function todayBounds(now: Date): TodayBounds {
  const today = limaDateOf(now);
  return { startIso: limaDateTimeIso(today, 0), endIso: limaDateTimeIso(addDays(today, 1), 0) };
}

export interface TodayCandidate {
  id: string;
  status: CaseStatus;
  assigneeId: string | null;
  nextActionAt: string | null;
}

/**
 * ¿La gestión va en "Para hoy" de este usuario? Abierta y asignada a él, con
 * próximo contacto vencido o de hoy, o activada hoy (programada que el cron
 * abrió).
 */
export function isCaseForToday(
  c: TodayCandidate,
  userId: string,
  bounds: TodayBounds,
  activatedTodayIds: ReadonlySet<string> = new Set(),
): boolean {
  if (c.status !== "open" || c.assigneeId !== userId) return false;
  if (activatedTodayIds.has(c.id)) return true;
  return c.nextActionAt !== null && new Date(c.nextActionAt).getTime() < new Date(bounds.endIso).getTime();
}

/** Condición `or` de PostgREST equivalente a `isCaseForToday` (sin estado ni responsable). */
export function todayOrFilter(bounds: TodayBounds, activatedTodayIds: readonly string[]): string {
  const ids = [...new Set(activatedTodayIds.filter(isUuid))];
  const parts = [`next_action_at.lt.${bounds.endIso}`];
  if (ids.length > 0) parts.push(`id.in.(${ids.join(",")})`);
  return parts.join(",");
}

/** Límite inferior de `closed_at` según el periodo elegido (null = sin límite). */
export function closedSinceIso(period: ClosedPeriod, now: Date): string | null {
  if (period === "all") return null;
  return new Date(now.getTime() - Number(period) * 86_400_000).toISOString();
}

// ── Filas ──────────────────────────────────────────────────────────────────

/** Una fila lleva al chat del contacto en la bandeja o, sin conversación, a su ficha. */
export function caseRowHref(contactId: string, caseId: string, hasConversation: boolean): string {
  return hasConversation
    ? `/dashboard/inbox?contact=${encodeURIComponent(contactId)}&case=${encodeURIComponent(caseId)}`
    : `/dashboard/contacts/${encodeURIComponent(contactId)}`;
}

/** Tiempo esperando respuesta: "ahora", "12 min", "3 h", "2 d". Vacío si no espera. */
export function formatWaiting(since: string | null | undefined, now: Date): string {
  if (!since) return "";
  const ms = now.getTime() - new Date(since).getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "ahora";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** Texto del rango visible: "1–25 de 80". */
export function pageRangeLabel(page: number, pageSize: number, total: number): string {
  if (total === 0) return "0 de 0";
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return `${from}–${to} de ${total}`;
}

/** Patrón seguro para `ilike`: escapa %, _ y \. */
export function ilikePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}
