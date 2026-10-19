import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { simulateFlow } from "./simulator";

const node = (id: string, type: string, data: Record<string, unknown>): Node => ({ id, type, position: { x: 0, y: 0 }, data });
const action = (id: string, data: Record<string, unknown>) => node(id, "action", data);
const send = (id: string, data: Record<string, unknown>) => node(id, "sendMessage", data);

function chain(nodes: Node[]): { nodes: Node[]; edges: Edge[] } {
  const edges: Edge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ id: `e${i}`, source: nodes[i].id, target: nodes[i + 1].id });
  return { nodes, edges };
}

const trigger = node("t", "trigger", { triggerType: "keyword", keywords: [{ value: "pedido", matchType: "contains" }] });
const wait = (id = "w") => action(id, { actionType: "smartDelay", timeout: 30, timeoutUnit: "minutes" });

describe("simulador: conversación por turnos", () => {
  const flow = chain([
    trigger,
    send("ask", { messages: [{ text: "¿Cuál es tu número de pedido?" }] }),
    wait(),
    action("save", { actionType: "setCustomField", fieldSlug: "numero_pedido", value: "{{message}}" }),
    send("ok", { messages: [{ text: "Revisamos el pedido {{message}}." }] }),
  ]);

  it("se detiene en la espera y pide el siguiente mensaje", () => {
    const first = simulateFlow(flow.nodes, flow.edges, { incomingMessage: "mi pedido" });
    expect(first.completed).toBe(false);
    expect(first.waiting?.waitingNodeId).toBe("w");
    expect(first.steps.map((s) => s.result.type)).toEqual(["trigger", "message", "smart_delay"]);
    expect(first.errors).toEqual([]);
  });

  it("la respuesta retoma la espera: guarda {{message}} y termina", () => {
    const first = simulateFlow(flow.nodes, flow.edges, { incomingMessage: "mi pedido" });
    // El mensaje de la respuesta no tiene que activar el disparador ("PE-10458" no dice "pedido").
    const second = simulateFlow(flow.nodes, flow.edges, { incomingMessage: "PE-10458", resume: first.waiting });
    expect(second.completed).toBe(true);
    expect(second.waiting).toBeUndefined();
    expect(second.steps.map((s) => s.result.type)).toEqual(["reply", "action", "message", "flow_end"]);
    expect(second.steps[1].result).toMatchObject({ detail: "Asignar numero_pedido = PE-10458" });
    expect(second.steps[2].result).toMatchObject({ texts: ["Revisamos el pedido PE-10458."] });
  });

  it("con replies recorre todos los turnos de una vez", () => {
    const result = simulateFlow(flow.nodes, flow.edges, { incomingMessage: "mi pedido", replies: ["PE-1"] });
    expect(result.completed).toBe(true);
    expect(result.steps.filter((s) => s.result.type === "reply")).toHaveLength(1);
  });

  it("varias esperas seguidas piden una respuesta cada una", () => {
    const two = chain([
      trigger,
      send("a", { messages: [{ text: "Primero" }] }),
      wait("w1"),
      send("b", { messages: [{ text: "Escribiste {{message}}, ahora el segundo" }] }),
      wait("w2"),
      send("c", { messages: [{ text: "Listo: {{message}}" }] }),
    ]);
    const t1 = simulateFlow(two.nodes, two.edges, { incomingMessage: "pedido" });
    expect(t1.waiting?.waitingNodeId).toBe("w1");
    const t2 = simulateFlow(two.nodes, two.edges, { incomingMessage: "uno", resume: t1.waiting });
    expect(t2.waiting?.waitingNodeId).toBe("w2");
    expect(t2.steps.some((s) => s.result.type === "message" && s.result.texts[0] === "Escribiste uno, ahora el segundo")).toBe(true);
    const t3 = simulateFlow(two.nodes, two.edges, { incomingMessage: "dos", resume: t2.waiting });
    expect(t3.completed).toBe(true);
    expect(t3.steps.some((s) => s.result.type === "message" && s.result.texts[0] === "Listo: dos")).toBe(true);
  });

  it("el estado del contacto pasa de un turno al siguiente (etiquetas y campos)", () => {
    const f = chain([
      trigger,
      action("tag", { actionType: "addTag", tagName: "Interesado" }),
      wait(),
      node("c", "condition", { conditions: [{ field: "tag:Interesado", operator: "equals", value: "true" }], logic: "and" }),
      send("yes", { messages: [{ text: "Sigues interesado" }] }),
    ]);
    f.edges[f.edges.length - 1] = { id: "y", source: "c", target: "yes", sourceHandle: "yes" };
    const t1 = simulateFlow(f.nodes, f.edges, { incomingMessage: "pedido" });
    const t2 = simulateFlow(f.nodes, f.edges, { incomingMessage: "sí", resume: t1.waiting });
    expect(t2.steps.some((s) => s.result.type === "message")).toBe(true);
  });

  it("si la espera ya no existe en el flujo avisa", () => {
    const first = simulateFlow(flow.nodes, flow.edges, { incomingMessage: "mi pedido" });
    const result = simulateFlow(flow.nodes.filter((n) => n.id !== "w"), flow.edges, { incomingMessage: "x", resume: first.waiting });
    expect(result.errors).toEqual(["El nodo de espera ya no existe en el flujo"]);
  });
});

