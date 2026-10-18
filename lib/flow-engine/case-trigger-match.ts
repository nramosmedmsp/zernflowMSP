// Coincidencia de disparadores por eventos de gestión y protección contra
// bucles (docs/FASE-2-TECNICO.md 3.6 y 4). Todo puro: lo usan case-triggers.ts
// (servidor) y las pruebas.

import type { OutcomeKind } from "@/lib/types/database";

export type CaseFlowEventType = "case_stage_changed" | "case_closed" | "client_no_reply";

/** Umbral de client_no_reply cuando el disparador no indica `minutes`. */
export const DEFAULT_NO_REPLY_MINUTES = 60;

export const CASE_TRIGGER_TYPES: readonly CaseFlowEventType[] = [
  "case_stage_changed",
  "case_closed",
  "client_no_reply",
];

export function isCaseTriggerType(type: string | null | undefined): type is CaseFlowEventType {
  return !!type && (CASE_TRIGGER_TYPES as readonly string[]).includes(type);
}

/** Lo que un disparador necesita saber del evento. */
export interface CaseEventLike {
  type: CaseFlowEventType;
  caseTypeId: string | null;
  stageId: string | null;
  outcome?: OutcomeKind;
}

export interface TriggerLike {
  type: string;
  config: unknown;
}

function configObject(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
}

function idOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Minutos del disparador client_no_reply (entero positivo, o el valor por defecto). */
export function triggerMinutes(config: unknown): number {
  const raw = configObject(config).minutes;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : DEFAULT_NO_REPLY_MINUTES;
}

/**
 * ¿La configuración del disparador coincide con el evento? Todas las claves
 * son opcionales: sin ellas aplica a cualquier tipo, etapa o resultado.
 * `stampedMinutes` es `cases.no_reply_event_minutes` (solo client_no_reply):
 * se ejecutan únicamente los disparadores con ese mismo `minutes`.
 */
export function matchesCaseEvent(
  trigger: TriggerLike,
  event: CaseEventLike,
  stampedMinutes?: number | null,
): boolean {
  if (trigger.type !== event.type) return false;
  const config = configObject(trigger.config);

  const typeId = idOf(config.case_type_id);
  if (typeId && typeId !== event.caseTypeId) return false;

  if (event.type === "case_stage_changed") {
    const stageId = idOf(config.stage_id);
    if (stageId && stageId !== event.stageId) return false;
    return true;
  }

  if (event.type === "case_closed") {
    const outcome = idOf(config.outcome);
    if (outcome && outcome !== event.outcome) return false;
    return true;
  }

  // client_no_reply
  if (stampedMinutes === null || stampedMinutes === undefined) return false;
  return triggerMinutes(config) === stampedMinutes;
}

// ── Protección contra bucles ────────────────────────────────────────────────
// Un flujo disparado por un evento puede cambiar la etapa o cerrar la gestión,
// lo que emite otro evento. La "cadena" son los ids de los flujos que ya
// corrieron en esa sucesión: un flujo no vuelve a correr dentro de su propia
// cadena y la cadena tiene un largo máximo.

export const MAX_CASE_FLOW_CHAIN = 3;

/** Variable de la sesión donde viaja la cadena (sobrevive a esperas y reanudaciones). */
export const FLOW_CHAIN_VARIABLE = "__flow_chain";
/** Variable de la sesión con el tipo de evento que disparó el flujo. */
export const CASE_EVENT_VARIABLE = "__case_event";
/** Variable de la sesión con la gestión del evento. */
export const CASE_ID_VARIABLE = "case_id";

export function parseFlowChain(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function serializeFlowChain(chain: readonly string[]): string {
  return chain.join(",");
}

/** ¿Puede correr este flujo dado lo que ya corrió en la cadena? */
export function canRunInChain(chain: readonly string[] | undefined, flowId: string): boolean {
  const current = chain ?? [];
  if (current.length >= MAX_CASE_FLOW_CHAIN) return false;
  return !current.includes(flowId);
}

/** Cadena para los eventos que provoque un flujo (sin repetir ids). */
export function extendFlowChain(chain: readonly string[] | undefined, flowId: string): string[] {
  const current = chain ?? [];
  return current.includes(flowId) ? [...current] : [...current, flowId];
}

export interface MatchableTrigger extends TriggerLike {
  flow_id: string;
}

/**
 * Disparadores que deben ejecutarse para el evento: coinciden por
 * configuración, su flujo no está en la cadena y hay un solo disparador por
 * flujo (el primero de la lista, que se asume ordenada por prioridad).
 */
export function selectCaseTriggers<T extends MatchableTrigger>(
  triggers: readonly T[],
  event: CaseEventLike & { chain?: readonly string[] },
  stampedMinutes?: number | null,
): T[] {
  const seen = new Set<string>();
  const selected: T[] = [];
  for (const trigger of triggers) {
    if (seen.has(trigger.flow_id)) continue;
    if (!canRunInChain(event.chain, trigger.flow_id)) continue;
    if (!matchesCaseEvent(trigger, event, stampedMinutes)) continue;
    seen.add(trigger.flow_id);
    selected.push(trigger);
  }
  return selected;
}
