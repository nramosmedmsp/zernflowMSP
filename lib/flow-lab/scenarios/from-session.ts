// De una prueba hecha a mano en el laboratorio a un escenario: cada acción se
// guarda como paso (con los nombres, no los ids) y, a partir del estado al que
// se llegó, se proponen las expectativas finales.

import { limaDateOf } from "@/lib/cases/dates";
import { caseTypeName, contactTypeName, stageName, teamName } from "../catalog";
import type { BusinessTemplate } from "@/lib/types/database";
import { currentCase, latestOpenCase } from "../state";
import type { ClientInput, CloseCaseInput, LabCaseType, LabCatalog, LabChannel, LabState } from "../types";
import { sameName } from "./names";
import { SCENARIO_VERSION, type ExpectationCheck, type ScenarioDefinition, type ScenarioExpectation, type ScenarioProfile, type ScenarioStep } from "./types";

/** Lo que el usuario hace en el laboratorio (misma forma que las acciones de la pantalla). */
export type RecordableAction =
  | { type: "client"; input: ClientInput }
  | { type: "advance"; minutes: number }
  | { type: "reply"; text: string; agentId: string | null }
  | { type: "stage"; stageId: string }
  | { type: "classify"; caseTypeId: string }
  | { type: "category"; categoryId: string | null }
  | { type: "assign"; memberId: string | null }
  | { type: "close"; input: CloseCaseInput }
  | { type: "pause"; paused: boolean };

function typeOfOpenCase(catalog: LabCatalog, state: LabState): LabCaseType | undefined {
  const row = latestOpenCase(state);
  return row?.caseTypeId ? catalog.caseTypes.find((t) => t.id === row.caseTypeId) : undefined;
}

function memberLabel(catalog: LabCatalog, id: string | null | undefined): string | null {
  if (!id) return null;
  return catalog.members.find((m) => m.userId === id)?.name ?? null;
}

/**
 * Convierte una acción del laboratorio en un paso. `stateBefore` es el estado
 * en que se aplicó (de él salen el tipo de la gestión abierta y sus etapas,
 * motivos y categorías).
 */
export function stepFromAction(catalog: LabCatalog, stateBefore: LabState, action: RecordableAction): ScenarioStep {
  switch (action.type) {
    case "client":
      return action.input.kind === "text"
        ? { type: "client_text", text: action.input.text }
        : {
            type: "client_button",
            title: action.input.title ?? action.input.payload,
            payload: action.input.payload,
            ...(action.input.buttonType === "quick_reply" ? { buttonType: "quick_reply" as const } : {}),
          };
    case "advance":
      return { type: "advance", minutes: action.minutes };
    case "reply":
      return { type: "agent_reply", text: action.text, agent: memberLabel(catalog, action.agentId) };
    case "stage": {
      const name = stageName(catalog, action.stageId);
      const type = typeOfOpenCase(catalog, stateBefore);
      // Si otro tipo tiene una etapa con el mismo nombre, se indica el tipo.
      const ambiguous = catalog.caseTypes.filter((t) => t.stages.some((s) => sameName(s.name, name))).length > 1;
      return { type: "change_stage", stage: name, ...(ambiguous && type ? { caseType: type.name } : {}) };
    }
    case "classify":
      return { type: "classify", caseType: caseTypeName(catalog, action.caseTypeId) };
    case "category": {
      const type = typeOfOpenCase(catalog, stateBefore);
      const name = action.categoryId ? type?.categories.find((c) => c.id === action.categoryId)?.name : null;
      return { type: "set_category", category: name ?? null };
    }
    case "assign":
      return { type: "assign", member: memberLabel(catalog, action.memberId) };
    case "close": {
      const type = typeOfOpenCase(catalog, stateBefore);
      const i = action.input;
      const stage = i.stageId ? type?.stages.find((s) => s.id === i.stageId) : undefined;
      const reason = i.outcomeReasonId ? type?.reasons.find((r) => r.id === i.outcomeReasonId)?.name : undefined;
      const category = i.categoryId ? type?.categories.find((c) => c.id === i.categoryId)?.name : undefined;
      return {
        type: "close",
        ...(stage ? { stage: stage.name } : { outcome: i.kind ?? "won" }),
        ...(reason ? { reason } : {}),
        ...(category ? { category } : {}),
        ...(i.keyDate ? { keyDate: i.keyDate } : {}),
        ...(i.note ? { note: i.note } : {}),
        ...(i.scheduleOverride?.skip ? { skipSchedule: true } : {}),
      };
    }
    case "pause":
      return { type: "pause_bot", paused: action.paused };
  }
}

// ── Expectativas propuestas ─────────────────────────────────────────────────

