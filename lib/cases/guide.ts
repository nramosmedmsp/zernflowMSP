// Guía de la gestión (00037): qué hacer en cada etapa y a dónde se puede ir.
// Lógica pura (y una lectura de etapas) compartida por la tarjeta del chat, el
// servidor (orden estricto) y Configuración. Sin permisos: los valida quien llama.

import type { Db } from "./io";
import type { Json, StageKind, StageRequirement } from "@/lib/types/database";

export const STAGE_REQUIREMENTS: readonly StageRequirement[] = ["category", "solution", "note"];
export const STAGE_REQUIREMENT_LABELS: Record<StageRequirement, string> = {
  category: "Que elija la categoría",
  solution: "Que registre la solución",
  note: "Que deje una nota",
};
export const GUIDE_TEXT_MAX = 200;
export const STEP_LABEL_MAX = 60;
export const MAX_NEXT_STEPS = 6;

/** Ayuda que no cambia de etapa: fija el próximo contacto para mañana. */
export type StepAction = "remind_tomorrow";
export const STEP_ACTIONS: readonly StepAction[] = ["remind_tomorrow"];
export const STEP_ACTION_LABELS: Record<StepAction, string> = {
  remind_tomorrow: "Recordarle mañana (no cambia la etapa)",
};

export interface NextStep {
  /** Etapa a la que lleva (abierta o final). null cuando es una ayuda (`action`). */
  stageId: string | null;
  action: StepAction | null;
  /** Texto del botón; null = el nombre de la etapa. */
  label: string | null;
}

export interface GuideStage {
  id: string;
  name: string;
  kind: StageKind;
  archived: boolean;
  position?: number;
  guideText: string | null;
  /** Pasos configurados (vacío = predeterminado). */
  nextSteps: NextStep[];
  requires: StageRequirement | null;
}

// ---------------------------------------------------------------- Lectura / escritura

function isStepAction(value: unknown): value is StepAction {
  return typeof value === "string" && (STEP_ACTIONS as readonly string[]).includes(value);
}

/** Lee `next_steps` de la base; descarta en silencio lo que no tenga forma válida. */
export function parseNextSteps(value: unknown): NextStep[] {
  if (!Array.isArray(value)) return [];
  const out: NextStep[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : null;
    if (typeof o.stage_id === "string" && o.stage_id) out.push({ stageId: o.stage_id, action: null, label });
    else if (isStepAction(o.action)) out.push({ stageId: null, action: o.action, label });
  }
  return out;
}

/** Forma que se guarda en `case_stages.next_steps` (null si no hay pasos configurados). */
export function serializeNextSteps(steps: readonly NextStep[]): Json | null {
  if (steps.length === 0) return null;
  return steps.map((s) => ({
    ...(s.stageId ? { stage_id: s.stageId } : { action: s.action }),
    ...(s.label ? { label: s.label } : {}),
  })) as Json;
}

export function isStageRequirement(value: unknown): value is StageRequirement {
  return typeof value === "string" && (STAGE_REQUIREMENTS as readonly string[]).includes(value);
}

interface StageRowLike {
  id: string;
  name: string;
  kind: StageKind;
  position?: number;
  archived_at?: string | null;
  guide_text?: string | null;
  next_steps?: unknown;
  requires?: string | null;
}

export function toGuideStage(row: StageRowLike): GuideStage {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    archived: !!row.archived_at,
    position: row.position,
    guideText: row.guide_text?.trim() ? row.guide_text.trim() : null,
    nextSteps: parseNextSteps(row.next_steps),
    requires: isStageRequirement(row.requires) ? row.requires : null,
  };
}

/** Etapas del tipo, en orden, con su guía. `select *` tolera que falte la migración 00037. */
export async function loadGuideStages(db: Db, caseTypeId: string): Promise<GuideStage[]> {
  const { data } = await db
    .from("case_stages")
    .select("*")
    .eq("case_type_id", caseTypeId)
    .order("position", { ascending: true });
  return (data ?? []).map((r) => toGuideStage(r as StageRowLike));
}

