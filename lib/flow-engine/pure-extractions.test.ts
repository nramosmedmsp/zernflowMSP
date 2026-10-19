// Funciones puras que se extrajeron del motor para que el motor real y el
// laboratorio de conversaciones usen la misma lógica. Cada una se prueba sola y,
// donde el motor real la usa con la base, se comprueba que sigue comportándose
// igual (matchTrigger sobre la base en memoria).

import { describe, expect, it } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { buildCaseConditionSnapshot } from "./case-conditions";
import { evaluateConditionNode } from "./condition-eval";
import { chooseABPath, conditionHandleAliases, delayDurationMs, selectNextEdge } from "./graph";
import { resolveGlobalKeyword } from "./global-keywords";
import { persistsSessionVariables } from "./node-kind";
import { computeFlowWindowOpen, messageHasContent, WHATSAPP_WINDOW_MS } from "./send-mode";
import { findKeywordMatch, matchTrigger, selectTrigger } from "./trigger-matcher";

describe("selectTrigger", () => {
  const kw = (id: string, keywords: unknown[], matchType?: string) => ({ id, type: "keyword", config: { keywords, ...(matchType ? { matchType } : {}) } });
  const triggers = [
    { id: "pb", type: "postback", config: { payload: "comprar" } },
    { id: "qr", type: "quick_reply", config: { payload: "asesor" } },
    kw("k1", [{ value: "precio", matchType: "contains" }, { value: "hola", matchType: "exact" }]),
    kw("k2", ["catalogo"]),
    { id: "w", type: "welcome", config: {} },
    { id: "d", type: "default", config: {} },
  ];
  const pick = (message: Parameters<typeof selectTrigger>[1], first = false) => selectTrigger(triggers, message, first)?.trigger.id;

  it("respeta el orden: botón, respuesta rápida, palabra clave, bienvenida y por defecto", () => {
    expect(pick({ text: "precio", postbackPayload: "comprar" }, true)).toBe("pb");
    expect(pick({ text: "precio", quickReplyPayload: "asesor" }, true)).toBe("qr");
    expect(pick({ text: "cuál es el precio" }, true)).toBe("k1");
    expect(pick({ text: "buenas" }, true)).toBe("w");
    expect(pick({ text: "buenas" }, false)).toBe("d");
  });

  it("una carga de botón desconocida cae a las palabras clave del texto", () => {
    expect(pick({ text: "precio", postbackPayload: "otra" })).toBe("k1");
    expect(pick({ postbackPayload: "otra" })).toBe("d");
  });

  it("sin disparadores o sin coincidencia ni por defecto, nada", () => {
    expect(selectTrigger([], { text: "x" }, true)).toBeNull();
    expect(selectTrigger(triggers.slice(0, 4), { text: "x" }, true)).toBeNull();
  });

  it("explica cómo coincidió", () => {
    expect(selectTrigger(triggers, { text: "PRECIO!" }, false)?.reason).toEqual({ via: "keyword", keyword: "precio", matchType: "contains" });
    expect(selectTrigger(triggers, { text: "x" }, true)?.reason).toEqual({ via: "welcome" });
  });

  it("tipos de coincidencia: exacta, contiene y empieza con; el del disparador es el valor por defecto", () => {
    expect(findKeywordMatch({ keywords: [{ value: "baja", matchType: "exact" }] }, "  BAJA ")).toMatchObject({ keyword: "baja" });
    expect(findKeywordMatch({ keywords: [{ value: "baja", matchType: "exact" }] }, "rebajas")).toBeNull();
    expect(findKeywordMatch({ keywords: [{ value: "lista", matchType: "startsWith" }] }, "lista de precios")).not.toBeNull();
    expect(findKeywordMatch({ keywords: [{ value: "lista", matchType: "startsWith" }] }, "ya está lista")).toBeNull();
    expect(findKeywordMatch({ keywords: ["x"], matchType: "exact" }, "x y")).toBeNull();
    expect(findKeywordMatch({ keywords: ["x"] }, "a x b")).not.toBeNull();
    expect(findKeywordMatch({}, "x")).toBeNull();
    expect(findKeywordMatch(null, "x")).toBeNull();
  });
});