function firstLine(text: string, max = 60): string {
  const line = text.split("\n").find((l) => l.trim()) ?? text;
  const clean = line.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut).trim();
}

/**
 * Expectativas a partir del estado al que llegó la prueba: lo que se activó, el
 * último mensaje del bot, la gestión, el contacto y lo programado. El usuario
 * las revisa y quita las que no le interesan.
 */
export function proposeExpectations(catalog: LabCatalog, state: LabState): ScenarioExpectation[] {
  const checks: ExpectationCheck[] = [];

  const seen = new Set<string>();
  for (const session of state.sessions) {
    const flow = catalog.flows.find((f) => f.id === session.flowId);
    if (flow && !seen.has(flow.id)) {
      seen.add(flow.id);
      checks.push({ kind: "flow_activated", flow: flow.name });
    }
  }

  const botMessages = state.messages.filter((m) => m.author === "bot");
  const templates = new Set<string>();
  for (const m of botMessages) {
    if (m.kind === "template" && m.template?.name && !templates.has(m.template.name)) {
      templates.add(m.template.name);
      checks.push({ kind: "template_sent", name: m.template.name });
    }
  }
  const lastText = [...botMessages].reverse().find((m) => m.kind === "text" && m.text.trim());
  if (lastText) checks.push({ kind: "bot_message_contains", text: firstLine(lastText.text) });

  const row = currentCase(state);
  if (row) {
    if (row.caseTypeId) checks.push({ kind: "case_type", caseType: caseTypeName(catalog, row.caseTypeId) });
    if (row.stageId) checks.push({ kind: "case_stage", stage: stageName(catalog, row.stageId) });
    if (row.status === "open" || row.status === "won" || row.status === "lost" || row.status === "resolved" || row.status === "scheduled") {
      checks.push({ kind: "case_status", status: row.status });
    }
    if (row.status === "open") {
      const member = memberLabel(catalog, row.assigneeId);
      checks.push(row.assigneeId ? { kind: "assigned", assigned: true, ...(member ? { member } : {}) } : { kind: "assigned", assigned: false });
    }
    if (row.status === "open" && row.teamId) checks.push({ kind: "case_team", team: teamName(catalog, row.teamId) });
  }

  if (state.contact.contactTypeId) checks.push({ kind: "contact_type", contactType: contactTypeName(catalog, state.contact.contactTypeId) });
  for (const tag of state.contact.tags) checks.push({ kind: "tag", tag, present: true });
  for (const [slug, value] of Object.entries(state.contact.customFields)) {
    const def = catalog.customFields.find((f) => f.slug === slug);
    if (value.trim()) checks.push({ kind: "custom_field", field: def?.name ?? slug, value });
  }
  if (!state.contact.subscribed) checks.push({ kind: "subscribed", subscribed: false });
  if (state.automationPaused) checks.push({ kind: "bot_paused", paused: true });

  const today = limaDateOf(new Date(state.clock));
  for (const c of state.cases) {
    if (c.status !== "scheduled" || !c.scheduledFor || !c.caseTypeId) continue;
    const date = limaDateOf(new Date(c.scheduledFor));
    const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    checks.push({ kind: "scheduled_case", caseType: caseTypeName(catalog, c.caseTypeId), inDays: Math.max(days, 0) });
  }

  return checks.map((check, i) => ({ id: `e${i + 1}`, after: null, ...check }));
}

// ── Escenario completo ──────────────────────────────────────────────────────

/** "published" si los flujos elegidos son exactamente los publicados; si no, sus nombres. */
export function flowsFromIds(catalog: LabCatalog, flowIds: readonly string[]): "published" | string[] {
  const published = catalog.flows.filter((f) => f.status === "published").map((f) => f.id);
  const chosen = new Set(flowIds);
  if (published.length === chosen.size && published.every((id) => chosen.has(id))) return "published";
  return catalog.flows.filter((f) => chosen.has(f.id)).map((f) => f.name);
}

export interface SessionToScenarioInput {
  catalog: LabCatalog;
  profile: ScenarioProfile;
  channel: LabChannel;
  flowIds: readonly string[];
  business: BusinessTemplate | null;
  steps: ScenarioStep[];
  /** Estado al que llegó la prueba (de él salen las expectativas propuestas). */
  finalState: LabState;
}

/** Escenario con los pasos de la prueba y las expectativas propuestas. */
export function scenarioFromSession(input: SessionToScenarioInput): ScenarioDefinition {
  return {
    version: SCENARIO_VERSION,
    business: input.business,
    profile: input.profile,
    channel: input.channel,
    flows: flowsFromIds(input.catalog, input.flowIds),
    steps: input.steps,
    expectations: proposeExpectations(input.catalog, input.finalState),
  };
}

