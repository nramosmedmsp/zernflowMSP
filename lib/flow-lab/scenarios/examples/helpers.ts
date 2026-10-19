// Ayudas para escribir los escenarios de ejemplo de forma compacta.

import type { BusinessTemplate } from "@/lib/types/database";
import { SCENARIO_VERSION, type ExpectationCheck, type NamedScenario, type ScenarioProfile, type ScenarioStep } from "../types";

/** Lunes 19/10/2026 10:00 de Lima: reloj fijo para que el resultado no dependa de cuándo se corra. */
export const EXAMPLE_START = "2026-10-19T15:00:00.000Z";

export type ExpectationInput = ExpectationCheck & { after?: number | null };

export function example(input: {
  name: string;
  description: string;
  business: BusinessTemplate;
  profile: ScenarioProfile;
  steps: ScenarioStep[];
  expect: ExpectationInput[];
}): NamedScenario {
  return {
    name: input.name,
    description: input.description,
    definition: {
      version: SCENARIO_VERSION,
      business: input.business,
      profile: input.profile,
      channel: "whatsapp",
      flows: "published",
      startAt: EXAMPLE_START,
      steps: input.steps,
      expectations: input.expect.map((e, i) => ({ id: `e${i + 1}`, after: null, ...e })),
    },
  };
}

/** Contacto nuevo (no existe todavía): su primer mensaje dispara la bienvenida. */
export const NEW_PROSPECT: ScenarioProfile = {
  kind: "custom",
  name: "Lucía",
  contactType: null,
  tags: [],
  existed: false,
  caseType: null,
  stage: null,
  recentInbound: true,
};

/** Contacto que ya existe, de un tipo dado y sin gestión. */
export function existingContact(contactType: string | null): ScenarioProfile {
  return { kind: "custom", name: "Lucía", contactType, tags: [], existed: true, caseType: null, stage: null, recentInbound: true };
}