describe("matchTrigger del motor real (base en memoria)", () => {
  const WS = "ws-1";
  function seed(options: { triggers: Array<Record<string, unknown>>; flows?: Array<Record<string, unknown>> }) {
    const fake = new FakeDb();
    fake.seed("flows", options.flows ?? [{ id: "f1", workspace_id: WS, status: "published" }, { id: "f2", workspace_id: WS, status: "draft" }, { id: "f3", workspace_id: "otro", status: "published" }]);
    fake.seed("triggers", options.triggers);
    return fake;
  }
  const call = (fake: FakeDb, message: { text?: string }, isFirstMessage?: boolean) =>
    matchTrigger(fake.asDb(), { channelId: "ch-1", workspaceId: WS, conversationId: "conv-1", message, isFirstMessage });

  it("solo ve disparadores activos de flujos publicados del espacio, del canal o de todos, por prioridad", async () => {
    const fake = seed({
      triggers: [
        { id: "otro-canal", flow_id: "f1", type: "keyword", channel_id: "ch-2", config: { keywords: ["hola"] } },
        { id: "borrador", flow_id: "f2", type: "keyword", config: { keywords: ["hola"] } },
        { id: "ajeno", flow_id: "f3", type: "keyword", config: { keywords: ["hola"] } },
        { id: "inactivo", flow_id: "f1", type: "keyword", is_active: false, config: { keywords: ["hola"] } },
        { id: "bajo", flow_id: "f1", type: "keyword", priority: 1, config: { keywords: ["hola"] } },
        { id: "alto", flow_id: "f1", type: "keyword", priority: 9, channel_id: "ch-1", config: { keywords: ["hola"] } },
      ],
    });
    expect((await call(fake, { text: "hola" }, false))?.id).toBe("alto");
    expect(await call(fake, { text: "nada" }, false)).toBeNull();
  });

  it("la bienvenida usa la señal del primer mensaje; sin ella, cuenta los entrantes de la conversación", async () => {
    const fake = seed({ triggers: [{ id: "w", flow_id: "f1", type: "welcome" }, { id: "d", flow_id: "f1", type: "default" }] });
    expect((await call(fake, { text: "x" }, true))?.id).toBe("w");
    expect((await call(fake, { text: "x" }, false))?.id).toBe("d");
    // Sin la señal: un solo mensaje entrante en la conversación = primer mensaje.
    fake.seed("messages", [{ conversation_id: "conv-1", direction: "inbound" }]);
    expect((await call(fake, { text: "x" }))?.id).toBe("w");
    fake.seed("messages", [{ conversation_id: "conv-1", direction: "inbound" }]);
    expect((await call(fake, { text: "x" }))?.id).toBe("d");
  });

  it("una palabra clave gana a la bienvenida sin consultar los mensajes", async () => {
    const fake = seed({ triggers: [{ id: "k", flow_id: "f1", type: "keyword", config: { keywords: ["hola"] } }, { id: "w", flow_id: "f1", type: "welcome" }] });
    expect((await call(fake, { text: "hola" }, true))?.id).toBe("k");
  });
});

describe("resolveGlobalKeyword", () => {
  const keywords = [
    { keyword: "BAJA", action: "unsubscribe" },
    { keyword: "alta", action: "subscribe" },
    { keyword: "menu" },
    { keyword: "menu", action: "unsubscribe" },
  ];
  it("compara el texto completo, sin mayúsculas ni espacios en los extremos", () => {
    expect(resolveGlobalKeyword("  baja ", keywords)).toEqual({ handled: true, action: "unsubscribe", keyword: "BAJA" });
    expect(resolveGlobalKeyword("Alta", keywords)).toEqual({ handled: true, action: "subscribe", keyword: "alta" });
    expect(resolveGlobalKeyword("quiero la baja", keywords)).toEqual({ handled: false });
  });
  it("la primera que coincide manda: sin acción conocida el mensaje sigue su camino", () => {
    expect(resolveGlobalKeyword("menu", keywords)).toEqual({ handled: false, keyword: "menu" });
  });
  it("sin texto o sin palabras no hay nada", () => {
    expect(resolveGlobalKeyword(undefined, keywords)).toEqual({ handled: false });
    expect(resolveGlobalKeyword("baja", null)).toEqual({ handled: false });
  });
});

