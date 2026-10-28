// Control de reclamos, parte pura (sin E/S): quién es supervisor de una
// gestión, el plazo para registrar la solución, el pedido de cierre y la
// ventana de reapertura. La E/S vive en protected.ts, close.ts, inbound.ts y
// cron.ts; la tarjeta de la bandeja usa estas mismas funciones.

import { isAdminRole } from "@/lib/permissions";
import type { Json, OutcomeKind } from "@/lib/types/database";
import { supervisedTeamIds, type ActorInfo } from "./access";
import { REOPEN_WINDOW_MS } from "./dates";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// ── Quién es supervisor ────────────────────────────────────────────────────

/**
 * ¿Actúa como supervisor de la gestión? Un administrador o dueño siempre; los
 * demás, solo si son supervisores del equipo de la gestión (`cases.team_id`).
 * Una gestión sin equipo solo la supervisan los administradores.
 */
export function isCaseSupervisor(actor: Pick<ActorInfo, "role" | "memberships">, teamId: string | null): boolean {
  if (isAdminRole(actor.role)) return true;
  return teamId !== null && supervisedTeamIds(actor).has(teamId);
}

export function typeLockMessage(typeName: string): string {
  return `Solo el supervisor puede cambiar el tipo de una ${typeName}.`;
}

// ── Plazo para registrar la solución ───────────────────────────────────────

export interface SolutionCaseInput {
  status: string;
  openedAt: string | null;
  /** Desde cuándo corre el plazo (null = openedAt); la reapertura lo reinicia. */
  solutionClockAt?: string | null;
  solutionStatus: string | null;
  solutionNote: string | null;
  /** La fecha compromiso de la solución en proceso. */
  nextActionAt: string | null;
}

/** Momento en que vence el plazo para registrar la solución, o null si no corre. */
export function solutionDueAt(
  c: Pick<SolutionCaseInput, "openedAt" | "solutionClockAt">,
  deadlineHours: number | null | undefined,
): Date | null {
  if (!deadlineHours || deadlineHours <= 0) return null;
  const since = c.solutionClockAt ?? c.openedAt;
  if (!since) return null;
  const start = new Date(since).getTime();
  if (Number.isNaN(start)) return null;
  return new Date(start + deadlineHours * HOUR_MS);
}

export type SolutionState =
  /** El tipo no tiene plazo o la gestión no está abierta. */
  | { kind: "none" }
  /** Falta registrar la solución; todavía hay tiempo. */
  | { kind: "pending"; dueAt: string; msLeft: number }
  /** Pasó el plazo sin registrar la solución. */
  | { kind: "overdue"; dueAt: string; msLate: number }
  /** Hay una solución en proceso; `commitmentOverdue` si la fecha compromiso ya pasó. */
  | {
      kind: "in_progress";
      note: string | null;
      commitmentAt: string | null;
      commitmentOverdue: boolean;
      msLate: number;
    };

export function solutionState(
  c: SolutionCaseInput,
  deadlineHours: number | null | undefined,
  now: Date,
): SolutionState {
  if (c.status !== "open") return { kind: "none" };
  if (c.solutionStatus === "in_progress") {
    const commitment = c.nextActionAt ? new Date(c.nextActionAt).getTime() : NaN;
    const late = Number.isNaN(commitment) ? 0 : now.getTime() - commitment;
    return {
      kind: "in_progress",
      note: c.solutionNote,
      commitmentAt: Number.isNaN(commitment) ? null : new Date(commitment).toISOString(),
      commitmentOverdue: late > 0,
      msLate: Math.max(0, late),
    };
  }
  const due = solutionDueAt(c, deadlineHours);
  if (!due) return { kind: "none" };
  const left = due.getTime() - now.getTime();
  return left > 0
    ? { kind: "pending", dueAt: due.toISOString(), msLeft: left }
    : { kind: "overdue", dueAt: due.toISOString(), msLate: -left };
}

export type ClaimBadge = { kind: "late"; label: string } | { kind: "commitment"; label: string } | { kind: "approval"; label: string };

/** Marca para la lista de Gestiones: sin solución a tiempo, compromiso vencido o cierre por aprobar. */
export function claimBadge(
  c: SolutionCaseInput & { hasCloseRequest?: boolean },
  deadlineHours: number | null | undefined,
  now: Date,
): ClaimBadge | null {
  if (c.status !== "open") return null;
  if (c.hasCloseRequest) return { kind: "approval", label: "Cierre por aprobar" };
  const state = solutionState(c, deadlineHours, now);
  if (state.kind === "overdue") return { kind: "late", label: "Sin solución a tiempo" };
  if (state.kind === "in_progress" && state.commitmentOverdue) return { kind: "commitment", label: "Compromiso vencido" };
  return null;
}

