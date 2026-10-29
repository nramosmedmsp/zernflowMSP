import { describe, expect, it } from "vitest";
import { CONTACT_FLOW_VARIABLES } from "./contact-variables";
import {
  CONTACT_VARIABLE_NAMES,
  availableVariablesFor,
  findKeywordCollisions,
  hasErrors,
  triggerKeywords,
  validateFlowGraph,
  type FlowEdgeLike,
  type FlowNodeLike,
} from "./validate";

const trigger = (keywords: unknown[] = [{ value: "hola", matchType: "exact" }], extra = {}): FlowNodeLike => ({
  id: "t",
  type: "trigger",
  data: { triggerType: "keyword", keywords, ...extra },
});
const msg = (id: string, text: string): FlowNodeLike => ({ id, type: "sendMessage", data: { messages: [{ text }] } });
const edge = (source: string, target: string): FlowEdgeLike => ({ source, target });
const codes = (nodes: FlowNodeLike[], edges: FlowEdgeLike[]) => validateFlowGraph(nodes, edges).map((i) => i.code);

describe("validateFlowGraph (M-26)", () => {
  it("un flujo vacío no tiene disparador", () => {
    const issues = validateFlowGraph([], []);
    expect(issues.map((i) => i.code)).toEqual(["no_trigger"]);
    expect(hasErrors(issues)).toBe(true);
  });

  it("un flujo completo no da problemas", () => {
    expect(validateFlowGraph([trigger(), msg("m", "Hola")], [edge("t", "m")])).toEqual([]);
  });

  it("disparador de palabra clave sin palabras", () => {
    expect(codes([trigger([]), msg("m", "Hola")], [edge("t", "m")])).toContain("trigger_no_keywords");
    expect(codes([trigger([{ value: "  " }]), msg("m", "Hola")], [edge("t", "m")])).toContain("trigger_no_keywords");
  });

  it("acepta las palabras clave de las plantillas (config.keywords)", () => {
    const t: FlowNodeLike = { id: "t", type: "trigger", data: { triggerType: "keyword", config: { keywords: ["precio"] } } };
    expect(triggerKeywords(t.data)).toEqual(["precio"]);
    expect(codes([t, msg("m", "x")], [edge("t", "m")])).toEqual([]);
  });

  it("el disparador de bienvenida no pide palabras clave", () => {
    const t: FlowNodeLike = { id: "t", type: "trigger", data: { triggerType: "welcome" } };
    expect(codes([t, msg("m", "x")], [edge("t", "m")])).toEqual([]);
  });

  it("mensaje vacío o sin mensajes", () => {
    expect(codes([trigger(), msg("m", "   ")], [edge("t", "m")])).toContain("empty_message");
    const none: FlowNodeLike = { id: "m", type: "sendMessage", data: { messages: [] } };
    expect(codes([trigger(), none], [edge("t", "m")])).toContain("empty_message");
  });

  it("un mensaje solo con imagen sí tiene contenido", () => {
    const img: FlowNodeLike = { id: "m", type: "sendMessage", data: { messages: [{ imageUrl: "https://x/y.png" }] } };
    expect(codes([trigger(), img], [edge("t", "m")])).toEqual([]);
  });

  it("disparador sin conexión", () => {
    expect(codes([trigger(), msg("m", "x")], [])).toContain("trigger_not_connected");
  });

  it("acciones incompletas", () => {
    const go: FlowNodeLike = { id: "g", type: "action", data: { actionType: "goToFlow" } };
    const tag: FlowNodeLike = { id: "a", type: "action", data: { actionType: "addTag", tagName: "" } };
    const seq: FlowNodeLike = { id: "s", type: "action", data: { actionType: "enrollSequence" } };
    const issues = validateFlowGraph([trigger(), go, tag, seq], [edge("t", "g"), edge("g", "a"), edge("a", "s")]);
    expect(issues.filter((i) => i.code === "incomplete_node").map((i) => i.nodeId)).toEqual(["g", "a", "s"]);
  });

  it("avisa de nodos sueltos (aviso, no error)", () => {
    const issues = validateFlowGraph([trigger(), msg("m", "Hola"), msg("suelto", "Hola")], [edge("t", "m")]);
    const loose = issues.find((i) => i.code === "unreachable_node");
    expect(loose).toMatchObject({ severity: "warning", nodeId: "suelto" });
    expect(hasErrors(issues)).toBe(false);
  });
});

