import { describe, expect, it } from "vitest";
import { buildCatalogFromTemplates } from "../from-templates";
import { normalizeCatalog } from "../catalog";
import type { LabCatalog, LabEdge, LabFlow, LabNode } from "../types";
import { buildFlowMap, filterPublished } from "./build";
import { caseTypeNodeId, closeNodeId, flowNodeId, stageNodeId } from "./types";

const flowIdOf = (catalog: LabCatalog, name: string) => {
  const flow = catalog.flows.find((f) => f.name === name);
  if (!flow) throw new Error(`No hay flujo «${name}»`);
  return flow.id;
};

function simpleFlow(id: string, name: string, nodes: LabNode[], edges: LabEdge[] = [], status: LabFlow["status"] = "published"): LabFlow {
  return { id, name, status, nodes, edges };
}

const keywordTrigger = (id: string, keywords: string[]): LabNode => ({
  id,
  type: "trigger",
  data: { triggerType: "keyword", keywords: keywords.map((value) => ({ value, matchType: "contains" })) },
});
const message = (id: string, text: string): LabNode => ({ id, type: "sendMessage", data: { messages: [{ text }] } });

describe("mapa de flujos con las plantillas de E-commerce y generales", () => {
  it("ubica cada flujo en el carril de cómo arranca", async () => {
    const catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
    const model = buildFlowMap(catalog);
    const laneOf = (name: string) => model.cards.find((c) => c.id === flowIdOf(catalog, name))?.lane;

    expect(model.lanes.map((l) => l.id)).toEqual(["first", "keywords", "events", "default", "none"]);
    expect(laneOf("Bienvenida y clasificación")).toBe("first");
    expect(laneOf("Bienvenida simple")).toBe("first");
    expect(laneOf("Catálogo y precios")).toBe("keywords");
    expect(laneOf("Datos de pago")).toBe("events");
    expect(laneOf("Recordatorio de pago")).toBe("events");
    expect(laneOf("Respuesta cuando ningún flujo aplica")).toBe("default");
    expect(model.lanes.find((l) => l.id === "none")!.flowIds).toEqual([]);
    expect(model.cards).toHaveLength(catalog.flows.length);
    // Cada flujo está en un solo carril.
    const placed = model.lanes.flatMap((l) => l.flowIds);
    expect(new Set(placed).size).toBe(catalog.flows.length);
  });

  it("conecta «Datos de pago» con la etapa «Pedido o enlace de pago enviado» y la marca", async () => {
    const catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
    const model = buildFlowMap(catalog);
    const venta = model.caseTypes.find((t) => t.name === "Venta")!;
    const stage = venta.stages.find((s) => s.name === "Pedido o enlace de pago enviado")!;
    const datosPago = flowIdOf(catalog, "Datos de pago");

    expect(stage.activatesFlowIds).toEqual([datosPago]);
    expect(model.connections).toContainEqual(
      expect.objectContaining({ kind: "stage", from: stageNodeId(stage.id), to: flowNodeId(datosPago) }),
    );
    const card = model.cards.find((c) => c.id === datosPago)!;
    expect(card.activatedBy).toEqual([expect.objectContaining({ stageId: stage.id, stageName: "Pedido o enlace de pago enviado", caseTypeName: "Venta" })]);
    expect(card.triggerSummary).toBe("Venta › Pedido o enlace de pago enviado");

    // Y ese flujo cambia la etapa a «Esperando pago»: flujo → etapa.
    const esperando = venta.stages.find((s) => s.name === "Esperando pago")!;
    expect(esperando.setByFlowIds).toContain(datosPago);
    expect(model.connections).toContainEqual(
      expect.objectContaining({ kind: "stage", from: flowNodeId(datosPago), to: stageNodeId(esperando.id) }),
    );
    // Las etapas salen en orden.
    expect(venta.stages.map((s) => s.position)).toEqual([...venta.stages.map((s) => s.position)].sort((a, b) => a - b));
  });

  it("avisa de los «[REEMPLAZA» pendientes en los flujos publicados", async () => {
    const catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
    const model = buildFlowMap(catalog);
    const datosPago = flowIdOf(catalog, "Datos de pago");
    const warning = model.warnings.find((w) => w.kind === "placeholder" && w.flowIds.includes(datosPago));

    expect(warning).toBeDefined();
    expect(warning!.severity).toBe("error");
    expect(warning!.message).toContain("REEMPLAZA");
    expect(warning!.nodeIds.length).toBeGreaterThan(0);
    expect(model.cards.find((c) => c.id === datosPago)!.warningCount).toBeGreaterThan(0);

    // En borrador es un aviso, no un error.
    const draft = buildFlowMap(await buildCatalogFromTemplates({ business: "ecommerce", flowStatus: "draft" }));
    expect(draft.warnings.find((w) => w.kind === "placeholder")!.severity).toBe("warning");
  });

  it("no inventa avisos de referencias rotas en un espacio recién armado", async () => {
    const model = buildFlowMap(await buildCatalogFromTemplates({ business: "ecommerce" }));
    const kinds = model.warnings.map((w) => w.kind);
    expect(kinds).not.toContain("missing_reference");
    // Sin equipos en el catálogo de prueba, solo falta el equipo del nodo «Asignar a equipo».
    expect(model.warnings.filter((w) => w.kind === "unconfigured_node")).toHaveLength(1);
    expect(kinds).not.toContain("no_trigger");
    expect(kinds).not.toContain("duplicate_keyword");
  });

  it("filtra solo los publicados", async () => {
    const catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
    const draftId = catalog.flows[0].id;
    catalog.flows[0] = { ...catalog.flows[0], status: "draft" };
    const model = filterPublished(buildFlowMap(catalog));
    expect(model.cards.some((c) => c.id === draftId)).toBe(false);
    expect(model.cards).toHaveLength(catalog.flows.length - 1);
  });
});

