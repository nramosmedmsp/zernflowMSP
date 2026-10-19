import { beforeAll, describe, expect, it } from "vitest";
import { buildCatalogFromTemplates } from "../from-templates";
import type { LabCatalog } from "../types";
import { describeExpectation, describeStep } from "./describe";
import { runScenario } from "./run";
import { SCENARIO_VERSION, type ExpectationCheck, type ScenarioDefinition, type ScenarioExpectation, type ScenarioStep } from "./types";
import { parseScenarioDefinition } from "./validate";

let catalog: LabCatalog;
beforeAll(async () => {
  catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
});

const START = "2026-10-19T15:00:00.000Z";

function scenario(steps: ScenarioStep[], expectations: Array<ExpectationCheck & { after?: number | null }>, extra: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return {
    version: SCENARIO_VERSION,
    business: "ecommerce",
    profile: { kind: "custom", name: "Lucía", contactType: null, tags: [], existed: false, caseType: null, stage: null, recentInbound: true },
    channel: "whatsapp",
    flows: "published",
    startAt: START,
    steps,
    expectations: expectations.map((e, i): ScenarioExpectation => ({ id: `e${i + 1}`, after: null, ...e })),
    ...extra,
  };
}

const ADVISOR: ScenarioStep[] = [
  { type: "client_text", text: "precio" },
  { type: "client_text", text: "asesor" },
  { type: "advance", minutes: 3 },
  { type: "agent_reply", text: "Hola Lucía" },
];

describe("ejecutor: expectativas que pasan", () => {
  it("cada tipo de expectativa se cumple en una conversación completa", () => {
    const def = scenario(
      [...ADVISOR, { type: "close", outcome: "won" }],
      [
        { kind: "flow_activated", flow: "catalogo y precios" }, // sin tildes ni mayúsculas
        { kind: "flow_activated", flow: "Gracias por tu compra", scope: "step", after: 5 },
        { kind: "bot_message_contains", text: "catálogo con los PRECIOS" },
        { kind: "bot_message_contains", text: "Gracias por tu compra", scope: "step", after: 5 },
        { kind: "case_stage", stage: "Asesorando", after: 1 },
        { kind: "case_type", caseType: "Venta", after: 1 },
        { kind: "case_status", status: "open", after: 1 },
        { kind: "case_status", status: "won", of: "Venta" },
        { kind: "assigned", assigned: true, of: "Venta" },
        { kind: "contact_type", contactType: "Cliente" },
        { kind: "bot_paused", paused: false },
        { kind: "bot_paused", paused: true, after: 4 },
        { kind: "scheduled_case", caseType: "Recompra", inDays: 25 },
        { kind: "case_status", status: "scheduled", of: "Recompra" },
        { kind: "subscribed", subscribed: true },
        { kind: "tag", tag: "VIP", present: false },
        { kind: "nothing_sent", after: 3 },
      ],
    );
    const run = runScenario(catalog, def);
    expect(run.result.expectations.filter((e) => !e.ok)).toEqual([]);
    expect(run.result).toMatchObject({ ok: true, total: 17, passed: 17, failed: 0, stepError: null });
    expect(run.traces).toHaveLength(5);
    expect(run.states).toHaveLength(5);
    expect(run.finalState).toBe(run.states[4]);
  });

  it("un escenario sin expectativas pasa si todos los pasos se aplican", () => {
    const run = runScenario(catalog, scenario([{ type: "client_text", text: "hola" }], []));
    expect(run.result).toMatchObject({ ok: true, total: 0, stepError: null });
  });
});

