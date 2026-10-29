// Lógica pura de la tarjeta de gestión (case-card.tsx): estados del stepper
// de etapas, opciones de cierre por tipo y texto/opciones del próximo contacto.
// Todo en hora de Lima (UTC-5, sin horario de verano).

import { OUTCOME_LABELS } from "@/lib/cases/rules";
import { addDays, limaDateOf, limaDateTimeIso } from "@/lib/cases/dates";
import { formatSpan, solutionState, typeLockMessage, type SolutionCaseInput } from "@/lib/cases/protection";
import type { OutcomeKind, StageKind } from "@/lib/types/database";

interface StageLike {
  id: string;
  name: string;
  kind: StageKind;
  archived: boolean;
}

// ---------------------------------------------------------------- Etapas

export type StepState = "past" | "current" | "next";

export interface StageStep {
  id: string;
  name: string;
  state: StepState;
}

/**
 * Etapas abiertas del tipo, en orden, con su estado respecto a la actual:
 * las anteriores "past", la actual "current" y las siguientes "next". Una
 * etapa archivada solo se muestra si es la actual. Sin etapa actual, todas
 * quedan como "next".
 */
export function stageSteps(stages: readonly StageLike[], currentStageId: string | null): StageStep[] {
  const open = stages.filter((s) => s.kind === "open" && (!s.archived || s.id === currentStageId));
  const currentIndex = currentStageId ? open.findIndex((s) => s.id === currentStageId) : -1;
  return open.map((s, i) => ({
    id: s.id,
    name: s.name,
    state: currentIndex < 0 ? "next" : i < currentIndex ? "past" : i === currentIndex ? "current" : "next",
  }));
}

// ---------------------------------------------------------------- Cierre

export type CloseTone = "positive" | "negative";

export interface CloseOption {
  /** Etapa final elegida; null cuando el tipo no define etapas finales. */
  stageId: string | null;
  name: string;
  kind: OutcomeKind;
  tone: CloseTone;
}

const KIND_ORDER: StageKind[] = ["won", "resolved", "lost"];

/**
 * Salidas directas del menú "Cerrar": las etapas finales del tipo (ganadas y
 * resueltas primero, luego las perdidas). Sin tipo, solo se puede resolver.
 */
export function closeOptions(stages: readonly StageLike[] | null | undefined): CloseOption[] {
  const finals = (stages ?? []).filter((s) => s.kind !== "open" && !s.archived);
  if (finals.length === 0) return [{ stageId: null, name: "Resuelta", kind: "resolved", tone: "positive" }];
  const rank = (k: StageKind) => KIND_ORDER.indexOf(k);
  return finals
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.kind) - rank(b.s.kind) || a.i - b.i)
    .map(({ s }) => ({
      stageId: s.id,
      name: s.name,
      kind: s.kind as OutcomeKind,
      tone: s.kind === "lost" ? "negative" : "positive",
    }));
}

/**
 * Selección inicial del diálogo de cierre para una etapa final. La primera
 * etapa de cada resultado es la predeterminada del servidor, y se envía como
 * "" (sin etapa explícita); las demás, con su id.
 */
export function closeSelection(
  stages: readonly StageLike[] | null | undefined,
  stageId: string | null | undefined,
): { kind: OutcomeKind; stageId: string } | null {
  if (!stageId) return null;
  const finals = (stages ?? []).filter((s) => s.kind !== "open" && !s.archived);
  const stage = finals.find((s) => s.id === stageId);
  if (!stage) return null;
  const first = finals.find((s) => s.kind === stage.kind);
  return { kind: stage.kind as OutcomeKind, stageId: first?.id === stage.id ? "" : stage.id };
}

export interface CloseMenuItem {
  option: CloseOption;
  /** Texto del menú; agrega «(requiere aprobación)» cuando un asesor pide el cierre. */
  label: string;
  needsApproval: boolean;
  /** Por qué no se puede elegir ahora (null = disponible). */
  disabledReason: string | null;
}

/**
 * Entradas del menú «Cerrar» con el control de reclamos: en un tipo protegido,
 * cerrar como perdida (sin solución) pide la aprobación de un supervisor, y
 * mientras haya un pedido pendiente no se puede pedir otro.
 */