// ---------------------------------------------------------------- Pasos siguientes

function sortedActive(stages: readonly GuideStage[]): GuideStage[] {
  return stages
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.archived)
    .sort((a, b) => (a.s.position ?? a.i) - (b.s.position ?? b.i) || a.i - b.i)
    .map(({ s }) => s);
}

/** Etapas abiertas activas, en orden. */
export function openStages(stages: readonly GuideStage[]): GuideStage[] {
  return sortedActive(stages).filter((s) => s.kind === "open");
}

const KIND_RANK: Record<StageKind, number> = { open: 0, won: 1, resolved: 2, lost: 3 };

/** Etapas finales activas: ganadas y resueltas primero, luego las perdidas. */
export function finalStages(stages: readonly GuideStage[]): GuideStage[] {
  return sortedActive(stages)
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.kind !== "open")
    .sort((a, b) => KIND_RANK[a.s.kind] - KIND_RANK[b.s.kind] || a.i - b.i)
    .map(({ s }) => s);
}

export type ExitTone = "primary" | "ghost" | "danger";

export interface GuideExit {
  /** "stage" pasa a otra etapa abierta; "close" cierra en una etapa final; "remind" fija el próximo contacto. */
  type: "stage" | "close" | "remind";
  stageId: string | null;
  stageKind: StageKind | null;
  label: string;
  tone: ExitTone;
}

/** Etapa siguiente en el orden, entre las abiertas (null si es la última o no hay actual). */
export function nextOpenStageId(stages: readonly GuideStage[], currentStageId: string | null): string | null {
  const open = openStages(stages);
  const i = currentStageId ? open.findIndex((s) => s.id === currentStageId) : -1;
  return i >= 0 && i < open.length - 1 ? open[i + 1].id : null;
}

/** Etapa abierta anterior ("Volver un paso"), o null si es la primera. */
export function previousOpenStageId(stages: readonly GuideStage[], currentStageId: string | null): string | null {
  const open = openStages(stages);
  const i = currentStageId ? open.findIndex((s) => s.id === currentStageId) : -1;
  return i > 0 ? open[i - 1].id : null;
}

/** Pasos que valen para la etapa actual: los configurados que siguen existiendo o, sin configuración, los predeterminados. */
export function effectiveSteps(stages: readonly GuideStage[], currentStageId: string | null): NextStep[] {
  const current = stages.find((s) => s.id === currentStageId);
  const active = new Map(sortedActive(stages).map((s) => [s.id, s]));
  const configured = (current?.nextSteps ?? []).filter(
    (st) => (st.stageId ? active.has(st.stageId) && st.stageId !== currentStageId : st.action !== null),
  );
  if (configured.length > 0) return configured;
  const next = nextOpenStageId(stages, currentStageId);
  return [
    ...(next ? [{ stageId: next, action: null, label: null } as NextStep] : []),
    ...finalStages(stages).map((s) => ({ stageId: s.id, action: null, label: null }) as NextStep),
  ];
}

/** Botones de la guía para la etapa actual, con su tono. */
export function resolveExits(stages: readonly GuideStage[], currentStageId: string | null): GuideExit[] {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const exits: GuideExit[] = [];
  for (const step of effectiveSteps(stages, currentStageId)) {
    if (step.stageId) {
      const stage = byId.get(step.stageId);
      if (!stage) continue;
      exits.push({
        type: stage.kind === "open" ? "stage" : "close",
        stageId: stage.id,
        stageKind: stage.kind,
        label: step.label ?? stage.name,
        tone: stage.kind === "lost" ? "danger" : "ghost",
      });
    } else if (step.action) {
      exits.push({
        type: "remind",
        stageId: null,
        stageKind: null,
        label: step.label ?? "Recordarle mañana",
        tone: "ghost",
      });
    }
  }
  // El primer botón que no es de cierre negativo ni una ayuda es el principal.
  const main = exits.findIndex((e) => e.tone === "ghost" && e.type !== "remind");
  if (main >= 0) exits[main] = { ...exits[main], tone: "primary" };
  return exits;
}