describe("ejecutor: expectativas que fallan dicen lo esperado y lo obtenido", () => {
  let run: ReturnType<typeof runScenario>;
  beforeAll(() => {
  run = runScenario(
    catalog,
    scenario(
      [{ type: "client_text", text: "precio" }],
      [
        { kind: "case_stage", stage: "Esperando pago" },
        { kind: "bot_message_contains", text: "texto que no existe" },
        { kind: "flow_activated", flow: "Darse de baja" },
        { kind: "tag", tag: "VIP", present: true },
        { kind: "assigned", assigned: true },
        { kind: "subscribed", subscribed: false },
        { kind: "scheduled_case", caseType: "Recompra", inDays: 25 },
        { kind: "template_sent", name: "recordatorio_pago" },
        { kind: "case_status", status: "won" },
        { kind: "nothing_sent" },
        { kind: "flow_activated", flow: "Flujo inventado" },
        { kind: "case_stage", stage: "Etapa", of: "Tipo inventado" },
      ],
    ),
  );
  });
  const byId = (n: number) => run.result.expectations[n - 1];

  it("la etapa dice cuál esperaba y cuál obtuvo", () => {
    expect(byId(1)).toMatchObject({ ok: false, expected: "«Esperando pago»", actual: "«Asesorando»" });
  });
  it("el mensaje lista lo que sí envió el bot", () => {
    expect(byId(2).ok).toBe(false);
    expect(byId(2).expected).toBe("un mensaje del bot con «texto que no existe»");
    expect(byId(2).actual).toContain("mensajes del bot: «Aquí puedes ver nuestro catálogo");
  });
  it("el flujo dice cuáles se activaron", () => {
    expect(byId(3)).toMatchObject({ ok: false, actual: "flujos activados: «Catálogo y precios»" });
  });
  it("etiqueta, responsable, suscripción, programada, plantilla y estado", () => {
    expect(byId(4)).toMatchObject({ ok: false, expected: "con la etiqueta «VIP»", actual: "sin etiquetas" });
    expect(byId(6)).toMatchObject({ ok: false, expected: "dado de baja", actual: "suscrito" });
    expect(byId(7)).toMatchObject({ ok: false, actual: "no hay ninguna gestión de «Recompra» programada" });
    expect(byId(8)).toMatchObject({ ok: false, actual: "no se envió ninguna plantilla" });
    expect(byId(9)).toMatchObject({ ok: false, expected: "ganada", actual: "abierta" });
  });
  it("«no se envió nada» muestra el mensaje que sí salió", () => {
    expect(byId(10).ok).toBe(false);
    expect(byId(10).expected).toBe("ningún mensaje del bot");
    expect(byId(10).actual).toContain("catálogo");
  });
  it("lo que no existe en el espacio lo dice claro", () => {
    expect(byId(11).actual).toBe("el espacio no tiene un flujo «Flujo inventado»");
    expect(byId(12).actual).toBe("El espacio no tiene un tipo de gestión «Tipo inventado».");
  });
  it("el resultado cuenta cumplidas e incumplidas", () => {
    expect(run.result.ok).toBe(false);
    expect(run.result.passed + run.result.failed).toBe(12);
    expect(run.result.failed).toBeGreaterThanOrEqual(10);
  });
});

describe("ejecutor: el momento de la comprobación", () => {
  it("una expectativa tras un paso se mira con el estado de ese paso, no el final", () => {
    const run = runScenario(
      catalog,
      scenario(
        [
          { type: "client_text", text: "precio" },
          { type: "change_stage", stage: "Esperando pago" },
        ],
        [
          { kind: "case_stage", stage: "Asesorando", after: 1 },
          { kind: "case_stage", stage: "Asesorando" }, // al final ya no
          { kind: "case_stage", stage: "Esperando pago" },
        ],
      ),
    );
    expect(run.result.expectations.map((e) => e.ok)).toEqual([true, false, true]);
    expect(run.result.expectations[1].actual).toBe("«Esperando pago»");
  });

  it("«en ese paso» ignora lo que se envió antes", () => {
    const run = runScenario(
      catalog,
      scenario(
        [
          { type: "client_text", text: "precio" },
          { type: "client_text", text: "baja" },
        ],
        [
          { kind: "bot_message_contains", text: "catálogo", scope: "step", after: 2 },
          { kind: "bot_message_contains", text: "catálogo" },
        ],
      ),
    );
    expect(run.result.expectations.map((e) => e.ok)).toEqual([false, true]);
  });

  it("un paso que no existe falla con un mensaje claro", () => {
    const run = runScenario(catalog, scenario([{ type: "client_text", text: "hola" }], [{ kind: "bot_paused", paused: false, after: 4 }]));
    expect(run.result.expectations[0]).toMatchObject({ ok: false, actual: "El paso 4 no existe: el escenario tiene 1 paso." });
  });
});

