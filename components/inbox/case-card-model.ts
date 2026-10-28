// Lógica pura de la tarjeta de gestión (case-card.tsx): estados del stepper
// de etapas, opciones de cierre por tipo y texto/opciones del próximo contacto.
// Todo en hora de Lima (UTC-5, sin horario de verano).

import { addDays, limaDateOf, limaDateTimeIso } from "@/lib/cases/dates";
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

// ----------------------------------------------------- Próximo contacto

const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

function limaParts(at: Date) {
  const d = new Date(at.getTime() + LIMA_OFFSET_MS);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() };
}

function clock(at: Date): string {
  const p = limaParts(at);
  return `${p.hour}:${String(p.minute).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** "hoy 15:00", "mañana 9:00", "ayer 10:00", "lun 9:00" o "28 oct 9:00". */
export function relativeDayTime(at: Date, now: Date): string {
  const diff = daysBetween(limaDateOf(now), limaDateOf(at));
  const p = limaParts(at);
  const time = clock(at);
  if (diff === 0) return `hoy ${time}`;
  if (diff === 1) return `mañana ${time}`;
  if (diff === -1) return `ayer ${time}`;
  if (diff > 1 && diff < 7) return `${WEEKDAYS[p.weekday]} ${time}`;
  return `${p.day} ${MONTHS[p.month]} ${time}`;
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

/** Opciones rápidas: hoy en 3 h, mañana 9:00 y el lunes 9:00 (si no es mañana). */
export function nextContactOptions(now: Date): NextContactOption[] {
  const today = limaDateOf(now);
  const options: NextContactOption[] = [];

  const soon = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  options.push({
    key: "three-hours",
    label: "Hoy en 3 h",
    detail: clock(soon),
    at: soon.toISOString(),
    when: `hoy a las ${clock(soon)}`,
  });

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
