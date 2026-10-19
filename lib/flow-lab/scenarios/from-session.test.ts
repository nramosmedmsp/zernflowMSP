import { beforeAll, describe, expect, it } from "vitest";
import { advanceTime, agentReplies, assign, changeStage, classify, clientSays, closeCase, setBotPaused, setCategory } from "../actions";
import { buildCatalogFromTemplates } from "../from-templates";
import { createLabState } from "../state";
import type { ClientInput, LabCatalog, LabResult, LabState } from "../types";
import { proposeExpectations, scenarioFromSession, stepFromAction, flowsFromIds, type RecordableAction } from "./from-session";
import { runScenario } from "./run";
import type { ScenarioStep } from "./types";

let catalog: LabCatalog;
beforeAll(async () => {
  catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
});

const START = "2026-10-19T15:00:00.000Z";

/** Hace lo que el laboratorio: aplica la acción y guarda el paso con el estado anterior. */
class Recorder {
  state: LabState;
  steps: ScenarioStep[] = [];
  constructor(initial: LabState) {
    this.state = initial;
  }
  do(action: RecordableAction, run: (s: LabState) => LabResult): this {
    this.steps.push(stepFromAction(catalog, this.state, action));
    const result = run(this.state);
    expect(result.trace.error).toBeUndefined();
    this.state = result.state;
    return this;
  }
  says(text: string): this {
    const input: ClientInput = { kind: "text", text };
    return this.do({ type: "client", input }, (s) => clientSays(catalog, s, input));
  }
  press(title: string, payload: string): this {
    const input: ClientInput = { kind: "button", title, payload };
    return this.do({ type: "client", input }, (s) => clientSays(catalog, s, input));
  }
}

const stage = (name: string) => catalog.caseTypes.flatMap((t) => t.stages).find((s) => s.name === name)!.id;
const caseType = (name: string) => catalog.caseTypes.find((t) => t.name === name)!;
const member = (name: string) => catalog.members.find((m) => m.name === name)!.userId;

describe("stepFromAction: la acción del laboratorio como paso, con nombres", () => {
  it("el cliente, el tiempo y el asesor", () => {
    const state = createLabState(catalog, { clock: START });
    expect(stepFromAction(catalog, state, { type: "client", input: { kind: "text", text: "hola" } })).toEqual({ type: "client_text", text: "hola" });
    expect(stepFromAction(catalog, state, { type: "client", input: { kind: "button", title: "Mi pedido", payload: "mi_pedido" } })).toEqual({ type: "client_button", title: "Mi pedido", payload: "mi_pedido" });
    expect(stepFromAction(catalog, state, { type: "client", input: { kind: "button", payload: "x", buttonType: "quick_reply" } })).toEqual({ type: "client_button", title: "x", payload: "x", buttonType: "quick_reply" });
    expect(stepFromAction(catalog, state, { type: "advance", minutes: 90 })).toEqual({ type: "advance", minutes: 90 });
    expect(stepFromAction(catalog, state, { type: "reply", text: "Hola", agentId: member("Ana") })).toEqual({ type: "agent_reply", text: "Hola", agent: "Ana" });
    expect(stepFromAction(catalog, state, { type: "reply", text: "Hola", agentId: null })).toEqual({ type: "agent_reply", text: "Hola", agent: null });
    expect(stepFromAction(catalog, state, { type: "pause", paused: true })).toEqual({ type: "pause_bot", paused: true });
  });

  it("etapa, clasificación, categoría, responsable y cierre usan nombres, no ids", () => {
    const after = new Recorder(createLabState(catalog, { clock: START, contact: { existed: false } })).says("precio").state;
    expect(stepFromAction(catalog, after, { type: "stage", stageId: stage("Esperando pago") })).toEqual({ type: "change_stage", stage: "Esperando pago" });
    expect(stepFromAction(catalog, after, { type: "classify", caseTypeId: caseType("Postventa").id })).toEqual({ type: "classify", caseType: "Postventa" });
    expect(stepFromAction(catalog, after, { type: "assign", memberId: member("Beto") })).toEqual({ type: "assign", member: "Beto" });
    expect(stepFromAction(catalog, after, { type: "assign", memberId: null })).toEqual({ type: "assign", member: null });
    // La categoría y el motivo son los del tipo de la gestión abierta: aquí Postventa, que tiene categorías.
    const postventa = new Recorder(createLabState(catalog, { clock: START, contact: { existed: false } })).says("precio").do({ type: "classify", caseTypeId: caseType("Postventa").id }, (s) => classify(catalog, s, caseType("Postventa").id)).state;
    const category = caseType("Postventa").categories[0];
    expect(stepFromAction(catalog, postventa, { type: "category", categoryId: category.id })).toEqual({ type: "set_category", category: category.name });
    expect(stepFromAction(catalog, postventa, { type: "category", categoryId: null })).toEqual({ type: "set_category", category: null });
    const resolved = caseType("Postventa").stages.find((s) => s.kind === "resolved")!;
    expect(stepFromAction(catalog, postventa, { type: "close", input: { stageId: resolved.id, categoryId: category.id, keyDate: "2026-12-01", note: "ok", scheduleOverride: { skip: true } } })).toEqual({
      type: "close",
      stage: resolved.name,
      category: category.name,
      keyDate: "2026-12-01",
      note: "ok",
      skipSchedule: true,
    });
    const lost = caseType("Venta").stages.find((s) => s.kind === "lost")!;
    const reason = caseType("Venta").reasons[0];
    expect(stepFromAction(catalog, after, { type: "close", input: { stageId: lost.id, outcomeReasonId: reason.id } })).toEqual({ type: "close", stage: lost.name, reason: reason.name });
    expect(stepFromAction(catalog, after, { type: "close", input: { kind: "lost" } })).toEqual({ type: "close", outcome: "lost" });
  });
});