describe("ejecutor: pasos que no se pueden aplicar", () => {
  it("se detiene en el paso con error y las expectativas pendientes quedan sin comprobar", () => {
    const run = runScenario(
      catalog,
      scenario(
        [
          { type: "client_text", text: "precio" },
          { type: "change_stage", stage: "Etapa inventada" },
          { type: "client_text", text: "hola" },
        ],
        [
          { kind: "case_stage", stage: "Asesorando", after: 1 },
          { kind: "case_stage", stage: "Asesorando" },
        ],
      ),
    );
    expect(run.result.stepError).toEqual({
      step: 2,
      text: "El asesor mueve la gestión a «Etapa inventada»",
      message: "El tipo «Venta» no tiene una etapa «Etapa inventada».",
    });
    expect(run.result.ok).toBe(false);
    expect(run.result.expectations[0].ok).toBe(true);
    expect(run.result.expectations[1]).toMatchObject({ ok: false, actual: "No se pudo comprobar: el paso 2 no se pudo aplicar." });
    expect(run.traces).toHaveLength(1);
  });

  it("el error del simulador (sin gestión abierta) se muestra tal cual", () => {
    const run = runScenario(catalog, scenario([{ type: "close", outcome: "won" }], [], { profile: { kind: "custom", name: "Ana", contactType: null, tags: [], existed: true, caseType: null, stage: null, recentInbound: true } }));
    expect(run.result.stepError?.message).toBe("No hay una gestión abierta para cerrar.");
  });
});

describe("resolución por nombre", () => {
  it("encuentra tipos, etapas y personas sin importar mayúsculas ni tildes", () => {
    const run = runScenario(
      catalog,
      scenario(
        [
          { type: "client_text", text: "hola" },
          { type: "classify", caseType: "VENTA" },
          { type: "change_stage", stage: "esperando PAGO" },
          { type: "assign", member: "ana" },
          { type: "agent_reply", text: "Hola", agent: "BETO" },
        ],
        [
          { kind: "case_stage", stage: "Esperando pago" },
          { kind: "assigned", assigned: true, member: "Ana" },
        ],
      ),
    );
    expect(run.result.stepError).toBeNull();
    expect(run.result.ok).toBe(true);
  });

  it("sobrevive a un catálogo con otros ids: los nombres son lo que cuenta", () => {
    // Mismo espacio pero con todos los ids de tipos, etapas, categorías, motivos y tipos de contacto cambiados.
    const remapped = JSON.parse(JSON.stringify(catalog).replace(/\b(ct|cs|cc|cr|cot|rule)-(\d+)\b/g, "nuevo_$1_$2")) as LabCatalog;
    expect(remapped.caseTypes[0].id).not.toBe(catalog.caseTypes[0].id);
    expect(remapped.caseTypes[0].stages[0].id).not.toBe(catalog.caseTypes[0].stages[0].id);
    const def = scenario(
      [{ type: "client_text", text: "precio" }, { type: "change_stage", stage: "Esperando pago" }, { type: "assign", member: "Beto" }],
      [{ kind: "case_stage", stage: "Esperando pago" }, { kind: "assigned", assigned: true, member: "Beto" }, { kind: "case_type", caseType: "Venta" }],
    );
    expect(runScenario(catalog, def).result.ok).toBe(true);
    expect(runScenario(remapped, def).result.ok).toBe(true);
    // Un miembro que ya no existe: el paso dice cuál nombre falta.
    const missing = runScenario(remapped, scenario([{ type: "client_text", text: "precio" }, { type: "assign", member: "Zacarías" }], []));
    expect(missing.result.stepError?.message).toBe("El espacio no tiene a un miembro llamado «Zacarías».");
  });

  it("perfil de ejemplo por nombre y perfil inexistente", () => {
    const sample = runScenario(catalog, scenario([], [{ kind: "case_stage", stage: "Esperando pago" }], { profile: { kind: "sample", name: "cliente con venta en «esperando pago»" } }));
    expect(sample.result.ok).toBe(true);
    const missing = runScenario(catalog, scenario([], [{ kind: "bot_paused", paused: false }], { profile: { kind: "sample", name: "No existe" } }));
    expect(missing.result.stepError).toEqual({ step: 0, text: "Punto de partida", message: "No existe el perfil de ejemplo «No existe»." });
    expect(missing.result.expectations[0]).toMatchObject({ ok: false, actual: "No se pudo comprobar porque el escenario no pudo correr." });
    expect(missing.initialState).toBeNull();
  });

  it("perfil personalizado con tipo de contacto, etiquetas y gestión inicial por nombre", () => {
    const run = runScenario(
      catalog,
      scenario([], [{ kind: "contact_type", contactType: "Cliente frecuente" }, { kind: "tag", tag: "vip", present: true }, { kind: "case_stage", stage: "Esperando pago" }], {
        profile: { kind: "custom", name: "Eva", contactType: "Cliente frecuente", tags: ["VIP"], existed: true, caseType: "Venta", stage: "Esperando pago", recentInbound: true },
      }),
    );
    expect(run.result.ok).toBe(true);
    expect(runScenario(catalog, scenario([], [], { profile: { kind: "custom", name: "Eva", contactType: "No existe", tags: [], existed: true, caseType: null, stage: null, recentInbound: true } })).result.stepError?.message).toBe(
      "El espacio no tiene un tipo de contacto «No existe».",
    );
  });

  it("los flujos que participan se eligen por nombre (también borradores) y se avisa del que falta", () => {
    // Solo «Darse de baja» participa: «precio» ya no dispara el catálogo.
    const only = runScenario(catalog, scenario([{ type: "client_text", text: "precio" }], [{ kind: "flow_activated", flow: "Catálogo y precios" }], { flows: ["Darse de baja"] }));
    expect(only.result.expectations[0].ok).toBe(false);
    const missing = runScenario(catalog, scenario([], [], { flows: ["Darse de baja", "Flujo borrado"] }));
    expect(missing.result.stepError?.message).toBe("No existe el flujo «Flujo borrado».");
  });

  it("un cierre con motivo o categoría que no existe lo dice", () => {
    const run = runScenario(catalog, scenario([{ type: "client_text", text: "precio" }, { type: "close", outcome: "lost", reason: "Motivo raro" }], []));
    expect(run.result.stepError?.message).toBe("El tipo de la gestión no tiene un motivo «Motivo raro».");
  });
});

