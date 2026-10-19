import { beforeAll, describe, expect, it } from "vitest";
import { advanceTime, buildSampleProfiles, changeStage, clientSays, createLabState } from "@/lib/flow-lab";
import { buildCatalogFromTemplates } from "@/lib/flow-lab/from-templates";
import { runScenario } from "@/lib/flow-lab/scenarios/run";
import { stepFromAction, type RecordableAction } from "@/lib/flow-lab/scenarios/from-session";
import type { ClientInput, LabCatalog, LabResult, LabState } from "@/lib/flow-lab/types";
import { CUSTOM_PROFILE_ID, MAX_ENTRIES, buildCustomProfile, defaultCustomProfile, pushEntry, snapshotOf, type LabConfig, type LabEntry } from "./lab-model";
import { configFromScenario, scenarioFromLab, scenarioProfileFromConfig, sessionFromScenario } from "./scenario-bridge";

let catalog: LabCatalog;
beforeAll(async () => {
  catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
});

const NOW = "2026-10-19T15:00:00.000Z";

/** La sesión del laboratorio: lo mismo que hace LabScreen al empezar y al aplicar cada acción. */
class LabSession {
  entries: LabEntry[] = [];
  state: LabState;
  constructor(readonly config: LabConfig) {
    const profile =
      config.profileId === CUSTOM_PROFILE_ID ? buildCustomProfile(config.custom, catalog, NOW) : buildSampleProfiles(catalog, NOW).find((p) => p.id === config.profileId)!;
    this.state = createLabState(catalog, { profile, channel: config.channel, clock: NOW, enabledFlowIds: config.flowIds });
  }
  apply(action: RecordableAction, run: (s: LabState) => LabResult, withStep = true): this {
    const step = stepFromAction(catalog, this.state, action);
    const result = run(this.state);
    expect(result.trace.error).toBeUndefined();
    this.entries = pushEntry(this.entries, { trace: result.trace, snapshot: snapshotOf(catalog, result.state), ...(withStep ? { step } : {}) });
    this.state = result.state;
    return this;
  }
  says(text: string, withStep = true): this {
    const input: ClientInput = { kind: "text", text };
    return this.apply({ type: "client", input }, (s) => clientSays(catalog, s, input), withStep);
  }
}

function config(overrides: Partial<LabConfig> = {}): LabConfig {
  return {
    profileId: buildSampleProfiles(catalog)[0].id, // «Prospecto nuevo»
    custom: defaultCustomProfile(catalog),
    channel: "whatsapp",
    flowIds: catalog.flows.filter((f) => f.status === "published").map((f) => f.id),
    ...overrides,
  };
}

describe("de la sesión del laboratorio a un escenario", () => {
  it("toma las acciones como pasos y propone las expectativas del estado alcanzado", () => {
    const lab = new LabSession(config())
      .says("Hola, ¿precio de la proteína?")
      .apply({ type: "advance", minutes: 5 }, (s) => advanceTime(catalog, s, 5))
      .apply({ type: "stage", stageId: catalog.caseTypes[0].stages.find((s) => s.name === "Esperando pago")!.id }, (s) =>
        changeStage(catalog, s, catalog.caseTypes[0].stages.find((x) => x.name === "Esperando pago")!.id),
      );
    const { definition, notices } = scenarioFromLab({ catalog, config: lab.config, entries: lab.entries, finalState: lab.state, business: "ecommerce" });

    expect(notices).toEqual([]);
    expect(definition.business).toBe("ecommerce");
    expect(definition.profile).toEqual({ kind: "sample", name: "Prospecto nuevo" });
    expect(definition.channel).toBe("whatsapp");
    expect(definition.flows).toBe("published");
    expect(definition.steps).toEqual([
      { type: "client_text", text: "Hola, ¿precio de la proteína?" },
      { type: "advance", minutes: 5 },
      { type: "change_stage", stage: "Esperando pago" },
    ]);
    expect(definition.expectations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "flow_activated", flow: "Catálogo y precios" }),
        expect.objectContaining({ kind: "case_type", caseType: "Venta" }),
        expect.objectContaining({ kind: "case_stage", stage: "Esperando pago" }),
      ]),
    );
    // El escenario guardado se puede correr y cumple lo propuesto.
    const run = runScenario(catalog, { ...definition, startAt: NOW });
    expect(run.result.expectations.filter((e) => !e.ok)).toEqual([]);
  });

  it("el perfil personalizado se guarda por nombre (tipo de contacto, etiquetas, gestión y etapa)", () => {
    const venta = catalog.caseTypes.find((t) => t.name === "Venta")!;
    const custom = {
      ...defaultCustomProfile(catalog),
      name: "Eva",
      contactTypeId: catalog.contactTypes.find((t) => t.name === "Cliente frecuente")!.id,
      tags: "VIP, Mayorista",
      existed: true,
      caseTypeId: venta.id,
      stageId: venta.stages.find((s) => s.name === "Esperando pago")!.id,
      recentInbound: false,
    };
    const profile = scenarioProfileFromConfig(catalog, config({ profileId: CUSTOM_PROFILE_ID, custom }));
    expect(profile).toEqual({ kind: "custom", name: "Eva", contactType: "Cliente frecuente", tags: ["VIP", "Mayorista"], existed: true, caseType: "Venta", stage: "Esperando pago", recentInbound: false });
    expect(JSON.stringify(profile)).not.toMatch(/cot-|ct-|cs-/);
  });

  it("si solo participan algunos flujos, se guardan sus nombres", () => {
    const one = catalog.flows.find((f) => f.name === "Darse de baja")!;
    const lab = new LabSession(config({ flowIds: [one.id] })).says("baja");
    const { definition } = scenarioFromLab({ catalog, config: lab.config, entries: lab.entries, finalState: lab.state, business: null });
    expect(definition.flows).toEqual(["Darse de baja"]);
    expect(definition.business).toBeNull();
    expect(definition.expectations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "subscribed", subscribed: false })]));
  });

  it("avisa de las acciones hechas antes de que se guardaran los pasos", () => {
    const lab = new LabSession(config()).says("precio", false).says("asesor");
    const { definition, notices } = scenarioFromLab({ catalog, config: lab.config, entries: lab.entries, finalState: lab.state, business: null });
    expect(definition.steps).toEqual([{ type: "client_text", text: "asesor" }]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("Una acción de esta prueba se hizo antes de que el laboratorio guardara los pasos");
  });

  it("avisa si la prueba llegó al límite de acciones que recuerda el laboratorio", () => {
    const lab = new LabSession(config());
    for (let i = 0; i < MAX_ENTRIES; i++) lab.apply({ type: "advance", minutes: 1 }, (s) => advanceTime(catalog, s, 1));
    const { notices } = scenarioFromLab({ catalog, config: lab.config, entries: lab.entries, finalState: lab.state, business: null });
    expect(notices.some((n) => n.includes(`últimas ${MAX_ENTRIES} acciones`))).toBe(true);
  });
});

