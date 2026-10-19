// Validación de un escenario que llega de fuera (la base, el navegador, una
// importación): devuelve un escenario limpio o el motivo en español.

import type { BusinessTemplate, OutcomeKind } from "@/lib/types/database";
import { LAB_CHANNELS, type LabChannel } from "../types";
import {
  EXPECTED_STATUSES,
  SCENARIO_VERSION,
  type ExpectationCheck,
  type ExpectationResult,
  type ExpectationScope,
  type ScenarioDefinition,
  type ScenarioExpectation,
  type ScenarioProfile,
  type ScenarioResult,
  type ScenarioStep,
  type StepError,
} from "./types";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_STEPS = 200;
const MAX_EXPECTATIONS = 200;
const MAX_TEXT = 2000;
const BUSINESSES: readonly BusinessTemplate[] = ["ecommerce", "gym", "general", "blank"];
const OUTCOMES: readonly OutcomeKind[] = ["won", "lost", "resolved"];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, field: string, { optional = false }: { optional?: boolean } = {}): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (optional) return undefined;
    throw new Error(`Falta ${field}.`);
  }
  if (typeof v !== "string") throw new Error(`${field} debe ser un texto.`);
  if (v.length > MAX_TEXT) throw new Error(`${field} es demasiado largo.`);
  return v;
}

function strOrNull(v: unknown, field: string): string | null {
  return str(v, field, { optional: true }) ?? null;
}

function bool(v: unknown, field: string, fallback?: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === undefined && fallback !== undefined) return fallback;
  throw new Error(`${field} debe ser sí o no.`);
}

