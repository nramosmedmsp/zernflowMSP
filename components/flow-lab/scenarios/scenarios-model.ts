// Lógica pura de la pantalla de escenarios: estado de cada uno, textos, nombres
// de copias y las propuestas de nombres que se ofrecen al editar. Sin React.

import { describeStep } from "@/lib/flow-lab/scenarios/describe";
import { normalizeName } from "@/lib/flow-lab/scenarios/names";
import {
  EXPECTED_STATUSES,
  type ExpectationCheck,
  type ExpectationKind,
  type ExpectationScope,
  type ScenarioResult,
  type ScenarioStep,
} from "@/lib/flow-lab/scenarios/types";
import type { LabCatalog } from "@/lib/flow-lab/types";

// ── Estado de un escenario ──────────────────────────────────────────────────

export type ScenarioStatus = "passed" | "failed" | "never";

export function statusOf(result: ScenarioResult | null | undefined): ScenarioStatus {
  if (!result) return "never";
  return result.ok ? "passed" : "failed";
}

export const STATUS_TEXT: Record<ScenarioStatus, string> = { passed: "Pasó", failed: "Falló", never: "Sin correr" };

/** "3 de 4 cumplidas" / "Se detuvo en el paso 2" / "Sin expectativas". */
export function resultSummary(result: ScenarioResult | null | undefined): string {
  if (!result) return "Sin correr";
  if (result.stepError) return result.stepError.step === 0 ? "No pudo arrancar" : `Se detuvo en el paso ${result.stepError.step}`;
  if (result.total === 0) return "Sin expectativas";
  return `${result.passed} de ${result.total} cumplidas`;
}

/** "5 pasaron, 2 fallaron, 1 sin correr" para el resumen de «Probar todos». */
export function totalsText(results: readonly ScenarioStatus[]): string {
  const count = (s: ScenarioStatus) => results.filter((r) => r === s).length;
  const parts: string[] = [];
  const passed = count("passed");
  const failed = count("failed");
  const never = count("never");
  if (passed) parts.push(`${passed} ${passed === 1 ? "pasó" : "pasaron"}`);
  if (failed) parts.push(`${failed} ${failed === 1 ? "falló" : "fallaron"}`);
  if (never) parts.push(`${never} sin correr`);
  return parts.join(", ") || "Sin escenarios";
}