export function closeMenuItems(
  options: readonly CloseOption[],
  ctx: { isProtected: boolean; canSupervise: boolean; hasPendingRequest: boolean },
): CloseMenuItem[] {
  return options.map((option) => {
    const needsApproval = ctx.isProtected && !ctx.canSupervise && option.kind === "lost";
    return {
      option,
      needsApproval,
      label: needsApproval ? `${option.name} (requiere aprobación)` : option.name,
      disabledReason:
        needsApproval && ctx.hasPendingRequest ? "Ya hay un pedido de cierre esperando a un supervisor." : null,
    };
  });
}

/** Motivo por el que no se puede cambiar el tipo (tipo protegido y sin ser supervisor), o null. */
export function typeChangeLock(
  type: { name: string; protected: boolean } | null | undefined,
  canSupervise: boolean,
): string | null {
  return type?.protected && !canSupervise ? typeLockMessage(type.name) : null;
}

/** «Pedido de cierre «Sin solución» por Marco · motivo · nota». */
export function closeRequestLine(p: {
  stageName: string | null;
  requesterName: string;
  reasonName: string | null;
  note: string | null;
}): string {
  return ["Pedido de cierre «" + (p.stageName ?? "Sin solución") + "» por " + p.requesterName, p.reasonName, p.note]
    .filter((x): x is string => !!x)
    .join(" · ");
}

/**
 * Cabecera de una gestión cerrada. Usa el nombre de la etapa final ("Cerrada:
 * Sin solución") y no las palabras de venta ("perdida") que no valen para Postventa.
 */
export function closedHeadline(status: string, stageName: string | null): string {
  if (stageName) return `Cerrada: ${stageName}`;
  const label = OUTCOME_LABELS[status as keyof typeof OUTCOME_LABELS];
  return `Cerrada como ${label?.toLowerCase() ?? status}`;
}

/** Aviso al asesor cuando un supervisor rechazó cerrar su gestión. */
export function rejectionLine(comment: string | null): string {
  return comment
    ? `Un supervisor rechazó cerrar esta gestión: «${comment}». Sigue abierta.`
    : "Un supervisor rechazó cerrar esta gestión sin solución. Sigue abierta: hay que darle una solución.";
}

// -------------------------------------------- Plazo de la solución (reclamos)

export type SolutionTone = "amber" | "red" | "ok";

export interface SolutionBanner {
  tone: SolutionTone;
  text: string;
  /** Botón: registrar la solución (falta) o actualizarla (ya está en proceso). */
  action: "register" | "update";
  actionLabel: string;
}

/**
 * Línea de la tarjeta para un tipo con plazo de solución. Ámbar mientras hay
 * tiempo, roja cuando se pasó el plazo o venció el compromiso; verde cuando
 * hay una solución en proceso al día. Null si el tipo no pide solución o la
 * gestión no está abierta.
 */
export function solutionBanner(
  input: { typeName: string; deadlineHours: number | null; case: SolutionCaseInput },
  now: Date,
): SolutionBanner | null {
  const state = solutionState(input.case, input.deadlineHours, now);
  switch (state.kind) {
    case "none":
      return null;
    case "pending":
      return {
        tone: "amber",
        text: `${input.typeName}: registra la solución antes de ${relativeDayTime(new Date(state.dueAt), now)} (quedan ${formatSpan(state.msLeft, { round: "up" })})`,
        action: "register",
        actionLabel: "Registrar solución",
      };
    case "overdue":
      return {
        tone: "red",
        text: `Atrasada: debía registrarse la solución hace ${formatSpan(state.msLate)}`,
        action: "register",
        actionLabel: "Registrar solución",
      };
    case "in_progress": {
      const note = state.note?.trim() || "sin detalle";
      const when = state.commitmentAt ? relativeDayTime(new Date(state.commitmentAt), now) : null;
      return state.commitmentOverdue
        ? {
            tone: "red",
            text: `Compromiso vencido${when ? ` (${when})` : ""}: ${note}`,
            action: "update",
            actionLabel: "Actualizar",
          }
        : {
            tone: "ok",
            text: `Solución en proceso: ${note}${when ? ` · compromiso ${when}` : ""}`,
            action: "update",
            actionLabel: "Actualizar",
          };
    }
  }
}

export interface CommitmentOption {
  key: "today" | "tomorrow" | "in-two-days";
  label: string;
  /** Instante ISO (18:00 de Lima). */
  at: string;
  /** "hoy 18:00", "jue 18:00". */
  detail: string;
}

const COMMITMENT_HOUR = 18;