describe("simulador: variables y botones", () => {
  it("interpola {{message}} y otras variables como el motor", () => {
    const f = chain([
      node("t", "trigger", { triggerType: "default" }),
      send("m", { messages: [{ text: "Dijiste: {{message}} / {{no_existe}}" }] }),
    ]);
    const r = simulateFlow(f.nodes, f.edges, { incomingMessage: "hola" });
    expect(r.steps[1].result).toMatchObject({ texts: ["Dijiste: hola / {{no_existe}}"] });
  });

  it("muestra los botones y las respuestas rápidas de cada mensaje", () => {
    const f = chain([
      node("t", "trigger", { triggerType: "default" }),
      send("m", {
        messages: [
          { text: "Elige", buttons: [{ title: "Quiero comprar", type: "postback", payload: "comprar" }, { title: "Web", type: "url", url: "https://x.pe" }] },
          { text: "O responde", quickReplies: [{ title: "1", payload: "1" }, { title: "2", payload: "2" }] },
        ],
      }),
    ]);
    const r = simulateFlow(f.nodes, f.edges, { incomingMessage: "hola" });
    expect(r.steps[1].result).toMatchObject({
      type: "message",
      texts: ["Elige", "O responde"],
      buttons: [
        { title: "Quiero comprar", type: "postback" },
        { title: "Web", type: "url", url: "https://x.pe" },
      ],
      quickReplies: [{ title: "1" }, { title: "2" }],
    });
  });

  it("un clic en un botón es enviar su título como respuesta", () => {
    const f = chain([
      node("t", "trigger", { triggerType: "default" }),
      send("m", { messages: [{ text: "Elige", buttons: [{ title: "Quiero comprar", type: "postback", payload: "comprar" }] }] }),
      wait(),
      node("c", "condition", { conditions: [{ field: "variable:message", operator: "contains", value: "COMPRAR" }], logic: "and" }),
      send("yes", { messages: [{ text: "A comprar" }] }),
      send("no", { messages: [{ text: "Otra cosa" }] }),
    ]);
    f.edges.splice(f.edges.length - 1, 1);
    f.edges.push({ id: "y", source: "c", target: "yes", sourceHandle: "yes" }, { id: "n", source: "c", target: "no", sourceHandle: "no" });
    const t1 = simulateFlow(f.nodes, f.edges, { incomingMessage: "hola" });
    const button = (t1.steps.find((s) => s.result.type === "message")!.result as { buttons: Array<{ title: string }> }).buttons[0];
    const t2 = simulateFlow(f.nodes, f.edges, { incomingMessage: button.title, resume: t1.waiting });
    expect(t2.steps.some((s) => s.result.type === "message" && s.result.texts[0] === "A comprar")).toBe(true);
  });
});

describe("simulador: nodos action del lienzo", () => {
  it("Atención humana muestra la nota interna con las variables y detiene el flujo", () => {
    const f = chain([
      node("t", "trigger", { triggerType: "default" }),
      action("h", { actionType: "humanTakeover", message: "Pidió: {{message}}" }),
      send("m", { messages: [{ text: "no debe llegar" }] }),
    ]);
    const r = simulateFlow(f.nodes, f.edges, { incomingMessage: "congelar" });
    expect(r.steps.map((s) => s.result.type)).toEqual(["trigger", "human_takeover"]);
    expect(r.steps[1].result).toMatchObject({ note: "Pidió: congelar" });
    expect(r.completed).toBe(true);
  });

  it("Desuscribir y etiquetas se reconocen como en el motor", () => {
    const f = chain([
      node("t", "trigger", { triggerType: "default" }),
      action("u", { actionType: "unsubscribe" }),
      action("a", { actionType: "addTag", tagName: "Baja" }),
    ]);
    const r = simulateFlow(f.nodes, f.edges, { incomingMessage: "baja" });
    expect(r.steps.map((s) => s.result.type)).toEqual(["trigger", "unsubscribe", "action", "flow_end"]);
  });

  it("Clasificar gestión con categoría la muestra", () => {
    const f = chain([
      node("t", "trigger", { triggerType: "default" }),
      action("k", { actionType: "classifyCase", caseTypeId: "t1", caseTypeName: "Postventa", categoryId: "c1", categoryName: "Estado de pedido" }),
    ]);
    const r = simulateFlow(f.nodes, f.edges, { incomingMessage: "x" });
    expect(r.steps[1].result).toMatchObject({
      detail: 'Clasificaría la gestión como "Postventa", con la categoría "Estado de pedido"',
    });
  });
});