describe("variables desconocidas (M-31)", () => {
  it("nombre, fecha_clave, empresa y message son conocidas", () => {
    const issues = validateFlowGraph(
      [trigger(), msg("m", "Hola {{nombre}}, {{empresa}} {{fecha_clave}} {{message}}")],
      [edge("t", "m")],
    );
    expect(issues).toEqual([]);
  });

  it("avisa de una variable que el bot no conoce", () => {
    const issues = validateFlowGraph([trigger(), msg("m", "Hola {{cliente}}")], [edge("t", "m")]);
    const w = issues.find((i) => i.code === "unknown_variable");
    expect(w?.severity).toBe("warning");
    expect(w?.nodeId).toBe("m");
    expect(w?.message).toContain("{{cliente}}");
  });

  it("la variable de una Solicitud HTTP es válida, también con ruta de puntos", () => {
    const http: FlowNodeLike = { id: "h", type: "action", data: { actionType: "httpRequest", url: "https://a.b", responseVariable: "api" } };
    const issues = validateFlowGraph([trigger(), http, msg("m", "Total {{api.data.total}}")], [edge("t", "h"), edge("h", "m")]);
    expect(issues).toEqual([]);
    expect(availableVariablesFor("m", [trigger(), http, msg("m", "x")], [edge("t", "h"), edge("h", "m")])).toContain("api");
  });

  it("ai_response solo existe después de un nodo de IA", () => {
    const ai: FlowNodeLike = { id: "a", type: "aiResponse", data: {} };
    expect(codes([trigger(), msg("m", "{{ai_response}}")], [edge("t", "m")])).toContain("unknown_variable");
    expect(codes([trigger(), ai, msg("m", "{{ai_response}}")], [edge("t", "a"), edge("a", "m")])).not.toContain("unknown_variable");
  });

  it("la lista del editor coincide con la del motor", () => {
    expect([...CONTACT_VARIABLE_NAMES]).toEqual([...CONTACT_FLOW_VARIABLES]);
  });
});

describe("findKeywordCollisions (B-17)", () => {
  it("detecta una palabra clave repetida en otro flujo publicado, sin importar mayúsculas", () => {
    const issues = findKeywordCollisions(["Hola", "precio"], [
      { flowId: "f2", flowName: "Bienvenida", keywords: ["hola ", "buenas"] },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("Bienvenida");
    expect(issues[0].message).toContain("Hola");
  });

  it("sin coincidencias no avisa", () => {
    expect(findKeywordCollisions(["precio"], [{ flowId: "f2", flowName: "X", keywords: ["hola"] }])).toEqual([]);
  });

  it("no repite el aviso por la misma palabra y flujo", () => {
    const issues = findKeywordCollisions(["hola", "HOLA"], [{ flowId: "f2", flowName: "X", keywords: ["hola"] }]);
    expect(issues).toHaveLength(1);
  });
});

describe("avisos de publicación (R2-B10, R2-B22)", () => {
  const caseTrigger = (triggerType: string, extra = {}): FlowNodeLike => ({ id: "t", type: "trigger", data: { triggerType, ...extra } });

  it("un disparador de gestión sin tipo avisa que se activaría con cualquier gestión", () => {
    const c = codes([caseTrigger("case_opened"), msg("m", "Hola")], [edge("t", "m")]);
    expect(c).toContain("case_trigger_no_type");
    expect(codes([caseTrigger("case_opened", { caseTypeId: "ct-1" }), msg("m", "Hola")], [edge("t", "m")])).not.toContain("case_trigger_no_type");
  });

  it("el cambio de etapa sin etapa avisa", () => {
    const c = codes([caseTrigger("case_stage_changed", { caseTypeId: "ct-1" }), msg("m", "Hola")], [edge("t", "m")]);
    expect(c).toContain("case_trigger_no_stage");
    expect(c).not.toContain("case_trigger_no_type");
  });

  it("un flujo de comentario con varios mensajes avisa que solo el primero sale como respuesta privada", () => {
    const t = caseTrigger("comment_keyword", { keywords: [{ value: "info" }] });
    const issues = validateFlowGraph([t, msg("m1", "Uno"), msg("m2", "Dos")], [edge("t", "m1"), edge("m1", "m2")]);
    expect(issues.find((i) => i.code === "comment_multi_message")?.severity).toBe("warning");
    expect(hasErrors(issues)).toBe(false);
    expect(codes([t, msg("m1", "Uno")], [edge("t", "m1")])).not.toContain("comment_multi_message");
  });
});