describe("de un escenario a la sesión del laboratorio (abrir y reproducir)", () => {
  it("reproduce los pasos: mismas acciones, mismo estado y entradas con su paso", () => {
    const lab = new LabSession(config()).says("precio").apply({ type: "advance", minutes: 10 }, (s) => advanceTime(catalog, s, 10));
    const { definition } = scenarioFromLab({ catalog, config: lab.config, entries: lab.entries, finalState: lab.state, business: "ecommerce" });
    const replay = sessionFromScenario(catalog, { ...definition, startAt: NOW }, NOW);
    if (!replay.ok) throw new Error(replay.error);

    expect(replay.notices).toEqual([]);
    expect(replay.session.entries).toHaveLength(2);
    expect(replay.session.entries.map((e) => e.step)).toEqual(definition.steps);
    expect(replay.session.entries.map((e) => e.trace.action)).toEqual(["clientSays", "advanceTime"]);
    expect(replay.session.state.messages.map((m) => m.text)).toEqual(lab.state.messages.map((m) => m.text));
    expect(replay.session.state.clock).toBe(lab.state.clock);
    expect(replay.session.config.profileId).toBe(lab.config.profileId);
    expect(replay.session.state.enabledFlowIds).toEqual(lab.config.flowIds);
    expect(replay.session.initialSnapshot.length).toBeGreaterThan(0);
  });

  it("un perfil que ya no existe pasa a personalizado y se avisa", () => {
    const { config: cfg, notices } = configFromScenario(catalog, {
      version: 1,
      business: null,
      profile: { kind: "sample", name: "Perfil que no existe" },
      channel: "instagram",
      flows: ["Darse de baja", "Flujo borrado"],
      steps: [],
      expectations: [],
    });
    expect(cfg.profileId).toBe(CUSTOM_PROFILE_ID);
    expect(cfg.channel).toBe("instagram");
    expect(cfg.flowIds).toEqual([catalog.flows.find((f) => f.name === "Darse de baja")!.id]);
    expect(notices).toEqual(["El flujo «Flujo borrado» ya no existe.", "El perfil «Perfil que no existe» no existe: se usa un contacto personalizado."]);
  });

  it("si un paso ya no se puede aplicar, la prueba queda hasta el paso anterior y se avisa", () => {
    const replay = sessionFromScenario(
      catalog,
      {
        version: 1,
        business: null,
        profile: { kind: "sample", name: "Prospecto nuevo" },
        channel: "whatsapp",
        flows: "published",
        steps: [
          { type: "client_text", text: "precio" },
          { type: "change_stage", stage: "Etapa que ya no existe" },
        ],
        expectations: [],
      },
      NOW,
    );
    if (!replay.ok) throw new Error(replay.error);
    expect(replay.session.entries).toHaveLength(1);
    expect(replay.notices).toEqual(["El paso 2 («El asesor mueve la gestión a «Etapa que ya no existe»») no se pudo aplicar: El tipo «Venta» no tiene una etapa «Etapa que ya no existe». La prueba quedó hasta el paso anterior."]);
  });

  it("un escenario que no puede arrancar devuelve el motivo", () => {
    const replay = sessionFromScenario(catalog, { version: 1, business: null, profile: { kind: "sample", name: "Nadie" }, channel: "whatsapp", flows: "published", steps: [], expectations: [] }, NOW);
    expect(replay).toEqual({ ok: false, error: "No existe el perfil de ejemplo «Nadie»." });
  });
});