/** Ids de etapa a los que un asesor puede ir con el orden estricto: los pasos siguientes y volver un paso. */
export function allowedTargetIds(stages: readonly GuideStage[], currentStageId: string | null): Set<string> {
  const ids = new Set<string>();
  for (const st of effectiveSteps(stages, currentStageId)) if (st.stageId) ids.add(st.stageId);
  const back = previousOpenStageId(stages, currentStageId);
  if (back) ids.add(back);
  return ids;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} o ${names[names.length - 1]}`;
}

export function strictOrderMessage(stages: readonly GuideStage[], currentStageId: string | null): string {
  const current = stages.find((s) => s.id === currentStageId);
  const names = [...allowedTargetIds(stages, currentStageId)]
    .map((id) => stages.find((s) => s.id === id)?.name)
    .filter((n): n is string => !!n);
  const back = previousOpenStageId(stages, currentStageId);
  const where = current ? `desde «${current.name}» ` : "";
  return names.length > 0
    ? `Orden estricto: ${where}solo puedes pasar a ${joinNames(names)}${back ? " (o volver un paso)" : ""}. Pídele a un supervisor que la mueva si hace falta.`
    : "Orden estricto: esta gestión no tiene pasos siguientes. Pídele a un supervisor que la mueva.";
}

/**
 * Orden estricto: null si el movimiento está permitido; si no, el mensaje.
 * Solo aplica a quien actúa desde la interfaz sin ser supervisor ni
 * administrador; la automatización (flujos, reglas, cron) nunca pasa por aquí.
 */
export function checkStrictOrder(input: {
  strict: boolean;
  canSupervise: boolean;
  stages: readonly GuideStage[];
  currentStageId: string | null;
  targetStageId: string;
}): string | null {
  if (!input.strict || input.canSupervise) return null;
  // Sin etapa actual (gestión sin clasificar a medias) no hay recorrido que respetar.
  if (!input.currentStageId || input.targetStageId === input.currentStageId) return null;
  return allowedTargetIds(input.stages, input.currentStageId).has(input.targetStageId)
    ? null
    : strictOrderMessage(input.stages, input.currentStageId);
}

export const REQUIRES_CATEGORY_MESSAGE = "Elige la categoría antes de pasar a la siguiente etapa.";

/** La etapa actual pide categoría y la gestión no la tiene (no aplica al volver un paso ni a supervisores). */
export function checkRequirements(input: {
  canSupervise: boolean;
  stages: readonly GuideStage[];
  currentStageId: string | null;
  targetStageId: string;
  categoryId: string | null;
  /** El tipo tiene alguna categoría activa para elegir (si no, no hay nada que pedir). */
  hasCategories: boolean;
}): string | null {
  if (input.canSupervise || !input.hasCategories) return null;
  const current = input.stages.find((s) => s.id === input.currentStageId);
  if (current?.requires !== "category" || input.categoryId) return null;
  if (input.targetStageId === previousOpenStageId(input.stages, input.currentStageId)) return null;
  return REQUIRES_CATEGORY_MESSAGE;
}

// ---------------------------------------------------------------- Validación de la configuración

export function cleanGuideText(value: unknown): string | null | { error: string } {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return { error: "El texto de la guía no es válido." };
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > GUIDE_TEXT_MAX) return { error: `El texto de la guía admite hasta ${GUIDE_TEXT_MAX} caracteres.` };
  return text || null;
}

/**
 * Valida los pasos siguientes de una etapa: cada destino debe ser otra etapa
 * activa del MISMO tipo (`stages` son las etapas de ese tipo), sin repetir, con
 * etiquetas cortas. Devuelve los pasos limpios.
 */
export function validateNextSteps(input: {
  stageId: string;
  steps: unknown;
  stages: readonly Pick<GuideStage, "id" | "kind" | "archived">[];
}): { ok: true; steps: NextStep[] } | { error: string } {
  if (input.steps === null || input.steps === undefined) return { ok: true, steps: [] };
  if (!Array.isArray(input.steps)) return { error: "Los pasos siguientes no son válidos." };
  if (input.steps.length > MAX_NEXT_STEPS) return { error: `Un paso admite hasta ${MAX_NEXT_STEPS} salidas.` };
  const byId = new Map(input.stages.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const steps: NextStep[] = [];
  for (const raw of input.steps) {
    if (!raw || typeof raw !== "object") return { error: "Los pasos siguientes no son válidos." };
    const o = raw as { stageId?: unknown; action?: unknown; label?: unknown };
    if (o.label !== undefined && o.label !== null && typeof o.label !== "string") {
      return { error: "El texto del botón no es válido." };
    }
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : null;
    if (label && label.length > STEP_LABEL_MAX) {
      return { error: `El texto del botón admite hasta ${STEP_LABEL_MAX} caracteres.` };
    }
    if (typeof o.stageId === "string" && o.stageId) {
      if (o.stageId === input.stageId) return { error: "Una etapa no puede llevar a sí misma." };
      const target = byId.get(o.stageId);
      if (!target || target.archived) return { error: "Un paso siguiente apunta a una etapa que no es de este tipo." };
      if (seen.has(o.stageId)) return { error: "Un paso siguiente está repetido." };
      seen.add(o.stageId);
      steps.push({ stageId: o.stageId, action: null, label });
    } else if (isStepAction(o.action)) {
      if (seen.has(o.action)) return { error: "Un paso siguiente está repetido." };
      seen.add(o.action);
      steps.push({ stageId: null, action: o.action, label });
    } else {
      return { error: "Cada paso siguiente necesita una etapa o una ayuda." };
    }
  }
  return { ok: true, steps };
}

// ---------------------------------------------------------------- Consecuencias del cierre

export interface ConsequenceLine {
  tone: "ok" | "warn";
  text: string;
}

/**
 * Lo que pasará al cerrar, para mostrarlo antes de confirmar: el resultado, el
 * cambio de tipo de contacto, las gestiones programadas y lo que falta pedir.
 * `preview` es la vista previa del servidor (previewCloseCase).
 */
export function closeConsequences(input: {
  outcomeName: string;
  needsApproval: boolean;
  preview: {
    contactType: { from: string | null; to: string } | null;
    schedules: { caseTypeName: string | null; scheduledFor: string | null }[];
    blocked: { caseTypeName: string | null }[];
    askKeyDate: { label: string } | null;
  } | null;
  skipSchedule: boolean;
  contactTypeName: (id: string | null) => string | null;
  formatDate: (iso: string) => string;
  missing: readonly string[];
}): ConsequenceLine[] {
  const lines: ConsequenceLine[] = [];
  lines.push(
    input.needsApproval
      ? { tone: "warn", text: `Se pedirá a un supervisor cerrar como «${input.outcomeName}»; mientras tanto sigue abierta` }
      : { tone: "ok", text: `Se cerrará como «${input.outcomeName}»` },
  );
  const p = input.preview;
  if (p?.contactType) {
    const to = input.contactTypeName(p.contactType.to);
    if (to) lines.push({ tone: "ok", text: `El contacto pasará a «${to}»` });
  }
  if (p && !input.skipSchedule) {
    for (const s of p.schedules) {
      lines.push({
        tone: s.scheduledFor ? "ok" : "warn",
        text: s.scheduledFor
          ? `Se programará ${s.caseTypeName ?? "una gestión"} para el ${input.formatDate(s.scheduledFor)}`
          : `Se programará ${s.caseTypeName ?? "una gestión"}, pero falta la fecha clave`,
      });
    }
  }
  if (p) {
    for (const b of p.blocked) {
      lines.push({
        tone: "warn",
        text: `No se programará ${b.caseTypeName ?? "la gestión siguiente"}: ese tipo está archivado`,
      });
    }
  }
  for (const m of input.missing) lines.push({ tone: "warn", text: `Falta: ${m}` });
  return lines;
}