describe("recorrido del flujo", () => {
  const edges = [
    { source: "a", target: "b" },
    { source: "c", target: "yes", sourceHandle: "yes" },
    { source: "c", target: "no", sourceHandle: "false" },
    { source: "d", target: "x", sourceHandle: "A" },
    { source: "e", target: "solo-con-salida", sourceHandle: "out" },
  ];
  it("salida elegida: acepta los dos nombres de Sí y No; sin conexión termina", () => {
    expect(conditionHandleAliases("true")).toEqual(["true", "yes"]);
    expect(conditionHandleAliases("no")).toEqual(["false", "no"]);
    expect(selectNextEdge(edges, "c", "true")?.target).toBe("yes");
    expect(selectNextEdge(edges, "c", "false")?.target).toBe("no");
    expect(selectNextEdge(edges, "d", "A")?.target).toBe("x");
    expect(selectNextEdge(edges, "d", "B")).toBeUndefined();
    expect(selectNextEdge(edges, "a", "true")).toBeUndefined();
  });
  it("sin salida elegida toma la primera arista del nodo", () => {
    expect(selectNextEdge(edges, "a")?.target).toBe("b");
    expect(selectNextEdge(edges, "e")?.target).toBe("solo-con-salida");
    expect(selectNextEdge(edges, "z")).toBeUndefined();
  });
  it("prueba A/B según el número y esperas por unidad", () => {
    const paths = [{ name: "A", weight: 1 }, { name: "B", weight: 3 }];
    expect(chooseABPath(paths, 0).name).toBe("A");
    expect(chooseABPath(paths, 0.25).name).toBe("A");
    expect(chooseABPath(paths, 0.26).name).toBe("B");
    expect(chooseABPath(paths, 1).name).toBe("B");
    expect(delayDurationMs(2, "hours")).toBe(7_200_000);
    expect(delayDurationMs(3, "days")).toBe(259_200_000);
    expect(delayDurationMs(5, "otra")).toBe(5000);
  });
  it("qué nodos guardan las variables de la sesión", () => {
    expect(persistsSessionVariables({ type: "action", data: { actionType: "smartDelay" } })).toBe(true);
    expect(persistsSessionVariables({ type: "action", data: { actionType: "classifyCase" } })).toBe(true);
    expect(persistsSessionVariables({ type: "httpRequest" })).toBe(true);
    expect(persistsSessionVariables({ type: "aiResponse" })).toBe(true);
    expect(persistsSessionVariables({ type: "sendMessage" })).toBe(false);
    expect(persistsSessionVariables({ type: "delay" })).toBe(false);
    expect(persistsSessionVariables({ type: "action", data: { actionType: "algo-raro" } })).toBe(false);
  });
});

describe("ventana de 24 h y contenido del mensaje", () => {
  const now = new Date("2026-10-19T15:00:00.000Z");
  it("un mensaje del cliente la abre; si no, cuenta desde el último entrante", () => {
    expect(computeFlowWindowOpen({ text: "hola" }, null, now)).toBe(true);
    expect(computeFlowWindowOpen({ postbackPayload: "x" }, null, now)).toBe(true);
    expect(computeFlowWindowOpen({}, null, now)).toBe(false);
    expect(computeFlowWindowOpen({}, new Date(now.getTime() - WHATSAPP_WINDOW_MS).toISOString(), now)).toBe(true);
    expect(computeFlowWindowOpen({}, new Date(now.getTime() - WHATSAPP_WINDOW_MS - 1).toISOString(), now)).toBe(false);
  });
  it("texto, media o carrusel cuentan como contenido; los botones solos no", () => {
    expect(messageHasContent({ text: " hola " })).toBe(true);
    expect(messageHasContent({ text: "  " })).toBe(false);
    expect(messageHasContent({ imageUrl: "https://x.pe/a.jpg" })).toBe(true);
    expect(messageHasContent({ mediaUrl: "https://x.pe/a.mp4" })).toBe(true);
    expect(messageHasContent({ carousel: { elements: [{}] } })).toBe(true);
    expect(messageHasContent({ carousel: { elements: [] } })).toBe(false);
    expect(messageHasContent({})).toBe(false);
  });
});

describe("condiciones del nodo", () => {
  const facts = { platform: "whatsapp", isSubscribed: true, tags: ["VIP"], customFields: { talla: "M" }, variables: { message: "Quiero comprar" } };
  const snapshot = buildCaseConditionSnapshot({
    contactTypeId: "ct",
    row: { case_type_id: "venta", stage_id: "s1", team_id: null, assignee_id: "u1" },
    withinHours: false,
  });
  it("y / o con condiciones de contacto y de gestión", () => {
    const conditions = [
      { field: "tag:VIP", operator: "equals", value: "true" },
      { field: "case_stage", operator: "equals", value: "s1" },
      { field: "within_hours", operator: "equals", value: "true" },
    ];
    expect(evaluateConditionNode({ conditions, logic: "and" }, facts, snapshot)).toEqual({ results: [true, true, false], passed: false });
    expect(evaluateConditionNode({ conditions, logic: "or" }, facts, snapshot).passed).toBe(true);
    expect(evaluateConditionNode({ conditions: [], logic: "and" }, facts, snapshot).passed).toBe(true);
    expect(evaluateConditionNode({ conditions: [], logic: "or" }, facts, snapshot).passed).toBe(false);
  });
  it("sin datos de gestión, las condiciones de gestión se tratan como condiciones del contacto", () => {
    expect(evaluateConditionNode({ conditions: [{ field: "case_stage", operator: "equals", value: "s1" }], logic: "and" }, facts, null).passed).toBe(false);
  });
  it("el snapshot sin gestión queda vacío", () => {
    expect(buildCaseConditionSnapshot({ contactTypeId: null, row: null, withinHours: true })).toEqual({
      contactTypeId: null,
      caseTypeId: null,
      stageId: null,
      teamId: null,
      hasAssignee: false,
      withinHours: true,
    });
    expect(snapshot).toMatchObject({ caseTypeId: "venta", stageId: "s1", hasAssignee: true, withinHours: false });
  });
});
