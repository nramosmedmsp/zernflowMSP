// Puente entre la pantalla del laboratorio y los escenarios guardados: convierte
// la prueba hecha a mano en un escenario (pasos + expectativas propuestas) y un
// escenario en una prueba del laboratorio (reproduce los pasos). Sin React.

import { buildSampleProfiles, setEnabledFlows } from "@/lib/flow-lab";
import { scenarioFromSession } from "@/lib/flow-lab/scenarios/from-session";
import { sameName } from "@/lib/flow-lab/scenarios/names";
import { runScenario } from "@/lib/flow-lab/scenarios/run";
import type { ScenarioDefinition, ScenarioProfile, ScenarioStep } from "@/lib/flow-lab/scenarios/types";
import type { BusinessTemplate } from "@/lib/types/database";
import type { LabCatalog, LabState } from "@/lib/flow-lab/types";
import {
  CUSTOM_PROFILE_ID,
  MAX_ENTRIES,
  defaultCustomProfile,
  parseTags,
  pushEntry,
  snapshotOf,
  type CustomProfileInput,
  type LabConfig,
  type LabEntry,
  type SavedLab,
} from "./lab-model";

export type LabSessionData = Pick<SavedLab, "config" | "state" | "entries" | "initialSnapshot">;

// ── De la prueba al escenario ───────────────────────────────────────────────

/** Perfil inicial del escenario a partir de la configuración de la prueba (ids → nombres). */
export function scenarioProfileFromConfig(catalog: LabCatalog, config: LabConfig): ScenarioProfile {
  if (config.profileId !== CUSTOM_PROFILE_ID) {
    const sample = buildSampleProfiles(catalog).find((p) => p.id === config.profileId);
    if (sample) return { kind: "sample", name: sample.name };
  }
  const c = config.custom;
  const caseType = c.caseTypeId ? catalog.caseTypes.find((t) => t.id === c.caseTypeId) : undefined;
  const stage = caseType?.stages.find((s) => s.id === c.stageId);
  return {
    kind: "custom",
    name: c.name.trim() || "Cliente de prueba",
    contactType: catalog.contactTypes.find((t) => t.id === c.contactTypeId)?.name ?? null,
    tags: parseTags(c.tags),
    existed: c.existed || !!caseType,
    caseType: caseType?.name ?? null,
    stage: stage?.name ?? null,
    recentInbound: c.recentInbound,
  };
}

export interface ScenarioFromLab {
  definition: ScenarioDefinition;
  /** Lo que no se pudo convertir o puede cambiar al reproducir. */
  notices: string[];
}

/**
 * Convierte la prueba en un escenario: las acciones hechas son los pasos y, del
 * estado alcanzado, salen las expectativas propuestas (el usuario las revisa).
 */
export function scenarioFromLab(input: { catalog: LabCatalog; config: LabConfig; entries: readonly LabEntry[]; finalState: LabState; business: BusinessTemplate | null }): ScenarioFromLab {
  const steps: ScenarioStep[] = input.entries.flatMap((e) => (e.step ? [e.step] : []));
  const notices: string[] = [];
  const missing = input.entries.length - steps.length;
  if (missing > 0) {
    notices.push(`${missing === 1 ? "Una acción de esta prueba se hizo" : `${missing} acciones de esta prueba se hicieron`} antes de que el laboratorio guardara los pasos y no se incluyen: el escenario puede no reproducir el mismo resultado. Reinicia la prueba y vuelve a hacerla para guardarla completa.`);
  }
  if (input.entries.length >= MAX_ENTRIES) {
    notices.push(`El laboratorio solo recuerda las últimas ${MAX_ENTRIES} acciones: si la prueba es más larga, el escenario no empieza donde empezó la conversación.`);
  }
  const definition = scenarioFromSession({
    catalog: input.catalog,
    profile: scenarioProfileFromConfig(input.catalog, input.config),
    channel: input.config.channel,
    flowIds: input.config.flowIds,
    business: input.business,
    steps,
    finalState: input.finalState,
  });
  return { definition, notices };
}

// ── Del escenario a la prueba ───────────────────────────────────────────────

/** Configuración del laboratorio equivalente al punto de partida del escenario (nombres → ids). */
export function configFromScenario(catalog: LabCatalog, definition: ScenarioDefinition): { config: LabConfig; notices: string[] } {
  const notices: string[] = [];
  const published = catalog.flows.filter((f) => f.status === "published").map((f) => f.id);
  let flowIds = published;
  if (definition.flows !== "published") {
    flowIds = [];
    for (const name of definition.flows) {
      const flow = catalog.flows.find((f) => sameName(f.name, name));
      if (flow) flowIds.push(flow.id);
      else notices.push(`El flujo «${name}» ya no existe.`);
    }
  }

  const custom: CustomProfileInput = defaultCustomProfile(catalog);
  let profileId = CUSTOM_PROFILE_ID;
  const profile = definition.profile;
  if (profile.kind === "sample") {
    const sample = buildSampleProfiles(catalog).find((p) => sameName(p.name, profile.name));
    if (sample) profileId = sample.id;
    else notices.push(`El perfil «${profile.name}» no existe: se usa un contacto personalizado.`);
  } else {
    custom.name = profile.name;
    custom.contactTypeId = catalog.contactTypes.find((t) => sameName(t.name, profile.contactType))?.id ?? null;
    custom.tags = profile.tags.join(", ");
    custom.existed = profile.existed;
    const caseType = catalog.caseTypes.find((t) => sameName(t.name, profile.caseType));
    custom.caseTypeId = caseType?.id ?? null;
    custom.stageId = caseType?.stages.find((s) => sameName(s.name, profile.stage))?.id ?? null;
    custom.recentInbound = profile.recentInbound;
  }
  return { config: { profileId, custom, channel: definition.channel, flowIds }, notices };
}

export type ReplayResult = { ok: true; session: LabSessionData; notices: string[] } | { ok: false; error: string };

/**
 * Reproduce los pasos de un escenario con el catálogo actual y devuelve la
 * prueba lista para seguir a mano. Si un paso no se puede aplicar, la prueba
 * queda hasta el último paso bueno y se avisa.
 */
export function sessionFromScenario(catalog: LabCatalog, definition: ScenarioDefinition, nowIso: string): ReplayResult {
  const run = runScenario(catalog, definition, { nowIso });
  if (!run.initialState) return { ok: false, error: run.result.stepError?.message ?? "No se pudo armar el punto de partida del escenario." };

  const { config, notices } = configFromScenario(catalog, definition);
  let entries: LabEntry[] = [];
  run.states.forEach((state, i) => {
    entries = pushEntry(entries, { trace: run.traces[i], snapshot: snapshotOf(catalog, state), step: definition.steps[i] });
  });
  const state = setEnabledFlows(run.finalState ?? run.initialState, config.flowIds);
  const error = run.result.stepError;
  if (error) notices.push(error.step === 0 ? error.message : `El paso ${error.step} («${error.text}») no se pudo aplicar: ${error.message} La prueba quedó hasta el paso anterior.`);
  if (definition.steps.length > MAX_ENTRIES) notices.push(`Solo se muestran las últimas ${MAX_ENTRIES} acciones.`);
  return { ok: true, session: { config, state, entries, initialSnapshot: snapshotOf(catalog, run.initialState) }, notices };
}
