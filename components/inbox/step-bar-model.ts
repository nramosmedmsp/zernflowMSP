// Lógica pura de la barra de pasos y de los botones de la tarjeta de gestión
// (case-guide.tsx / step-bar.tsx): estado y candado de cada paso, reparto del
// ancho de la barra en una línea, textos de la confirmación, de lo que falta
// para avanzar y de los botones de salida. Sin React ni E/S.

import { allowedTargetIds, type GuideExit, type GuideStage } from "@/lib/cases/guide";
import type { StageKind, StageRequirement } from "@/lib/types/database";
import { stageSteps, type StepState } from "./case-card-model";

/** Explicación del candado (orden estricto del tipo, para un asesor). */
export const STRICT_LOCK_MESSAGE = "Orden estricto: pídele a un supervisor";

// ---------------------------------------------------------------- Pasos de la barra

export interface BarStep {
  id: string;
  name: string;
  /** Posición (1 = primer paso). */
  number: number;
  state: StepState;
  /** Con el orden estricto, un asesor no puede ir a este paso. */
  locked: boolean;
  /** Pasos entre la etapa actual y este (negativo = atrás). 0 en el actual. */
  delta: number;
  /** Un supervisor llega aquí fuera de los pasos de la guía: queda como salto en el historial. */
  isJump: boolean;
}

interface BarStageLike {
  id: string;
  name: string;
  kind: StageKind;
  archived: boolean;
  guideText: string | null;
  nextSteps: GuideStage["nextSteps"];
  requires: StageRequirement | null;
}

/**
 * Pasos de la barra con su estado, candado y distancia a la etapa actual.
 * `locked` solo con el orden estricto y sin ser supervisor: se puede ir a los
 * pasos siguientes configurados y volver un paso (allowedTargetIds); el resto
 * lleva candado. Sin etapa actual (gestión a medias) no hay candados.
 */
export function stepBarSteps(
  stages: readonly BarStageLike[],
  currentStageId: string | null,
  ctx: { strictOrder: boolean; canSupervise: boolean },
): BarStep[] {
  const steps = stageSteps(stages, currentStageId);
  const currentIndex = steps.findIndex((s) => s.state === "current");
  const allowed = allowedTargetIds(stages as readonly GuideStage[], currentStageId);
  return steps.map((s, i) => ({
    id: s.id,
    name: s.name,
    number: i + 1,
    state: s.state,
    locked: ctx.strictOrder && !ctx.canSupervise && currentIndex >= 0 && s.state !== "current" && !allowed.has(s.id),
    delta: currentIndex < 0 ? i + 1 : i - currentIndex,
    isJump: ctx.canSupervise && currentIndex >= 0 && s.state !== "current" && !allowed.has(s.id),
  }));
}

/** «Paso 4 de 4», o null si la gestión aún no tiene paso. */
export function stepHeader(steps: readonly BarStep[]): string | null {
  const i = steps.findIndex((s) => s.state === "current");
  return i < 0 ? null : `Paso ${i + 1} de ${steps.length}`;
}

/** Lo que dice la barra a la derecha del encabezado. */
export function stepHint(input: { canEdit: boolean; strictLocked: boolean; canSupervise: boolean; strictOrder: boolean }): string {
  if (!input.canEdit) return "Solo quien tiene la gestión puede moverla";
  if (input.canSupervise && input.strictOrder) return "Supervisor: puedes saltar a cualquier paso";
  if (input.strictLocked) return "Orden estricto";
  return "Toca un paso para moverte";
}

// ---------------------------------------------------------------- Reparto del ancho

export type StepMode = "check" | "name" | "number";

/** Anchos medidos de un paso en cada forma (px). */
export interface StepWidths {
  state: StepState;
  check: number;
  number: number;
  name: number;
}

export interface BarLayout {
  /** Los pasos hechos se pliegan en un solo «✓ N hechos». */
  folded: boolean;
  /** Forma de cada paso (los hechos plegados no se dibujan). */
  modes: StepMode[];
}

/**
 * Reparte el ancho de la barra para que quepa en UNA línea. Reglas:
 *  - hechos como ✓; el actual y el SIGUIENTE siempre con nombre;
 *  - los demás siguientes con nombre si caben (los más cercanos primero) y, si
 *    no, solo el número;
 *  - si aun así no cabe, los hechos se pliegan en «✓ N hechos».
 * `foldWidth` es el ancho de ese botón plegado.
 */
export function layoutStepBar(input: {
  steps: readonly StepWidths[];
  available: number;
  gap: number;
  foldWidth: number;
}): BarLayout {
  const { steps, available, gap, foldWidth } = input;
  const currentIndex = steps.findIndex((s) => s.state === "current");
  const firstNext = steps.findIndex((s) => s.state === "next");
  const modes: StepMode[] = steps.map((s, i) =>
    s.state === "past" ? "check" : s.state === "current" ? "name" : i === firstNext ? "name" : "number",
  );
  const widthOf = (s: StepWidths, m: StepMode) => (m === "check" ? s.check : m === "name" ? s.name : s.number);

  const pastCount = steps.filter((s) => s.state === "past").length;
  const total = (folded: boolean) => {
    const widths: number[] = [];
    if (folded && pastCount > 0) widths.push(foldWidth);
    steps.forEach((s, i) => {
      if (folded && s.state === "past") return;
      widths.push(widthOf(s, modes[i]));
    });
    return widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1);
  };

  let folded = false;
  if (currentIndex >= 0 && pastCount > 1 && total(false) > available && total(true) < total(false)) folded = true;

  // Con lo que sobra, los siguientes pasan de número a nombre, del más cercano al más lejano.
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].state !== "next" || modes[i] !== "number") continue;
    modes[i] = "name";
    if (total(folded) > available) modes[i] = "number";
  }
  return { folded, modes };
}

