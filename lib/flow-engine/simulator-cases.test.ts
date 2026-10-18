import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { simulateFlow } from "./simulator";

function chain(nodes: Node[]): { nodes: Node[]; edges: Edge[] } {
  const edges: Edge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ id: `e${i}`, source: nodes[i].id, target: nodes[i + 1].id });
  }
  return { nodes, edges };
}

const trigger = (data: Record<string, unknown> = { triggerType: "keyword", keywords: [] }): Node => ({
  id: "t",
  type: "trigger",
  position: { x: 0, y: 0 },
  data,
});
const action = (id: string, data: Record<string, unknown>): Node => ({
  id,
  type: "action",
  position: { x: 0, y: 0 },
  data,
});

describe("simulador: nodos de gestión", () => {
  it("clasificar, cambiar etapa, asignar y repartir muestran su texto", () => {
    const { nodes, edges } = chain([
      trigger(),
      action("a", { actionType: "classifyCase", caseTypeId: "t1", caseTypeName: "Venta", stageId: "s2", stageName: "Cotizado" }),
      action("b", { actionType: "changeStage", stageId: "s3", stageName: "Cierre" }),
      action("c", { actionType: "assignTeam", mode: "fixed", teamId: "team1", teamName: "Miraflores" }),
      action("d", { actionType: "assignTeam", mode: "reroute" }),
      action("e", { actionType: "distributeCase" }),
    ]);
    const result = simulateFlow(nodes, edges, { incomingMessage: "hola" });
    const details = result.steps.flatMap((s) => (s.result.type === "action" ? [s.result.detail] : []));
    expect(details).toEqual([
      'Clasificaría la gestión como "Venta" y la pasaría a la etapa "Cotizado"',
      'Cambiaría la etapa de la gestión a "Cierre"',
      'Asignaría la gestión al equipo "Miraflores" y la repartiría a un asesor del equipo',
      "Volvería a calcular el equipo según el tipo de gestión y el contacto, y repartiría la gestión a un asesor del equipo",
      "La gestión ya tiene responsable: no cambiaría nada",
    ]);
    expect(result.completed).toBe(true);
  });

  it("avisa cuando falta configurar el nodo", () => {
    const { nodes, edges } = chain([trigger(), action("a", { actionType: "classifyCase" })]);
    const result = simulateFlow(nodes, edges, { incomingMessage: "hola" });
    expect(result.steps[1].result).toMatchObject({ type: "error" });
  });

  it("sin gestión abierta, el nodo dice que abriría una", () => {
    const { nodes, edges } = chain([trigger(), action("a", { actionType: "changeStage", stageId: "s1", stageName: "Nueva" })]);
    const result = simulateFlow(nodes, edges, { incomingMessage: "hola", mockCase: { hasOpenCase: false } });
    expect(result.steps[1].result).toMatchObject({ type: "action" });
    expect((result.steps[1].result as { detail: string }).detail).toContain("abriría una");
  });

  it("los disparadores de gestión coinciden siempre en la prueba", () => {
    const { nodes, edges } = chain([trigger({ triggerType: "case_closed", outcome: "won" }), action("a", { actionType: "distributeCase" })]);
    const result = simulateFlow(nodes, edges, { incomingMessage: "" });
    expect(result.steps[0].result).toMatchObject({ type: "trigger", matched: true, triggerType: "case_closed" });
  });
});

