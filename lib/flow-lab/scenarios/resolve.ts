// Resolución por nombre: convierte el punto de partida y cada paso de un
// escenario (que habla de tipos, etapas, motivos y miembros por nombre) en lo
// que entienden las acciones del simulador (ids del catálogo actual).

import { advanceTime, agentReplies, assign, changeStage, classify, clientSays, closeCase, setBotPaused, setCategory } from "../actions";
import { buildSampleProfiles } from "../profiles";
import { emptyContact, latestOpenCase, newCaseTemplate } from "../state";
import type { ClientInput, CloseCaseInput, LabCaseType, LabCatalog, LabOptions, LabProfile, LabResult, LabState } from "../types";
import { findByName, sameName } from "./names";
import type { ScenarioProfile, ScenarioStep } from "./types";

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Resolved<T> => ({ ok: true, value });
const fail = (error: string): Resolved<never> => ({ ok: false, error });

export function caseTypeByName(catalog: LabCatalog, name: string): Resolved<LabCaseType> {
  const found = findByName(catalog.caseTypes, name);
  return found ? ok(found) : fail(`El espacio no tiene un tipo de gestión «${name}».`);
}

export function memberByName(catalog: LabCatalog, name: string): Resolved<string> {
  const found = catalog.members.find((m) => sameName(m.name, name));
  return found ? ok(found.userId) : fail(`El espacio no tiene a un miembro llamado «${name}».`);
}

export function flowIdsByName(catalog: LabCatalog, names: readonly string[]): Resolved<string[]> {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const flow = findByName(catalog.flows, name);
    if (flow) ids.push(flow.id);
    else missing.push(`«${name}»`);
  }
  return missing.length > 0 ? fail(`No existe${missing.length > 1 ? "n" : ""} el flujo ${missing.join(", ")}.`) : ok(ids);
}

// ── Punto de partida ────────────────────────────────────────────────────────

export function buildScenarioProfile(catalog: LabCatalog, profile: ScenarioProfile, nowIso: string): Resolved<LabProfile> {
  if (profile.kind === "sample") {
    const found = buildSampleProfiles(catalog, nowIso).find((p) => sameName(p.name, profile.name));
    return found ? ok(found) : fail(`No existe el perfil de ejemplo «${profile.name}».`);
  }

  let contactTypeId: string | null = null;
  if (profile.contactType) {
    const type = findByName(catalog.contactTypes, profile.contactType);
    if (!type) return fail(`El espacio no tiene un tipo de contacto «${profile.contactType}».`);
    contactTypeId = type.id;
  }
  const cases = [];
  if (profile.caseType) {
    const type = caseTypeByName(catalog, profile.caseType);
    if (!type.ok) return type;
    const stage = profile.stage ? findByName(type.value.stages, profile.stage) : (type.value.stages.find((s) => s.kind === "open") ?? type.value.stages[0]);
    if (!stage) return fail(`El tipo «${type.value.name}» no tiene una etapa «${profile.stage}».`);
    const row = newCaseTemplate("case-1", nowIso);
    row.caseTypeId = type.value.id;
    row.stageId = stage.id;
    row.openedAt = nowIso;
    if (profile.recentInbound) row.lastInboundAt = new Date(new Date(nowIso).getTime() - 30 * 60_000).toISOString();
    cases.push(row);
  }
  return ok({
    id: "custom",
    name: "Personalizado",
    description: "Contacto armado a mano.",
    contact: emptyContact({
      name: profile.name.trim() || "Cliente de prueba",
      contactTypeId,
      tags: [...profile.tags],
      existed: profile.existed || cases.length > 0,
    }),
    cases,
    messages: [],
    clock: nowIso,
    notices: [],
  });
}

// ── Pasos ───────────────────────────────────────────────────────────────────

export type StepRunner = (state: LabState, options: LabOptions) => LabResult;

function stageIn(catalog: LabCatalog, type: LabCaseType | undefined, name: string): Resolved<string> {
  const pool = type ? [type] : catalog.caseTypes;
  for (const t of pool) {
    const stage = findByName(t.stages, name);
    if (stage) return ok(stage.id);
  }
  return fail(type ? `El tipo «${type.name}» no tiene una etapa «${name}».` : `Ningún tipo de gestión tiene una etapa «${name}».`);
}