/**
 * "40 min", "2 h 30 min", "5 h", "3 días". Con `round: "up"` (lo que queda)
 * redondea hacia arriba: 4 h 59 min se lee "5 h", no "4 h".
 */
export function formatSpan(ms: number, options: { round?: "down" | "up" } = {}): string {
  const total = Math.max(0, ms);
  const minutes = options.round === "up" ? Math.ceil(total / 60_000) : Math.floor(total / 60_000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 180) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const hours = options.round === "up" ? Math.ceil(minutes / 60) : Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 día" : `${days} días`;
}

// ── Cierre de una gestión protegida ────────────────────────────────────────

export type CloseGate = { action: "close" } | { action: "request" } | { error: string };

/**
 * Qué pasa cuando alguien cierra una gestión de un tipo protegido:
 * - ganada o resuelta: se cierra, pero la nota ("qué se hizo") es obligatoria;
 * - perdida ("sin solución"): el supervisor la cierra directo; un asesor deja
 *   un pedido que el supervisor aprueba o rechaza (uno a la vez);
 * - tipo no protegido: se cierra como siempre.
 */
export function closeGate(params: {
  isProtected: boolean;
  typeName: string;
  kind: OutcomeKind;
  isSupervisor: boolean;
  note: string | null | undefined;
  hasPendingRequest: boolean;
}): CloseGate {
  if (!params.isProtected) return { action: "close" };
  if (params.kind !== "lost") {
    if (!params.note || params.note.trim() === "") {
      return { error: `Cuenta qué se hizo antes de cerrar la ${params.typeName}.` };
    }
    return { action: "close" };
  }
  if (params.isSupervisor) return { action: "close" };
  if (params.hasPendingRequest) return { error: "Ya hay un pedido de cierre esperando la respuesta de un supervisor." };
  return { action: "request" };
}

/** Pedido de cierre guardado en `cases.close_request`. */
export interface CloseRequest {
  stageId: string | null;
  reasonId: string | null;
  note: string | null;
  categoryId: string | null;
  requestedBy: string;
  requestedAt: string;
}

export function closeRequestToJson(r: CloseRequest): Json {
  return {
    stage_id: r.stageId,
    reason_id: r.reasonId,
    note: r.note,
    category_id: r.categoryId,
    requested_by: r.requestedBy,
    requested_at: r.requestedAt,
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Lee `close_request` de la base; null si no hay un pedido válido. */
export function parseCloseRequest(value: unknown): CloseRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const requestedBy = text(v.requested_by);
  const requestedAt = text(v.requested_at);
  if (!requestedBy || !requestedAt) return null;
  return {
    stageId: text(v.stage_id),
    reasonId: text(v.reason_id),
    note: text(v.note),
    categoryId: text(v.category_id),
    requestedBy,
    requestedAt,
  };
}

// ── Reapertura ─────────────────────────────────────────────────────────────

/** Ventana en que un mensaje del cliente reabre la gestión cerrada: la del tipo o 24 h. */
export function reopenWindowMs(reopenWindowDays: number | null | undefined): number {
  return reopenWindowDays && reopenWindowDays > 0 ? reopenWindowDays * DAY_MS : REOPEN_WINDOW_MS;
}

// ── Reclamo detectado sin gestión protegida ────────────────────────────────

/** Qué se sabe de las gestiones de tipo protegido del contacto. */
export interface ProtectedCaseSummary {
  status: string;
  createdAt: string;
  closedAt: string | null;
}

/**
 * ¿Sigue pendiente de atender el reclamo detectado? Deja de estarlo cuando hay
 * una gestión protegida abierta, o una que se abrió o cerró después de la marca
 * (ya se atendió; un cierre posterior no debe volver a mostrar el aviso).
 */
export function complaintStillPending(
  flaggedAt: string | null | undefined,
  protectedCases: readonly ProtectedCaseSummary[],
): boolean {
  if (!flaggedAt) return false;
  const flagged = new Date(flaggedAt).getTime();
  if (Number.isNaN(flagged)) return false;
  return !protectedCases.some((c) => {
    if (c.status === "open" || c.status === "scheduled") return true;
    const created = new Date(c.createdAt).getTime();
    const closed = c.closedAt ? new Date(c.closedAt).getTime() : NaN;
    return created >= flagged || closed >= flagged;
  });
}

/** Días que hay que esperar antes de volver a marcar una conversación descartada. */
export const COMPLAINT_DISMISS_DAYS = 7;
/** Minutos sin atender antes de avisar a los supervisores. */
export const COMPLAINT_ALERT_MINUTES = 30;