// ---------------------------------------------------------------- Confirmar un movimiento

export interface MoveConfirmation {
  question: string;
  detail: string;
}

/** «¿Mover a Asesorando?» · «Vuelves 2 pasos» / «Avanzas 3 pasos» (+ «queda en el historial» si es un salto). */
export function moveConfirmation(target: Pick<BarStep, "name" | "delta" | "isJump">): MoveConfirmation {
  const n = Math.abs(target.delta);
  const pasos = n === 1 ? "paso" : "pasos";
  const base = target.delta < 0 ? `Vuelves ${n} ${pasos}` : `Avanzas ${n} ${pasos}`;
  return { question: `¿Mover a ${target.name}?`, detail: target.isJump ? `${base} · queda en el historial` : base };
}

// ---------------------------------------------------------------- Lo que falta para avanzar

export interface RequirementState {
  kind: StageRequirement;
  /** Casilla de «Para avanzar». */
  label: string;
  /** «Antes de ir a X: elige la categoría». */
  blocker: string;
  /** Bajo el botón apagado: «primero elige la categoría». */
  hint: string;
  done: boolean;
  /** Impide avanzar (los supervisores quedan exentos). */
  blocking: boolean;
}

const REQUIREMENT_TEXT: Record<StageRequirement, { label: string; blocker: string }> = {
  category: { label: "Elige la categoría", blocker: "elige la categoría" },
  note: { label: "Deja una nota", blocker: "deja una nota" },
  solution: { label: "Registra la solución", blocker: "registra la solución" },
};

/**
 * Lo que pide la etapa actual y si ya está hecho. Null si no pide nada (o pide
 * categoría y el tipo no tiene ninguna para elegir).
 */
export function requirementState(input: {
  requires: StageRequirement | null;
  hasCategory: boolean;
  hasCategories: boolean;
  noteDone: boolean;
  solutionDone: boolean;
  canSupervise: boolean;
}): RequirementState | null {
  const { requires } = input;
  if (!requires) return null;
  if (requires === "category" && !input.hasCategories) return null;
  const done = requires === "category" ? input.hasCategory : requires === "note" ? input.noteDone : input.solutionDone;
  const text = REQUIREMENT_TEXT[requires];
  return {
    kind: requires,
    label: text.label,
    blocker: text.blocker,
    hint: `primero ${text.blocker}`,
    done,
    blocking: !done && !input.canSupervise,
  };
}

/** «Antes de ir a Esperando pago: elige la categoría». */
export function blockedMoveText(targetName: string, req: Pick<RequirementState, "blocker">): string {
  return `Antes de ir a ${targetName}: ${req.blocker}`;
}

// ---------------------------------------------------------------- Botones de salida

export type ExitKind = "primary" | "secondary" | "help" | "danger";

export interface ExitView {
  exit: GuideExit;
  kind: ExitKind;
  /** Acción del botón. */
  title: string;
  /** Letra pequeña: a dónde lleva (null = nada). */
  sub: string | null;
  /** Vuelve a un paso anterior. */
  back: boolean;
}

/**
 * Texto de cada botón de salida: la acción y, en letra pequeña, a dónde lleva
 * («pasa a Asesorando», «cierra como Pagado», «va al paso 2 de 4»). Si la
 * empresa no escribió la etiqueta, el botón dice «Pasar a …», «Volver a …» o
 * «Cerrar como …». Las ayudas (recordar mañana) no cambian el paso.
 */
export function exitViews(
  exits: readonly GuideExit[],
  steps: readonly BarStep[],
  stageNames: ReadonlyMap<string, string>,
): ExitView[] {
  const current = steps.find((s) => s.state === "current");
  return exits.map((exit): ExitView => {
    if (exit.type === "remind") {
      return { exit, kind: "help", title: exit.label, sub: "no cambia el paso", back: false };
    }
    const stageName = (exit.stageId && stageNames.get(exit.stageId)) || exit.label;
    if (exit.type === "close") {
      if (exit.tone === "danger") return { exit, kind: "danger", title: exit.label, sub: null, back: false };
      return {
        exit,
        kind: exit.tone === "primary" ? "primary" : "secondary",
        title: exit.customLabel ? exit.label : `Cerrar como ${stageName}`,
        sub: exit.customLabel ? `cierra como ${stageName}` : "cierra la gestión",
        back: false,
      };
    }
    const target = steps.find((s) => s.id === exit.stageId);
    const back = !!target && !!current && target.number < current.number;
    const where = target ? `paso ${target.number} de ${steps.length}` : null;
    return {
      exit,
      kind: exit.tone === "primary" ? "primary" : "secondary",
      title: exit.customLabel ? exit.label : `${back ? "Volver a" : "Pasar a"} ${stageName}`,
      sub: exit.customLabel ? `${back ? "vuelve a" : "pasa a"} ${stageName}` : where ? `${back ? "vuelve al" : "va al"} ${where}` : null,
      back,
    };
  });
}

/** Salida con la que se abre el cierre: el botón «Pagó» lleva a la misma pantalla que «Cerrar». */
export function isClosingExit(exit: GuideExit): boolean {
  return exit.type === "close";
}