describe("simulador: condiciones de gestión", () => {
  function conditionFlow(conditions: Array<{ field: string; operator: string; value: string }>, before: Node[] = []) {
    const cond: Node = { id: "c", type: "condition", position: { x: 0, y: 0 }, data: { conditions, logic: "and" } };
    const yes: Node = action("yes", { actionType: "distributeCase" });
    const no: Node = action("no", { actionType: "changeStage", stageId: "x", stageName: "No" });
    const nodes = [trigger(), ...before, cond, yes, no];
    const edges: Edge[] = [];
    const seq = [nodes[0], ...before, cond];
    for (let i = 0; i < seq.length - 1; i++) edges.push({ id: `e${i}`, source: seq[i].id, target: seq[i + 1].id });
    edges.push({ id: "y", source: "c", target: "yes", sourceHandle: "true" });
    edges.push({ id: "n", source: "c", target: "no", sourceHandle: "false" });
    return { nodes, edges };
  }

  it("lee la gestión simulada", () => {
    const { nodes, edges } = conditionFlow([{ field: "case_type", operator: "equals", value: "t1" }]);
    const yes = simulateFlow(nodes, edges, { incomingMessage: "x", mockCase: { caseTypeId: "t1" } });
    const no = simulateFlow(nodes, edges, { incomingMessage: "x", mockCase: { caseTypeId: "t2" } });
    expect(yes.steps.some((s) => s.nodeId === "yes")).toBe(true);
    expect(no.steps.some((s) => s.nodeId === "no")).toBe(true);
  });

  it("dentro de horario y tiene responsable", () => {
    const { nodes, edges } = conditionFlow([
      { field: "within_hours", operator: "equals", value: "true" },
      { field: "has_assignee", operator: "equals", value: "false" },
    ]);
    const open = simulateFlow(nodes, edges, { incomingMessage: "x" });
    const closed = simulateFlow(nodes, edges, { incomingMessage: "x", mockCase: { withinHours: false } });
    expect(open.steps.some((s) => s.nodeId === "yes")).toBe(true);
    expect(closed.steps.some((s) => s.nodeId === "no")).toBe(true);
  });

  it("un nodo anterior cambia lo que ve la condición", () => {
    const classify = action("k", { actionType: "classifyCase", caseTypeId: "t9", caseTypeName: "Soporte" });
    const { nodes, edges } = conditionFlow([{ field: "case_type", operator: "equals", value: "t9" }], [classify]);
    const result = simulateFlow(nodes, edges, { incomingMessage: "x", mockCase: { caseTypeId: "t1" } });
    expect(result.steps.some((s) => s.nodeId === "yes")).toBe(true);
  });

  it("tipo de contacto", () => {
    const { nodes, edges } = conditionFlow([{ field: "contact_type", operator: "equals", value: "ct1" }]);
    const result = simulateFlow(nodes, edges, { incomingMessage: "x", mockContact: { contactTypeId: "ct1" } });
    expect(result.steps.some((s) => s.nodeId === "yes")).toBe(true);
  });
});

describe("simulador: Enviar mensaje con plantilla", () => {
  const send = (data: Record<string, unknown>): Node => ({ id: "m", type: "sendMessage", position: { x: 0, y: 0 }, data });

  it("ventana abierta (o sin simular): envía el texto", () => {
    const { nodes, edges } = chain([trigger(), send({ messages: [{ text: "Hola" }], template: { template_name: "aviso", language: "es", params: [] } })]);
    expect(simulateFlow(nodes, edges, { incomingMessage: "x" }).steps[1].result).toMatchObject({ type: "message", texts: ["Hola"] });
    expect(simulateFlow(nodes, edges, { incomingMessage: "x", windowOpen: true }).steps[1].result).toMatchObject({ type: "message" });
  });

  it("ventana cerrada con plantilla: envía la plantilla con las variables", () => {
    const { nodes, edges } = chain([
      trigger(),
      send({ messages: [{ text: "Hola" }], template: { template_name: "aviso", language: "es", params: ["{nombre}", "{empresa}"] } }),
    ]);
    const result = simulateFlow(nodes, edges, { incomingMessage: "x", windowOpen: false });
    expect(result.steps[1].result).toEqual({
      type: "template",
      templateName: "aviso",
      language: "es",
      params: ["Cliente de prueba", "Mi empresa"],
    });
  });

  it("ventana cerrada sin plantilla: no envía y dice por qué", () => {
    const { nodes, edges } = chain([trigger(), send({ messages: [{ text: "Hola" }] })]);
    const result = simulateFlow(nodes, edges, { incomingMessage: "x", windowOpen: false });
    expect(result.steps[1].result).toMatchObject({ type: "message_skipped" });
  });
});