describe("de la prueba al escenario", () => {
  function advisorFlow(): Recorder {
    const r = new Recorder(createLabState(catalog, { clock: START, contact: { existed: false } }));
    return r
      .says("precio")
      .says("quiero hablar con un asesor")
      .do({ type: "advance", minutes: 3 }, (s) => advanceTime(catalog, s, 3))
      .do({ type: "reply", text: "Hola Lucía", agentId: member("Ana") }, (s) => agentReplies(catalog, s, "Hola Lucía", { agentId: member("Ana") }))
      .do({ type: "pause", paused: false }, (s) => setBotPaused(catalog, s, false))
      .do({ type: "stage", stageId: stage("Pedido o enlace de pago enviado") }, (s) => changeStage(catalog, s, stage("Pedido o enlace de pago enviado")));
  }

  it("las acciones son los pasos y el escenario guardado reproduce el mismo estado", () => {
    const r = advisorFlow();
    const definition = scenarioFromSession({
      catalog,
      profile: { kind: "custom", name: "Lucía", contactType: null, tags: [], existed: false, caseType: null, stage: null, recentInbound: true },
      channel: "whatsapp",
      flowIds: catalog.flows.filter((f) => f.status === "published").map((f) => f.id),
      business: "ecommerce",
      steps: r.steps,
      finalState: r.state,
    });
    expect(definition.flows).toBe("published");
    expect(definition.steps.map((s) => s.type)).toEqual(["client_text", "client_text", "advance", "agent_reply", "pause_bot", "change_stage"]);
    // Con el mismo reloj y los mismos pasos, reproducir da el mismo resultado: todas las propuestas se cumplen.
    const run = runScenario(catalog, { ...definition, startAt: START });
    expect(run.result.expectations.filter((e) => !e.ok)).toEqual([]);
    expect(run.result.ok).toBe(true);
    expect(run.finalState?.messages.map((m) => m.text)).toEqual(r.state.messages.map((m) => m.text));
    expect(run.finalState?.cases.map((c) => [c.caseTypeId, c.stageId, c.status])).toEqual(r.state.cases.map((c) => [c.caseTypeId, c.stageId, c.status]));
  });

  it("propone expectativas a partir del estado alcanzado, con nombres", () => {
    const r = advisorFlow();
    const proposals = proposeExpectations(catalog, r.state);
    const kinds = proposals.map((p) => p.kind);
    expect(kinds).toEqual(expect.arrayContaining(["flow_activated", "bot_message_contains", "case_type", "case_stage", "case_status", "assigned", "contact_type"]));
    expect(proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "flow_activated", flow: "Hablar con un asesor" }),
        expect.objectContaining({ kind: "flow_activated", flow: "Datos de pago" }),
        expect.objectContaining({ kind: "case_type", caseType: "Venta" }),
        expect.objectContaining({ kind: "case_stage", stage: "Esperando pago" }),
        expect.objectContaining({ kind: "case_status", status: "open" }),
        expect.objectContaining({ kind: "contact_type", contactType: "Prospecto" }),
      ]),
    );
    // Ningún id interno se filtra al escenario.
    expect(JSON.stringify(proposals)).not.toMatch(/\b(ct|cs|cot)-\d+\b|u-ana|u-beto/);
    // Ids únicos y «al final».
    expect(new Set(proposals.map((p) => p.id)).size).toBe(proposals.length);
    expect(proposals.every((p) => p.after === null)).toBe(true);
    // El último mensaje del bot se propone con su primera línea.
    const lastBot = [...r.state.messages].reverse().find((m) => m.author === "bot")!;
    const contains = proposals.find((p) => p.kind === "bot_message_contains") as { text: string };
    expect(lastBot.text).toContain(contains.text.slice(0, 20));
    expect(contains.text.length).toBeLessThanOrEqual(60);
  });

  it("propone la gestión programada, las etiquetas, los campos y la baja", () => {
    const r = new Recorder(createLabState(catalog, { clock: START, contact: { existed: false } }))
      .says("precio")
      .says("asesor")
      .do({ type: "close", input: { kind: "won" } }, (s) => closeCase(catalog, s, { kind: "won" }));
    r.do({ type: "client", input: { kind: "text", text: "baja" } }, (s) => clientSays(catalog, s, { kind: "text", text: "baja" }));
    const proposals = proposeExpectations(catalog, r.state);
    expect(proposals).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "scheduled_case", caseType: "Recompra", inDays: 25 }), expect.objectContaining({ kind: "subscribed", subscribed: false })]));
    const run = runScenario(catalog, scenarioFromSession({ catalog, profile: { kind: "custom", name: "Lucía", contactType: null, tags: [], existed: false, caseType: null, stage: null, recentInbound: true }, channel: "whatsapp", flowIds: [], business: null, steps: r.steps, finalState: r.state }));
    // Con flowIds vacío solo participan los flujos que se nombran: ninguno, así que no se compara el comportamiento.
    expect(run.result.stepError).toBeNull();
  });

  it("flowsFromIds: «published» si son los publicados, nombres si se eligió otra cosa", () => {
    const published = catalog.flows.map((f) => f.id);
    expect(flowsFromIds(catalog, published)).toBe("published");
    expect(flowsFromIds(catalog, published.slice(0, 2))).toEqual(catalog.flows.slice(0, 2).map((f) => f.name));
  });

  it("usa el resto de acciones: clasificar, categoría y asignar", () => {
    const r = new Recorder(createLabState(catalog, { clock: START, contact: { existed: false } }))
      .says("hola")
      .do({ type: "classify", caseTypeId: caseType("Postventa").id }, (s) => classify(catalog, s, caseType("Postventa").id))
      .do({ type: "category", categoryId: caseType("Postventa").categories[0].id }, (s) => setCategory(catalog, s, caseType("Postventa").categories[0].id))
      .do({ type: "assign", memberId: member("Beto") }, (s) => assign(catalog, s, member("Beto")));
    expect(r.steps.slice(1)).toEqual([
      { type: "classify", caseType: "Postventa" },
      { type: "set_category", category: caseType("Postventa").categories[0].name },
      { type: "assign", member: "Beto" },
    ]);
  });
});