/** Fechas compromiso rápidas: hoy (si queda tiempo antes de las 18:00), mañana y en 2 días. */
export function commitmentOptions(now: Date): CommitmentOption[] {
  const today = limaDateOf(now);
  const make = (key: CommitmentOption["key"], label: string, days: number): CommitmentOption => {
    const at = limaDateTimeIso(addDays(today, days), COMMITMENT_HOUR);
    return { key, label, at, detail: relativeDayTime(new Date(at), now) };
  };
  const options: CommitmentOption[] = [];
  if (limaParts(now).hour < COMMITMENT_HOUR - 1) options.push(make("today", "Hoy", 0));
  options.push(make("tomorrow", "Mañana", 1), make("in-two-days", "En 2 días", 2));
  return options;
}

// ----------------------------------------------------- Próximo contacto

const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

function limaParts(at: Date) {
  const d = new Date(at.getTime() + LIMA_OFFSET_MS);
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
    year: d.getUTCFullYear(),
  };
}

function clock(at: Date): string {
  const p = limaParts(at);
  return `${p.hour}:${String(p.minute).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** "hoy 15:00", "mañana 9:00", "ayer 10:00", "lun 9:00", "28 oct 9:00" o "1 ene 2020 10:00" (con año si no es el actual). */
export function relativeDayTime(at: Date, now: Date): string {
  const diff = daysBetween(limaDateOf(now), limaDateOf(at));
  const p = limaParts(at);
  const time = clock(at);
  if (diff === 0) return `hoy ${time}`;
  if (diff === 1) return `mañana ${time}`;
  if (diff === -1) return `ayer ${time}`;
  if (diff > 1 && diff < 7) return `${WEEKDAYS[p.weekday]} ${time}`;
  const year = p.year !== limaParts(now).year ? ` ${p.year}` : "";
  return `${p.day} ${MONTHS[p.month]}${year} ${time}`;
}

export type NextContactTone = "none" | "ok" | "overdue";

export interface NextContactChip {
  label: string;
  tone: NextContactTone;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Texto del chip: "Programar", "Mañana 9:00" o "Atrasado: ayer 10:00". */
export function nextContactChip(nextActionAt: string | null, now: Date): NextContactChip {
  if (!nextActionAt) return { label: "Programar", tone: "none" };
  const at = new Date(nextActionAt);
  if (Number.isNaN(at.getTime())) return { label: "Programar", tone: "none" };
  if (at.getTime() < now.getTime()) return { label: `Atrasado: ${relativeDayTime(at, now)}`, tone: "overdue" };
  return { label: capitalize(relativeDayTime(at, now)), tone: "ok" };
}

export interface NextContactOption {
  key: "three-hours" | "tomorrow" | "monday";
  label: string;
  /** "18:45" o "mié 28 oct · 9:00". */
  detail: string;
  /** Instante ISO. */
  at: string;
  /** Texto para "Pospuesta hasta …". */
  when: string;
}

/** «Hoy en 3 h» solo se ofrece si cae el mismo día y en horario razonable (7:00 a 21:59, hora de Lima). */
const SOON_FIRST_HOUR = 7;
const SOON_LAST_HOUR = 21;

/** Opciones rápidas: hoy en 3 h (si cae hoy y de día), mañana 9:00 y el lunes 9:00 (si no es mañana). */
export function nextContactOptions(now: Date): NextContactOption[] {
  const today = limaDateOf(now);
  const options: NextContactOption[] = [];

  const soon = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const soonHour = limaParts(soon).hour;
  // Después de las 21:00 sumar 3 horas cae de madrugada del día siguiente: no se ofrece.
  if (limaDateOf(soon) === today && soonHour >= SOON_FIRST_HOUR && soonHour <= SOON_LAST_HOUR) {
    options.push({
      key: "three-hours",
      label: "Hoy en 3 h",
      detail: clock(soon),
      at: soon.toISOString(),
      when: `hoy a las ${clock(soon)}`,
    });
  }

  const morning = (date: string) => {
    const at = limaDateTimeIso(date, 9);
    const p = limaParts(new Date(at));
    return { at, detail: `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month]} · 9:00` };
  };
  options.push({ key: "tomorrow", label: "Mañana 9:00", ...morning(addDays(today, 1)), when: "mañana a las 9:00" });

  const weekday = limaParts(now).weekday;
  const toMonday = ((8 - weekday) % 7) || 7;
  if (toMonday !== 1) {
    options.push({ key: "monday", label: "El lunes 9:00", ...morning(addDays(today, toMonday)), when: "el lunes a las 9:00" });
  }
  return options;
}