/** Nombre libre para una copia: «X (copia)», «X (copia 2)»... */
export function copyName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map(normalizeName));
  const base = name.replace(/ \(copia(?: \d+)?\)$/, "");
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base} (copia)` : `${base} (copia ${n})`;
    if (!taken.has(normalizeName(candidate))) return candidate.slice(0, 120);
  }
}

/** "Paso 3 · El cliente escribe: «hola»". */
export function stepLabel(steps: readonly ScenarioStep[], n: number): string {
  const step = steps[n - 1];
  return step ? `Paso ${n} · ${describeStep(step)}` : `Paso ${n}`;
}

// ── Editor de expectativas ──────────────────────────────────────────────────

export const KIND_LABELS: Record<ExpectationKind, string> = {
  flow_activated: "Se activó un flujo",
  bot_message_contains: "El bot envió un mensaje con un texto",
  template_sent: "Se envió una plantilla de WhatsApp",
  case_type: "Tipo de la gestión",
  case_stage: "Etapa de la gestión",
  case_status: "Estado de la gestión",
  assigned: "Responsable de la gestión",
  case_team: "Equipo de la gestión",
  tag: "Etiqueta del contacto",
  contact_type: "Tipo de contacto",
  custom_field: "Campo del contacto",
  subscribed: "Suscripción del contacto",
  scheduled_case: "Gestión programada",
  bot_paused: "Bot en pausa",
  nothing_sent: "El bot no envió nada",
};

export const SCOPE_LABELS: Record<ExpectationScope, string> = {
  conversation: "en toda la conversación",
  step: "solo en ese paso",
};

export const STATUS_OPTIONS = EXPECTED_STATUSES.map((value) => ({
  value,
  label: { open: "Abierta", won: "Ganada", lost: "Perdida", resolved: "Resuelta", scheduled: "Programada" }[value],
}));

export type FieldSpec =
  | { key: string; label: string; type: "text"; suggest?: "flows" | "caseTypes" | "stages" | "teams" | "members" | "tags" | "contactTypes" | "fields"; optional?: boolean }
  | { key: string; label: string; type: "number" }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[]; optional?: boolean }
  | { key: string; label: string; type: "bool"; yes: string; no: string };

const SCOPE_FIELD: FieldSpec = {
  key: "scope",
  label: "Dónde",
  type: "select",
  optional: true,
  options: [
    { value: "conversation", label: SCOPE_LABELS.conversation },
    { value: "step", label: SCOPE_LABELS.step },
  ],
};
const OF_FIELD: FieldSpec = { key: "of", label: "De la gestión de tipo (opcional)", type: "text", suggest: "caseTypes", optional: true };

export function fieldsFor(kind: ExpectationKind): FieldSpec[] {
  switch (kind) {
    case "flow_activated":
      return [{ key: "flow", label: "Flujo", type: "text", suggest: "flows" }, SCOPE_FIELD];
    case "bot_message_contains":
      return [{ key: "text", label: "Texto que contiene", type: "text" }, SCOPE_FIELD];
    case "template_sent":
      return [{ key: "name", label: "Nombre de la plantilla (opcional)", type: "text", optional: true }, SCOPE_FIELD];
    case "case_type":
      return [{ key: "caseType", label: "Tipo", type: "text", suggest: "caseTypes" }];
    case "case_stage":
      return [{ key: "stage", label: "Etapa", type: "text", suggest: "stages" }, OF_FIELD];
    case "case_status":
      return [{ key: "status", label: "Estado", type: "select", options: STATUS_OPTIONS }, OF_FIELD];
    case "assigned":
      return [
        { key: "assigned", label: "Responsable", type: "bool", yes: "Con responsable", no: "Sin responsable" },
        { key: "member", label: "Persona (opcional)", type: "text", suggest: "members", optional: true },
        OF_FIELD,
      ];
    case "case_team":
      return [{ key: "team", label: "Equipo", type: "text", suggest: "teams" }, OF_FIELD];
    case "tag":
      return [
        { key: "tag", label: "Etiqueta", type: "text", suggest: "tags" },
        { key: "present", label: "Debe estar", type: "bool", yes: "Presente", no: "Ausente" },
      ];
    case "contact_type":
      return [{ key: "contactType", label: "Tipo de contacto", type: "text", suggest: "contactTypes" }];
    case "custom_field":
      return [
        { key: "field", label: "Campo", type: "text", suggest: "fields" },
        { key: "value", label: "Valor", type: "text" },
      ];
    case "subscribed":
      return [{ key: "subscribed", label: "Contacto", type: "bool", yes: "Suscrito", no: "Dado de baja" }];
    case "scheduled_case":
      return [
        { key: "caseType", label: "Tipo de gestión", type: "text", suggest: "caseTypes" },
        { key: "inDays", label: "Dentro de (días)", type: "number" },
      ];
    case "bot_paused":
      return [{ key: "paused", label: "Bot", type: "bool", yes: "En pausa", no: "Activo" }];
    case "nothing_sent":
      return [];
  }
}

/** Expectativa nueva de ese tipo con valores iniciales. */
export function defaultCheck(kind: ExpectationKind): ExpectationCheck {
  switch (kind) {
    case "flow_activated":
      return { kind, flow: "" };
    case "bot_message_contains":
      return { kind, text: "" };
    case "template_sent":
      return { kind };
    case "case_type":
      return { kind, caseType: "" };
    case "case_stage":
      return { kind, stage: "" };
    case "case_status":
      return { kind, status: "open" };
    case "assigned":
      return { kind, assigned: true };
    case "case_team":
      return { kind, team: "" };
    case "tag":
      return { kind, tag: "", present: true };
    case "contact_type":
      return { kind, contactType: "" };
    case "custom_field":
      return { kind, field: "", value: "" };
    case "subscribed":
      return { kind, subscribed: true };
    case "scheduled_case":
      return { kind, caseType: "", inDays: 1 };
    case "bot_paused":
      return { kind, paused: true };
    case "nothing_sent":
      return { kind };
  }
}

/** ¿Falta algún dato obligatorio? (para no guardar expectativas vacías) */
export function isIncomplete(check: ExpectationCheck): boolean {
  const record = check as unknown as Record<string, unknown>;
  return fieldsFor(check.kind).some((f) => {
    if (("optional" in f && f.optional) || f.type === "bool" || f.type === "select") return false;
    const value = record[f.key];
    return f.type === "number" ? typeof value !== "number" || !Number.isFinite(value) || value < 0 : typeof value !== "string" || !value.trim();
  });
}

export type Suggestions = Record<NonNullable<Extract<FieldSpec, { type: "text" }>["suggest"]>, string[]>;

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((v) => {
    const key = normalizeName(v);
    if (!v.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Nombres del catálogo actual para sugerir al escribir. */
export function suggestionsFor(catalog: LabCatalog): Suggestions {
  return {
    flows: unique(catalog.flows.map((f) => f.name)),
    caseTypes: unique(catalog.caseTypes.map((t) => t.name)),
    stages: unique(catalog.caseTypes.flatMap((t) => t.stages.map((s) => s.name))),
    teams: unique(catalog.teams.map((t) => t.name)),
    members: unique(catalog.members.map((m) => m.name)),
    tags: unique(catalog.tags),
    contactTypes: unique(catalog.contactTypes.map((t) => t.name)),
    fields: unique(catalog.customFields.map((f) => f.name)),
  };
}