/** Tipo de la gestión abierta más reciente (donde actúa el asesor). */
function openType(catalog: LabCatalog, state: LabState): LabCaseType | undefined {
  const row = latestOpenCase(state);
  return row?.caseTypeId ? catalog.caseTypes.find((t) => t.id === row.caseTypeId) : undefined;
}

/**
 * Convierte un paso en la acción del simulador, resolviendo los nombres con el
 * catálogo y el estado en que se aplicará (la etapa y la categoría son las del
 * tipo de la gestión abierta). Devuelve un error en español si algún nombre no existe.
 */
export function resolveStep(catalog: LabCatalog, state: LabState, step: ScenarioStep): Resolved<StepRunner> {
  switch (step.type) {
    case "client_text": {
      const input: ClientInput = { kind: "text", text: step.text };
      return ok((s, o) => clientSays(catalog, s, input, o));
    }
    case "client_button": {
      const input: ClientInput = { kind: "button", title: step.title, payload: step.payload, buttonType: step.buttonType };
      return ok((s, o) => clientSays(catalog, s, input, o));
    }
    case "advance": {
      if (!Number.isFinite(step.minutes) || step.minutes <= 0) return fail("El tiempo que pasa debe ser mayor que cero.");
      return ok((s, o) => advanceTime(catalog, s, step.minutes, o));
    }
    case "agent_reply": {
      let agentId: string | null = null;
      if (step.agent) {
        const member = memberByName(catalog, step.agent);
        if (!member.ok) return member;
        agentId = member.value;
      }
      return ok((s, o) => agentReplies(catalog, s, step.text, { agentId, options: o }));
    }
    case "change_stage": {
      let type: LabCaseType | undefined;
      if (step.caseType) {
        const t = caseTypeByName(catalog, step.caseType);
        if (!t.ok) return t;
        type = t.value;
      } else {
        type = openType(catalog, state);
      }
      const stageId = stageIn(catalog, type, step.stage);
      if (!stageId.ok) return stageId;
      return ok((s, o) => changeStage(catalog, s, stageId.value, { options: o }));
    }
    case "classify": {
      const type = caseTypeByName(catalog, step.caseType);
      if (!type.ok) return type;
      return ok((s, o) => classify(catalog, s, type.value.id, { options: o }));
    }
    case "set_category": {
      if (!step.category) return ok((s, o) => setCategory(catalog, s, null, { options: o }));
      const type = openType(catalog, state);
      if (!type) return fail("No hay una gestión abierta con tipo para ponerle categoría.");
      const category = findByName(type.categories, step.category);
      if (!category) return fail(`El tipo «${type.name}» no tiene una categoría «${step.category}».`);
      return ok((s, o) => setCategory(catalog, s, category.id, { options: o }));
    }
    case "assign": {
      if (!step.member) return ok((s, o) => assign(catalog, s, null, { options: o }));
      const member = memberByName(catalog, step.member);
      if (!member.ok) return member;
      return ok((s, o) => assign(catalog, s, member.value, { options: o }));
    }
    case "close": {
      const row = latestOpenCase(state);
      const type = openType(catalog, state);
      if (!row) return fail("No hay una gestión abierta para cerrar.");
      const input: CloseCaseInput = { caseId: row.id };
      if (step.stage) {
        const stage = type ? findByName(type.stages, step.stage) : undefined;
        if (!stage) return fail(`El tipo de la gestión no tiene una etapa «${step.stage}».`);
        input.stageId = stage.id;
      } else {
        input.kind = step.outcome ?? "won";
      }
      if (step.reason) {
        const reason = type ? findByName(type.reasons, step.reason) : undefined;
        if (!reason) return fail(`El tipo de la gestión no tiene un motivo «${step.reason}».`);
        input.outcomeReasonId = reason.id;
      }
      if (step.category) {
        const category = type ? findByName(type.categories, step.category) : undefined;
        if (!category) return fail(`El tipo de la gestión no tiene una categoría «${step.category}».`);
        input.categoryId = category.id;
      }
      if (step.keyDate) input.keyDate = step.keyDate;
      if (step.note) input.note = step.note;
      if (step.skipSchedule) input.scheduleOverride = { skip: true };
      return ok((s, o) => closeCase(catalog, s, input, { options: o }));
    }
    case "pause_bot":
      return ok((s) => setBotPaused(catalog, s, step.paused));
  }
}
