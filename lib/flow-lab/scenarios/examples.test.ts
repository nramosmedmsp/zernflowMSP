// Los escenarios de ejemplo deben pasar con las plantillas de negocio y de
// flujos tal como vienen (buildCatalogFromTemplates, sin parches).

import { beforeAll, describe, expect, it } from "vitest";
import { buildCatalogFromTemplates } from "../from-templates";
import type { LabCatalog, LabTeam, LabTeamMember } from "../types";
import { ECOMMERCE_EXAMPLES, GYM_EXAMPLES, exampleScenariosFor } from "./examples";
import { runScenario } from "./run";
import { parseScenarioDefinition } from "./validate";
import type { NamedScenario, ScenarioResult } from "./types";

const SEDES = ["Sede 1", "Sede 2", "Sede 3"];
const teams: LabTeam[] = SEDES.map((name, i) => ({ id: `team-${i + 1}`, name, isDefault: i === 0, assignmentMode: "round_robin", businessHours: null }));
const teamMembers: LabTeamMember[] = teams.flatMap((t) =>
  ["u-ana", "u-beto"].map((userId) => ({ teamId: t.id, userId, role: "agent" as const, caseTypeIds: null })),
);

let ecommerce: LabCatalog;
let gym: LabCatalog;

beforeAll(async () => {
  ecommerce = await buildCatalogFromTemplates({ business: "ecommerce" });
  gym = await buildCatalogFromTemplates({ business: "gym", teams, teamMembers });
});

function failures(result: ScenarioResult): string[] {
  const lines = result.expectations.filter((e) => !e.ok).map((e) => `${e.description}${e.after ? ` (tras el paso ${e.after})` : ""}: esperado ${e.expected}; obtenido ${e.actual}`);
  if (result.stepError) lines.unshift(`paso ${result.stepError.step} «${result.stepError.text}»: ${result.stepError.message}`);
  return lines;
}

function checkAll(list: NamedScenario[], catalog: () => LabCatalog) {
  for (const scenario of list) {
    it(scenario.name, () => {
      const parsed = parseScenarioDefinition(JSON.parse(JSON.stringify(scenario.definition)));
      expect(parsed.ok).toBe(true);
      const run = runScenario(catalog(), scenario.definition);
      expect(failures(run.result)).toEqual([]);
      expect(run.result.ok).toBe(true);
      expect(run.result.total).toBeGreaterThan(0);
    });
  }
}

describe("escenarios de ejemplo de E-commerce", () => {
  it("hay al menos 10, con nombres distintos", () => {
    expect(ECOMMERCE_EXAMPLES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ECOMMERCE_EXAMPLES.map((s) => s.name)).size).toBe(ECOMMERCE_EXAMPLES.length);
  });
  checkAll(ECOMMERCE_EXAMPLES, () => ecommerce);
});

describe("escenarios de ejemplo de Gimnasio", () => {
  it("hay al menos 6, con nombres distintos", () => {
    expect(GYM_EXAMPLES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(GYM_EXAMPLES.map((s) => s.name)).size).toBe(GYM_EXAMPLES.length);
  });
  checkAll(GYM_EXAMPLES, () => gym);
});

describe("exampleScenariosFor", () => {
  it("devuelve los de la plantilla del negocio y nada para las demás", () => {
    expect(exampleScenariosFor("ecommerce")).toBe(ECOMMERCE_EXAMPLES);
    expect(exampleScenariosFor("gym")).toBe(GYM_EXAMPLES);
    expect(exampleScenariosFor("general")).toEqual([]);
    expect(exampleScenariosFor(undefined)).toEqual([]);
  });
});