function int(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${field} debe ser un número.`);
  return v;
}

function scope(v: unknown): ExpectationScope | undefined {
  if (v === undefined || v === null) return undefined;
  if (v === "conversation" || v === "step") return v;
  throw new Error("El alcance de la expectativa no es válido.");
}

function parseProfile(v: unknown): ScenarioProfile {
  if (!isObj(v)) throw new Error("Falta el perfil inicial.");
  if (v.kind === "sample") return { kind: "sample", name: str(v.name, "El nombre del perfil") as string };
  if (v.kind === "custom") {
    return {
      kind: "custom",
      name: str(v.name, "El nombre del contacto", { optional: true }) ?? "Cliente de prueba",
      contactType: strOrNull(v.contactType, "El tipo de contacto"),
      tags: Array.isArray(v.tags) ? v.tags.map((t) => str(t, "Una etiqueta") as string) : [],
      existed: bool(v.existed, "«ya existe»", true),
      caseType: strOrNull(v.caseType, "El tipo de gestión"),
      stage: strOrNull(v.stage, "La etapa"),
      recentInbound: bool(v.recentInbound, "«escribió hace poco»", true),
    };
  }
  throw new Error("El perfil inicial no es válido.");
}

function parseStep(v: unknown, n: number): ScenarioStep {
  if (!isObj(v)) throw new Error(`El paso ${n} no es válido.`);
  try {
    switch (v.type) {
      case "client_text":
        return { type: "client_text", text: str(v.text, "El texto") as string };
      case "client_button": {
        const buttonType = v.buttonType === "quick_reply" ? "quick_reply" : v.buttonType === "postback" ? "postback" : undefined;
        const title = str(v.title, "El texto del botón") as string;
        return { type: "client_button", title, payload: str(v.payload, "La carga del botón", { optional: true }) ?? title, ...(buttonType ? { buttonType } : {}) };
      }
      case "advance": {
        const minutes = int(v.minutes, "Los minutos");
        if (minutes <= 0) throw new Error("Los minutos deben ser más de cero.");
        return { type: "advance", minutes };
      }
      case "agent_reply":
        return { type: "agent_reply", text: str(v.text, "El texto") as string, agent: strOrNull(v.agent, "El asesor") };
      case "change_stage":
        return { type: "change_stage", stage: str(v.stage, "La etapa") as string, ...(v.caseType ? { caseType: str(v.caseType, "El tipo") as string } : {}) };
      case "classify":
        return { type: "classify", caseType: str(v.caseType, "El tipo de gestión") as string };
      case "set_category":
        return { type: "set_category", category: strOrNull(v.category, "La categoría") };
      case "assign":
        return { type: "assign", member: strOrNull(v.member, "El miembro") };
      case "close": {
        const outcome = v.outcome === undefined || v.outcome === null ? undefined : OUTCOMES.includes(v.outcome as OutcomeKind) ? (v.outcome as OutcomeKind) : null;
        if (outcome === null) throw new Error("El resultado del cierre no es válido.");
        const keyDate = strOrNull(v.keyDate, "La fecha clave");
        if (keyDate && !/^\d{4}-\d{2}-\d{2}$/.test(keyDate)) throw new Error("La fecha clave debe ser AAAA-MM-DD.");
        return {
          type: "close",
          ...(outcome ? { outcome } : {}),
          ...(v.stage ? { stage: str(v.stage, "La etapa") as string } : {}),
          ...(v.reason ? { reason: str(v.reason, "El motivo") as string } : {}),
          ...(v.category ? { category: str(v.category, "La categoría") as string } : {}),
          ...(keyDate ? { keyDate } : {}),
          ...(v.note ? { note: str(v.note, "La nota") as string } : {}),
          ...(v.skipSchedule === true ? { skipSchedule: true } : {}),
        };
      }
      case "pause_bot":
        return { type: "pause_bot", paused: bool(v.paused, "«en pausa»") };
      default:
        throw new Error("Tipo de paso desconocido.");
    }
  } catch (e) {
    throw new Error(`Paso ${n}: ${e instanceof Error ? e.message : "no es válido."}`);
  }
}

function parseCheck(v: Obj): ExpectationCheck {
  const of = v.of ? (str(v.of, "El tipo de gestión") as string) : undefined;
  const withOf = of ? { of } : {};
  switch (v.kind) {
    case "flow_activated":
      return { kind: "flow_activated", flow: str(v.flow, "El flujo") as string, ...(scope(v.scope) ? { scope: scope(v.scope) } : {}) };
    case "bot_message_contains":
      return { kind: "bot_message_contains", text: str(v.text, "El texto") as string, ...(scope(v.scope) ? { scope: scope(v.scope) } : {}) };
    case "template_sent":
      return { kind: "template_sent", ...(v.name ? { name: str(v.name, "La plantilla") as string } : {}), ...(scope(v.scope) ? { scope: scope(v.scope) } : {}) };
    case "case_type":
      return { kind: "case_type", caseType: str(v.caseType, "El tipo de gestión") as string };
    case "case_stage":
      return { kind: "case_stage", stage: str(v.stage, "La etapa") as string, ...withOf };
    case "case_status": {
      if (!EXPECTED_STATUSES.includes(v.status as never)) throw new Error("El estado no es válido.");
      return { kind: "case_status", status: v.status as (typeof EXPECTED_STATUSES)[number], ...withOf };
    }
    case "assigned":
      return { kind: "assigned", assigned: bool(v.assigned, "«con responsable»"), ...(v.member ? { member: str(v.member, "El responsable") as string } : {}), ...withOf };
    case "case_team":
      return { kind: "case_team", team: str(v.team, "El equipo") as string, ...withOf };
    case "tag":
      return { kind: "tag", tag: str(v.tag, "La etiqueta") as string, present: bool(v.present, "«presente»", true) };
    case "contact_type":
      return { kind: "contact_type", contactType: str(v.contactType, "El tipo de contacto") as string };
    case "custom_field":
      return { kind: "custom_field", field: str(v.field, "El campo") as string, value: str(v.value, "El valor") as string };
    case "subscribed":
      return { kind: "subscribed", subscribed: bool(v.subscribed, "«suscrito»") };
    case "scheduled_case": {
      const inDays = int(v.inDays, "Los días");
      if (inDays < 0 || !Number.isInteger(inDays)) throw new Error("Los días deben ser un entero desde 0.");
      return { kind: "scheduled_case", caseType: str(v.caseType, "El tipo de gestión") as string, inDays };
    }
    case "bot_paused":
      return { kind: "bot_paused", paused: bool(v.paused, "«en pausa»") };
    case "nothing_sent":
      return { kind: "nothing_sent" };
    default:
      throw new Error("Tipo de expectativa desconocido.");
  }
}

export function parseScenarioDefinition(raw: unknown): Parsed<ScenarioDefinition> {
  try {
    if (!isObj(raw)) throw new Error("El escenario no es válido.");
    if (raw.version !== SCENARIO_VERSION) throw new Error("La versión del escenario no es compatible.");
    const business = raw.business === null || raw.business === undefined ? null : BUSINESSES.includes(raw.business as BusinessTemplate) ? (raw.business as BusinessTemplate) : null;
    const channel: LabChannel = LAB_CHANNELS.includes(raw.channel as LabChannel) ? (raw.channel as LabChannel) : "whatsapp";
    const flows = raw.flows === "published" || raw.flows === undefined ? "published" : Array.isArray(raw.flows) ? raw.flows.map((f) => str(f, "Un flujo") as string) : null;
    if (flows === null) throw new Error("Los flujos que participan no son válidos.");
    if (!Array.isArray(raw.steps)) throw new Error("Faltan los pasos.");
    if (raw.steps.length > MAX_STEPS) throw new Error(`Un escenario puede tener hasta ${MAX_STEPS} pasos.`);
    const steps = raw.steps.map((s, i) => parseStep(s, i + 1));
    const rawExpectations = raw.expectations === undefined ? [] : raw.expectations;
    if (!Array.isArray(rawExpectations)) throw new Error("Las expectativas no son válidas.");
    if (rawExpectations.length > MAX_EXPECTATIONS) throw new Error(`Un escenario puede tener hasta ${MAX_EXPECTATIONS} expectativas.`);
    const used = new Set<string>();
    const expectations: ScenarioExpectation[] = rawExpectations.map((e, i) => {
      if (!isObj(e)) throw new Error(`La expectativa ${i + 1} no es válida.`);
      try {
        const check = parseCheck(e);
        let after: number | null = null;
        if (e.after !== undefined && e.after !== null) {
          after = int(e.after, "El paso");
          if (!Number.isInteger(after) || after < 1 || after > steps.length) throw new Error(`El paso ${after} no existe.`);
        }
        let id = typeof e.id === "string" && e.id.trim() ? e.id.trim().slice(0, 40) : `e${i + 1}`;
        while (used.has(id)) id = `${id}_`;
        used.add(id);
        return { id, after, ...check };
      } catch (err) {
        throw new Error(`Expectativa ${i + 1}: ${err instanceof Error ? err.message : "no es válida."}`);
      }
    });
    const startAt = typeof raw.startAt === "string" && !Number.isNaN(Date.parse(raw.startAt)) ? raw.startAt : null;
    return {
      ok: true,
      value: { version: SCENARIO_VERSION, business, profile: parseProfile(raw.profile), channel, flows, ...(startAt ? { startAt } : {}), steps, expectations },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "El escenario no es válido." };
  }
}

/** Identificador nuevo para una expectativa (no repite los existentes). */
export function newExpectationId(existing: readonly Pick<ScenarioExpectation, "id">[]): string {
  const used = new Set(existing.map((e) => e.id));
  for (let n = existing.length + 1; ; n++) {
    const id = `e${n}`;
    if (!used.has(id)) return id;
  }
}

export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 120 ? name : null;
}

/** Resultado guardado (lab_scenarios.last_result): se reconstruye campo a campo; null si no sirve. */
export function parseScenarioResult(raw: unknown): ScenarioResult | null {
  if (!isObj(raw) || typeof raw.ok !== "boolean" || typeof raw.ranAt !== "string" || !Array.isArray(raw.expectations)) return null;
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_TEXT) : "");
  const expectations: ExpectationResult[] = [];
  for (const e of raw.expectations.slice(0, MAX_EXPECTATIONS)) {
    if (!isObj(e) || typeof e.ok !== "boolean") return null;
    expectations.push({
      id: text(e.id),
      description: text(e.description),
      after: typeof e.after === "number" && Number.isFinite(e.after) ? e.after : null,
      ok: e.ok,
      expected: text(e.expected),
      actual: text(e.actual),
    });
  }
  const se = raw.stepError;
  const stepError: StepError | null =
    isObj(se) && typeof se.step === "number" ? { step: se.step, text: text(se.text), message: text(se.message) } : null;
  const passed = expectations.filter((e) => e.ok).length;
  return {
    ok: raw.ok && !stepError && passed === expectations.length,
    ranAt: raw.ranAt,
    total: expectations.length,
    passed,
    failed: expectations.length - passed,
    stepError,
    expectations,
  };
}