describe("textos y validación", () => {
  it("describe pasos y expectativas en español", () => {
    expect(describeStep({ type: "advance", minutes: 120 })).toBe("Pasan 2 h");
    expect(describeStep({ type: "advance", minutes: 25 * 1440 })).toBe("Pasan 25 días");
    expect(describeStep({ type: "close", outcome: "won", reason: "Pagó" })).toBe("El asesor cierra la gestión como ganada (motivo «Pagó»)");
    expect(describeExpectation({ id: "e1", kind: "scheduled_case", caseType: "Recompra", inDays: 25 })).toBe("Hay una gestión de «Recompra» programada para dentro de 25 días");
    expect(describeExpectation({ id: "e1", kind: "case_status", status: "won", of: "Venta" })).toBe("La gestión (gestión de Venta) está ganada");
  });

  it("parseScenarioDefinition acepta lo válido y explica lo que no", () => {
    const def = scenario([{ type: "client_text", text: "hola" }], [{ kind: "bot_paused", paused: false, after: 1 }]);
    const ok = parseScenarioDefinition(JSON.parse(JSON.stringify(def)));
    expect(ok).toEqual({ ok: true, value: def });
    expect(parseScenarioDefinition(null)).toEqual({ ok: false, error: "El escenario no es válido." });
    expect(parseScenarioDefinition({ ...def, version: 2 })).toMatchObject({ ok: false });
    expect(parseScenarioDefinition({ ...def, steps: [{ type: "advance", minutes: -3 }] })).toEqual({ ok: false, error: "Paso 1: Los minutos deben ser más de cero." });
    expect(parseScenarioDefinition({ ...def, steps: [{ type: "volar" }] })).toEqual({ ok: false, error: "Paso 1: Tipo de paso desconocido." });
    expect(parseScenarioDefinition({ ...def, expectations: [{ id: "x", kind: "bot_paused", paused: true, after: 9 }] })).toEqual({ ok: false, error: "Expectativa 1: El paso 9 no existe." });
    expect(parseScenarioDefinition({ ...def, expectations: [{ kind: "case_status", status: "rara" }] })).toEqual({ ok: false, error: "Expectativa 1: El estado no es válido." });
    expect(parseScenarioDefinition({ ...def, profile: { kind: "otro" } })).toEqual({ ok: false, error: "El perfil inicial no es válido." });
  });

  it("repara ids de expectativas repetidos o ausentes", () => {
    const def = scenario([], []);
    const parsed = parseScenarioDefinition({ ...def, expectations: [{ id: "a", kind: "nothing_sent" }, { id: "a", kind: "nothing_sent" }, { kind: "nothing_sent" }] });
    expect(parsed.ok && parsed.value.expectations.map((e) => e.id)).toEqual(["a", "a_", "e3"]);
  });
});