describe("avisos con catálogos de prueba", () => {
  it("detecta una palabra clave repetida entre flujos publicados (ignora tildes y mayúsculas)", () => {
    const catalog = normalizeCatalog({
      flows: [
        simpleFlow("a", "Precios", [keywordTrigger("t", ["Precio", "catálogo"]), message("m", "Hola")], [{ source: "t", target: "m" }]),
        simpleFlow("b", "Catálogo", [keywordTrigger("t", ["CATALOGO"]), message("m", "Mira")], [{ source: "t", target: "m" }]),
        simpleFlow("c", "Borrador", [keywordTrigger("t", ["precio"]), message("m", "x")], [{ source: "t", target: "m" }], "draft"),
      ],
    });
    const model = buildFlowMap(catalog);
    const dup = model.warnings.filter((w) => w.kind === "duplicate_keyword");
    expect(dup).toHaveLength(1);
    expect(dup[0].flowIds.sort()).toEqual(["a", "b"]);
    expect(dup[0].message).toContain("Precios");
    expect(dup[0].message).toContain("Catálogo");
    expect(model.lanes.find((l) => l.id === "keywords")!.flowIds).toEqual(["a", "b", "c"]);
  });

  it("avisa de flujos publicados sin disparador, salvo los que alcanza un «Ir a flujo»", () => {
    const goTo: LabNode = { id: "g", type: "action", data: { actionType: "goToFlow", flowId: "alcanzado" } };
    const catalog = normalizeCatalog({
      flows: [
        simpleFlow("origen", "Origen", [keywordTrigger("t", ["hola"]), goTo], [{ source: "t", target: "g" }]),
        simpleFlow("alcanzado", "Alcanzado", [message("m", "Hola")]),
        simpleFlow("huerfano", "Huérfano", [message("m", "Hola")]),
        simpleFlow("borrador", "Borrador", [message("m", "Hola")], [], "draft"),
      ],
    });
    const model = buildFlowMap(catalog);
    const noTrigger = model.warnings.filter((w) => w.kind === "no_trigger").flatMap((w) => w.flowIds);
    expect(noTrigger).toEqual(["huerfano"]);
    expect(model.cards.find((c) => c.id === "huerfano")!.lane).toBe("none");
    expect(model.connections).toContainEqual(expect.objectContaining({ kind: "goto", from: flowNodeId("origen"), to: flowNodeId("alcanzado") }));
  });

  it("avisa de «Ir a flujo» roto o hacia un borrador, y de secuencias y gestiones sin configurar", () => {
    const nodes: LabNode[] = [
      keywordTrigger("t", ["hola"]),
      { id: "g1", type: "action", data: { actionType: "goToFlow", flowId: "no-existe" } },
      { id: "g2", type: "action", data: { actionType: "goToFlow", flowId: "borrador" } },
      { id: "c", type: "action", data: { actionType: "classifyCase" } },
      { id: "s", type: "action", data: { actionType: "changeStage", stageId: "etapa-archivada" } },
      { id: "q", type: "action", data: { actionType: "enrollSequence", sequenceId: "seq-1" } },
    ];
    const catalog = normalizeCatalog({
      flows: [
        simpleFlow("a", "A", nodes, [
          { source: "t", target: "g1" },
          { source: "g1", target: "g2" },
          { source: "g2", target: "c" },
          { source: "c", target: "s" },
          { source: "s", target: "q" },
        ]),
        simpleFlow("borrador", "B", [message("m", "x")], [], "draft"),
      ],
    });
    const model = buildFlowMap(catalog, { sequences: [{ id: "seq-1", name: "Bienvenida de 7 días" }] });
    const kinds = model.warnings.map((w) => w.kind);
    expect(kinds).toContain("draft_target");
    expect(kinds).toContain("unconfigured_node");
    expect(kinds.filter((k) => k === "missing_reference")).toHaveLength(2);
    expect(model.sequences).toEqual([{ id: "seq-1", name: "Bienvenida de 7 días", known: true }]);
    expect(model.connections.some((c) => c.kind === "sequence")).toBe(true);
  });

  it("avisa de disparadores que apuntan a etapas o tipos que ya no existen", async () => {
    const catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
    const id = flowIdOf(catalog, "Datos de pago");
    const stageTrigger = catalog.triggers.find((t) => t.flowId === id)!;
    stageTrigger.config = { ...(stageTrigger.config as object), stage_id: "etapa-archivada" };
    const recordatorio = catalog.triggers.find((t) => t.flowId === flowIdOf(catalog, "Recordatorio de pago"))!;
    recordatorio.type = "case_closed";
    recordatorio.config = { case_type_id: "tipo-archivado" };

    const model = buildFlowMap(catalog);
    const missing = model.warnings.filter((w) => w.kind === "missing_reference");
    expect(missing.map((w) => w.flowIds[0]).sort()).toEqual([id, flowIdOf(catalog, "Recordatorio de pago")].sort());
    // Sin conexión hacia una etapa que no existe.
    expect(model.connections.some((c) => c.to === flowNodeId(id) && c.kind === "stage")).toBe(false);
  });

  it("conecta el cierre con los flujos «case_closed» y «cualquier etapa» con el tipo", async () => {
    const catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
    const venta = catalog.caseTypes.find((t) => t.name === "Venta")!;
    const gracias = flowIdOf(catalog, "Gracias por tu compra");
    const t = catalog.triggers.find((x) => x.flowId === gracias)!;
    const closedConfig = (t.config ?? {}) as Record<string, unknown>;
    const model = buildFlowMap(catalog);

    if (t.type === "case_closed") {
      expect(closedConfig.case_type_id).toBe(venta.id);
      expect(model.connections).toContainEqual(expect.objectContaining({ kind: "closed", from: closeNodeId(venta.id), to: flowNodeId(gracias) }));
    }

    const any = { ...catalog, triggers: catalog.triggers.map((x) => (x === t ? { ...x, type: "case_stage_changed", config: { case_type_id: venta.id } } : x)) };
    const anyModel = buildFlowMap(any);
    expect(anyModel.connections).toContainEqual(expect.objectContaining({ kind: "stage", from: caseTypeNodeId(venta.id), to: flowNodeId(gracias) }));
    expect(anyModel.warnings.some((w) => w.kind === "broad_trigger")).toBe(true);
  });

  it("detecta caminos sin salida y nodos sin conectar", () => {
    const nodes: LabNode[] = [
      keywordTrigger("t", ["hola"]),
      { id: "c", type: "condition", data: { conditions: [{ field: "tag", operator: "exists", value: "vip" }], logic: "and" } },
      message("m", "Eres VIP"),
      { id: "w", type: "action", data: { actionType: "smartDelay", timeout: 5, timeoutUnit: "minutes" } },
      message("suelto", "Nadie llega aquí"),
    ];
    const catalog = normalizeCatalog({
      flows: [
        simpleFlow("a", "A", nodes, [
          { source: "t", target: "c" },
          { source: "c", target: "m", sourceHandle: "yes" },
          { source: "m", target: "w" },
        ]),
      ],
    });
    const model = buildFlowMap(catalog);
    const dead = model.warnings.filter((w) => w.kind === "dead_end");
    expect(dead.map((w) => w.nodeIds[0]).sort()).toEqual(["c", "w"]);
    expect(dead.find((w) => w.nodeIds[0] === "c")!.severity).toBe("info");
    const loose = model.warnings.find((w) => w.kind === "disconnected_node")!;
    expect(loose.nodeIds).toEqual(["suelto"]);
  });

  it("avisa de más de un flujo de bienvenida o de respuesta por defecto publicados", () => {
    const welcome = (id: string): LabNode => ({ id, type: "trigger", data: { triggerType: "welcome" } });
    const catalog = normalizeCatalog({
      flows: [
        simpleFlow("a", "A", [welcome("t"), message("m", "1")], [{ source: "t", target: "m" }]),
        simpleFlow("b", "B", [welcome("t"), message("m", "2")], [{ source: "t", target: "m" }]),
      ],
    });
    const model = buildFlowMap(catalog);
    expect(model.warnings.some((w) => w.kind === "duplicate_welcome")).toBe(true);
    expect(model.lanes[0].flowIds).toEqual(["a", "b"]);
  });
});
