import { beforeAll, describe, expect, it } from "vitest";
import type { BusinessHours } from "@/lib/business-hours";
import { normalizeCatalog } from "../catalog";
import { buildCatalogFromTemplates } from "../from-templates";
import type { LabCatalog, LabEdge, LabFlow, LabNode } from "../types";
import { exploreFlow, exploreSummaryText, highlightOfPath, type ExplorePath, type ExploreResult } from "./index";

// ── Plantillas de E-commerce y generales ────────────────────────────────────

let catalog: LabCatalog;
const flowId = (name: string) => {
  const flow = catalog.flows.find((f) => f.name === name);
  if (!flow) throw new Error(`No hay un flujo «${name}»`);
  return flow.id;
};

beforeAll(async () => {
  catalog = await buildCatalogFromTemplates({ business: "ecommerce" });
});

/** Camino cuyas elecciones (sin el arranque) son exactamente estas. */
function choicesOf(p: ExplorePath): string[] {
  return p.steps.filter((s) => s.kind !== "variant" && s.kind !== "start" && s.kind !== "time").map((s) => s.label);
}

function pathWith(result: ExploreResult, ...labels: string[]): ExplorePath | undefined {
  return result.paths.find((p) => {
    const choices = choicesOf(p);
    return choices.length === labels.length && labels.every((l, i) => choices[i] === l);
  });
}

describe("Bienvenida y clasificación", () => {
  let result: ExploreResult;
  beforeAll(() => {
    result = exploreFlow(catalog, { flowId: flowId("Bienvenida y clasificación") });
  });

  it("arranca con un cliente que vuelve (la gestión nueva queda sin clasificar)", () => {
    expect(result.starts).toHaveLength(1);
    expect(result.starts[0].ok).toBe(true);
    expect(result.starts[0].action).toContain("gestión nueva");
    expect(result.profileName).not.toBeNull();
  });

  it("produce los caminos de los tres botones y la respuesta libre, con la clasificación correcta", () => {
    const comprar = pathWith(result, "Pulsa «Quiero comprar»", "Escribe «Respuesta de prueba»");
    const pedido = pathWith(result, "Pulsa «Mi pedido»");
    const consulta = pathWith(result, "Pulsa «Otra consulta»");
    expect(comprar?.final.case?.type).toBe("Venta");
    expect(pedido?.final.case?.type).toBe("Postventa");
    expect(consulta?.final.case?.type).toBe("Consulta");

    // La respuesta libre se guarda como producto de interés y etiqueta al contacto.
    expect(comprar?.final.customFields.producto_interes).toBe("Respuesta de prueba");
    expect(comprar?.final.tags).toContain("Interesado en compra");
    expect(comprar?.changes).toContain("Campo «producto_interes»: «Respuesta de prueba»");
    expect(comprar?.end.kind).toBe("flow_end");
    expect(pedido?.end.kind).toBe("flow_end");

    // La conversación incluye lo que dijo el cliente y lo que contestó el bot.
    expect(comprar?.messages.map((m) => m.author)).toEqual(["client", "bot", "client", "bot", "client", "bot"]);
    expect(comprar?.messages[3].text).toContain("¿Qué producto");
    expect(pedido?.changes.join("\n")).toContain("Postventa");
  });

  it("añade la rama «el cliente no responde» en cada espera", () => {
    const sinRespuesta = result.paths.filter((p) => p.end.kind === "waiting");
    expect(sinRespuesta).toHaveLength(2);
    expect(pathWith(result, "El cliente no responde")?.end.text).toContain("Esperar la opción elegida");
    expect(pathWith(result, "Pulsa «Quiero comprar»", "El cliente no responde")?.end.text).toContain("Esperar el producto");
  });

  it("recorre todos los nodos y las dos salidas de cada condición", () => {
    expect(result.coverage.complete).toBe(true);
    expect(result.coverage.percent).toBe(100);
    expect(result.coverage.unreachedNodes).toEqual([]);
    expect(result.coverage.outputsTotal).toBe(4);
    expect(result.coverage.outputsReached).toBe(4);
  });

  it("arma el árbol de decisiones y numera los caminos en su orden", () => {
    expect(result.paths.map((p) => p.id)).toEqual(result.paths.map((_, i) => i + 1));
    const start = result.tree.children[0];
    expect(start.kind).toBe("start");
    expect(start.children.map((c) => c.label)).toEqual(["Pulsa «Quiero comprar»", "Pulsa «Mi pedido»", "Pulsa «Otra consulta»", "El cliente no responde"]);
    const leaves: number[] = [];
    const walk = (node: ExploreResult["tree"]) => {
      if (node.pathId) leaves.push(node.pathId);
      node.children.forEach(walk);
    };
    walk(result.tree);
    expect(leaves.sort((a, b) => a - b)).toEqual(result.paths.map((p) => p.id));
  });

  it("ilumina los nodos recorridos de cada camino", () => {
    const consulta = pathWith(result, "Pulsa «Otra consulta»")!;
    const [lit] = highlightOfPath(consulta);
    expect(lit.flowId).toBe(flowId("Bienvenida y clasificación"));
    expect(lit.nodeIds.length).toBe(consulta.visited.length);
    const comprar = pathWith(result, "Pulsa «Quiero comprar»", "Escribe «Respuesta de prueba»")!;
    expect(comprar.visited.length).toBeGreaterThan(consulta.visited.length);
  });

  it("con un perfil que no abre la gestión sin clasificar explica por qué no se dispara", () => {
    // Un contacto nuevo (Prospecto) se abre ya como Venta: la bienvenida no corre.
    const newContact = {
      id: "nuevo",
      name: "Prospecto nuevo",
      description: "",
      contact: {
        name: "Lucía",
        phone: "51999999999",
        contactTypeId: catalog.contactTypes.find((t) => t.name === "Prospecto")?.id ?? null,
        tags: [],
        customFields: {},
        subscribed: true,
        ownerId: null,
        teamId: null,
        keyDate: null,
        existed: false,
      },
      cases: [],
      messages: [],
      notices: [],
    };
    const r = exploreFlow(catalog, { flowId: flowId("Bienvenida y clasificación"), profile: newContact });
    expect(r.starts[0].ok).toBe(false);
    expect(r.starts[0].problem).toContain("sin clasificar");
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].end.kind).toBe("error");
    expect(r.coverage.complete).toBe(false);
  });
});

describe("Encuesta de satisfacción", () => {
  let result: ExploreResult;
  beforeAll(() => {
    result = exploreFlow(catalog, { flowId: flowId("Encuesta de satisfacción") });
  });

  const base = (...labels: string[]) => result.paths.find((p) => p.variant.length === 0 && JSON.stringify(choicesOf(p)) === JSON.stringify(labels));

  it("arranca cerrando como resuelta una gestión de Postventa", () => {
    expect(result.starts[0].ok).toBe(true);
    expect(result.starts[0].action).toBe("Se cierra como resuelta una gestión de Postventa");
    expect(result.initial.case?.type).toBe("Postventa");
  });

  it("genera las 5 notas", () => {
    for (const note of ["1", "2", "3", "4", "5"]) {
      const path = base(`Elige «${note}» (escribe ${note})`);
      expect(path, `nota ${note}`).toBeDefined();
      expect(path!.messages.find((m) => m.author === "client")?.text).toBe(note);
    }
  });

  it("etiqueta y deriva según la nota", () => {
    for (const note of ["1", "2"]) {
      const p = base(`Elige «${note}» (escribe ${note})`)!;
      expect(p.final.tags).toEqual(["Insatisfecho"]);
      expect(p.end.kind).toBe("human");
      expect(p.final.botPaused).toBe(true);
      expect(p.final.notes.join(" ")).toContain("insatisfecho");
    }
    for (const note of ["3", "4", "5"]) {
      const p = base(`Elige «${note}» (escribe ${note})`)!;
      expect(p.final.tags).toEqual(["Satisfecho"]);
      expect(p.end.kind).toBe("flow_end");
    }
  });

  it("prueba una respuesta que no es una nota y la ventana de 24 h cerrada", () => {
    const invalid = base("Escribe «Respuesta de prueba»");
    expect(invalid?.final.tags).toEqual([]);
    expect(invalid?.messages.at(-1)?.text).toContain("Gracias por responder");

    expect(result.variants).toEqual(["Ventana de 24 h de WhatsApp cerrada"]);
    const closed = result.paths.filter((p) => p.variant.length > 0);
    expect(closed.length).toBeGreaterThan(0);
    // La pregunta no se envía: el bot no dice nada antes de que el cliente conteste.
    expect(closed[0].messages[0].author).toBe("client");
    expect(closed[0].warnings.join(" ")).toContain("ventana de 24 h");
    expect(result.tree.children.map((c) => c.label)).toEqual(["Caso base", "Ventana de 24 h de WhatsApp cerrada"]);
  });

  it("sin variantes de ventana solo hay un caso", () => {
    const r = exploreFlow(catalog, { flowId: flowId("Encuesta de satisfacción"), windowVariants: false });
    expect(r.variants).toEqual([]);
    expect(r.paths.every((p) => p.variant.length === 0)).toBe(true);
    expect(r.tree.children[0].kind).toBe("start");
  });

  it("la cobertura es total", () => {
    expect(result.coverage.percent).toBe(100);
    expect(result.coverage.outputsReached).toBe(4);
  });

  it("en Instagram las notas llegan como respuestas rápidas", () => {
    const r = exploreFlow(catalog, { flowId: flowId("Encuesta de satisfacción"), channel: "instagram", windowVariants: false });
    const p = r.paths.find((x) => x.steps.some((s) => s.label === "Pulsa «5»"));
    expect(p?.steps.find((s) => s.label === "Pulsa «5»")?.input).toMatchObject({ kind: "button", buttonType: "quick_reply", title: "5" });
    expect(p?.final.tags).toEqual(["Satisfecho"]);
  });
});

describe("resumen en texto", () => {
  it("incluye el árbol, los caminos y la cobertura", () => {
    const text = exploreSummaryText(exploreFlow(catalog, { flowId: flowId("Bienvenida y clasificación") }));
    expect(text).toContain("Explorador de caminos: Bienvenida y clasificación");
    expect(text).toContain("Árbol de decisiones");
    expect(text).toContain("Pulsa «Mi pedido» → camino 3");
    expect(text).toContain("Camino 1:");
    expect(text).toContain("Todos los nodos y todas las salidas de condición se recorrieron.");
  });
});

// ── Flujos armados a mano ───────────────────────────────────────────────────

const n = (id: string, type: string, data: Record<string, unknown>): LabNode => ({ id, type, data, position: { x: 0, y: 0 } });
const e = (source: string, target: string, sourceHandle?: string): LabEdge => ({ source, target, sourceHandle: sourceHandle ?? null });
const keyword = (id: string, word: string) => n(id, "trigger", { label: "Palabra clave", triggerType: "keyword", keywords: [{ value: word, matchType: "contains" }] });
const say = (id: string, text: string, buttons: string[] = []) =>
  n(id, "sendMessage", {
    label: text,
    messages: [{ text, ...(buttons.length ? { buttons: buttons.map((t) => ({ title: t, type: "postback", payload: t.toLowerCase() })) } : {}) }],
  });
const wait = (id: string) => n(id, "action", { label: "Esperar", actionType: "smartDelay", timeout: 60, timeoutUnit: "minutes" });
const cond = (id: string, conditions: Array<{ field: string; operator: string; value: string }>, logic = "and") => n(id, "condition", { label: id, logic, conditions });
const tag = (id: string, name: string) => n(id, "action", { label: `Etiqueta ${name}`, actionType: "addTag", tagName: name });

function build(flows: Array<{ id: string; nodes: LabNode[]; edges: LabEdge[]; status?: LabFlow["status"] }>, extra: Partial<LabCatalog> = {}): LabCatalog {
  return normalizeCatalog({
    flows: flows.map((f) => ({ id: f.id, name: f.id, status: f.status ?? "published", nodes: f.nodes, edges: f.edges })),
    contactTypes: [{ id: "cot-1", name: "Cliente", isDefault: true, position: 0 }],
    members: [{ userId: "u-ana", name: "Ana", role: "member", availability: "available", lastAssignedAt: null }],
    ...extra,
  });
}

describe("condiciones sobre el contacto", () => {
  const vip = build([
    {
      id: "vip",
      nodes: [keyword("t", "hola"), cond("c", [{ field: "tag:VIP", operator: "equals", value: "true" }]), say("m1", "Hola VIP"), say("m2", "Hola"), tag("x", "Saludado")],
      edges: [e("t", "c"), e("c", "m1", "yes"), e("c", "m2", "no"), e("m1", "x")],
    },
  ]);

  it("prueba el flujo con y sin la etiqueta", () => {
    const r = exploreFlow(vip, { flowId: "vip" });
    expect(r.paths).toHaveLength(2);
    const botTexts = r.paths.map((p) => p.messages.filter((m) => m.author === "bot").map((m) => m.text));
    expect(botTexts).toContainEqual(["Hola"]);
    expect(botTexts).toContainEqual(["Hola VIP"]);
    expect(r.paths.map((p) => p.variant)).toContainEqual(["Con la etiqueta «VIP»"]);
    expect(r.coverage.complete).toBe(true);
    // La variante con etiqueta pasa por el nodo que agrega «Saludado».
    expect(r.paths.find((p) => p.variant.length > 0)?.final.tags).toEqual(["VIP", "Saludado"]);
  });

  it("sin variantes la cobertura muestra lo que no se recorrió", () => {
    const r = exploreFlow(vip, { flowId: "vip", variants: false });
    expect(r.paths).toHaveLength(1);
    expect(r.coverage.complete).toBe(false);
    expect(r.coverage.unreachedNodes.map((x) => x.nodeId).sort()).toEqual(["m1", "x"]);
    expect(r.coverage.unreachedOutputs.map((x) => x.description)).toEqual(["c → Sí"]);
    expect(r.coverage.percent).toBeLessThan(100);
  });

  it("descarta las variantes que no cambian nada", () => {
    // El flujo agrega la etiqueta antes de preguntar por ella: tenerla o no al empezar da lo mismo.
    const self = build([
      {
        id: "self",
        nodes: [keyword("t", "hola"), tag("x", "VIP"), cond("c", [{ field: "tag:VIP", operator: "equals", value: "true" }]), say("m1", "Eres VIP"), say("m2", "No eres VIP")],
        edges: [e("t", "x"), e("x", "c"), e("c", "m1", "yes"), e("c", "m2", "no")],
      },
    ]);
    const r = exploreFlow(self, { flowId: "self" });
    expect(r.paths).toHaveLength(1);
    expect(r.variants).toEqual([]);
    expect(r.coverage.unreachedNodes.map((x) => x.nodeId)).toEqual(["m2"]);
  });

  it("explora dentro y fuera de horario", () => {
    const weekdays: BusinessHours = { mon: [["09:00", "18:00"]], tue: [["09:00", "18:00"]], wed: [["09:00", "18:00"]], thu: [["09:00", "18:00"]], fri: [["09:00", "18:00"]] };
    const open = build(
      [
        {
          id: "horario",
          nodes: [keyword("t", "hola"), cond("c", [{ field: "within_hours", operator: "equals", value: "true" }]), say("m1", "Te atendemos"), say("m2", "Estamos cerrados")],
          edges: [e("t", "c"), e("c", "m1", "yes"), e("c", "m2", "no")],
        },
      ],
      { workspaceHours: weekdays },
    );
    const r = exploreFlow(open, { flowId: "horario" });
    expect(r.paths).toHaveLength(2);
    expect(r.paths.map((p) => p.messages.find((m) => m.author === "bot")?.text).sort()).toEqual(["Estamos cerrados", "Te atendemos"]);
    expect(r.variants).toEqual(["Fuera del horario de atención"]);
    expect(r.coverage.complete).toBe(true);

    // Sin horario (24 h) no hay forma de probar «fuera de horario»: se avisa.
    const always = build([
      {
        id: "h",
        nodes: [keyword("t", "hola"), cond("c", [{ field: "within_hours", operator: "equals", value: "true" }]), say("m1", "Sí"), say("m2", "No")],
        edges: [e("t", "c"), e("c", "m1", "yes"), e("c", "m2", "no")],
      },
    ]);
    const r24 = exploreFlow(always, { flowId: "h" });
    expect(r24.paths).toHaveLength(1);
    expect(r24.notes.join(" ")).toContain("fuera de horario");
    expect(r24.coverage.unreachedNodes.map((x) => x.nodeId)).toEqual(["m2"]);
  });

  it("avisa de las variables que no puede fijar", () => {
    const flow = build([
      {
        id: "v",
        nodes: [keyword("t", "hola"), cond("c", [{ field: "variable:plan", operator: "equals", value: "oro" }]), say("m1", "Oro"), say("m2", "Otro")],
        edges: [e("t", "c"), e("c", "m1", "yes"), e("c", "m2", "no")],
      },
    ]);
    const r = exploreFlow(flow, { flowId: "v" });
    expect(r.notes.join(" ")).toContain("«plan»");
    expect(r.coverage.unreachedNodes.map((x) => x.nodeId)).toEqual(["m1"]);
  });
});

describe("respuestas del cliente", () => {
  it("genera una respuesta que entre por cada rama y una que no entre por ninguna", () => {
    const flow = build([
      {
        id: "faq",
        nodes: [
          keyword("t", "ayuda"),
          say("q", "¿Sobre qué?"),
          wait("w"),
          cond("c1", [{ field: "variable:message", operator: "contains", value: "envio" }]),
          cond("c2", [{ field: "variable:message", operator: "equals", value: "horario" }]),
          say("a1", "Envíos en 24 h"),
          say("a2", "De 9 a 18"),
          say("a3", "No entendí"),
        ],
        edges: [e("t", "q"), e("q", "w"), e("w", "c1"), e("c1", "a1", "yes"), e("c1", "c2", "no"), e("c2", "a2", "yes"), e("c2", "a3", "no")],
      },
    ]);
    const r = exploreFlow(flow, { flowId: "faq", noReply: false });
    const replies = r.paths.map((p) => p.messages.filter((m) => m.author === "client").at(-1)?.text);
    expect(replies).toEqual(["Respuesta de prueba", "envio", "horario"]);
    expect(r.paths.map((p) => p.messages.at(-1)?.text)).toEqual(["No entendí", "Envíos en 24 h", "De 9 a 18"]);
    expect(r.coverage.complete).toBe(true);
  });

  it("combina varias condiciones sobre el mensaje (rangos)", () => {
    const flow = build([
      {
        id: "rango",
        nodes: [
          keyword("t", "nota"),
          say("q", "¿Del 1 al 10?"),
          wait("w"),
          cond("c", [
            { field: "variable:message", operator: "gt", value: "4" },
            { field: "variable:message", operator: "lt", value: "8" },
          ]),
          say("a", "Medio"),
          say("b", "Extremo"),
        ],
        edges: [e("t", "q"), e("q", "w"), e("w", "c"), e("c", "a", "yes"), e("c", "b", "no")],
      },
    ]);
    const r = exploreFlow(flow, { flowId: "rango", noReply: false });
    const last = r.paths.map((p) => p.messages.at(-1)?.text).sort();
    expect(last).toEqual(["Extremo", "Medio"]);
    expect(r.coverage.complete).toBe(true);
  });
});

describe("límites y ciclos", () => {
  const loop = build([
    {
      id: "loop",
      nodes: [keyword("t", "hola"), say("q", "¿Aceptas?", ["Sí", "No"]), wait("w"), cond("c", [{ field: "variable:message", operator: "equals", value: "Sí" }]), say("ok", "Gracias")],
      edges: [e("t", "q"), e("q", "w"), e("w", "c"), e("c", "ok", "yes"), e("c", "q", "no")],
    },
  ]);

  it("detecta el ciclo cuando el flujo vuelve a esperar en el mismo punto", () => {
    const r = exploreFlow(loop, { flowId: "loop", noReply: false });
    expect(r.paths.map((p) => p.end.kind).sort()).toEqual(["cycle", "flow_end"]);
    expect(r.paths.find((p) => p.end.kind === "cycle")?.end.text).toContain("Ciclo");
    expect(r.truncated.depth).toBe(false);
  });

  it("corta por la profundidad máxima", () => {
    const chain = build([
      { id: "chain", nodes: [keyword("t", "hola"), wait("w1"), wait("w2"), wait("w3"), say("fin", "Fin")], edges: [e("t", "w1"), e("w1", "w2"), e("w2", "w3"), e("w3", "fin")] },
    ]);
    const full = exploreFlow(chain, { flowId: "chain", noReply: false });
    expect(full.paths).toHaveLength(1);
    expect(full.paths[0].end.kind).toBe("flow_end");
    const cut = exploreFlow(chain, { flowId: "chain", noReply: false, maxDepth: 2 });
    expect(cut.paths).toHaveLength(1);
    expect(cut.paths[0].end.kind).toBe("depth_limit");
    expect(cut.truncated.depth).toBe(true);
    expect(cut.coverage.unreachedNodes.map((x) => x.nodeId)).toEqual(["fin"]);
  });

  it("respeta el máximo de caminos y marca las ramas sin explorar", () => {
    const r = exploreFlow(catalog, { flowId: flowId("Encuesta de satisfacción"), maxPaths: 4, windowVariants: false });
    expect(r.paths.length).toBeLessThanOrEqual(4);
    expect(r.truncated.paths).toBe(true);
    expect(r.notes.join(" ")).toContain("máximo de 4 caminos");
    const skipped: string[] = [];
    const walk = (node: ExploreResult["tree"]) => {
      if (node.skipped) skipped.push(node.label);
      node.children.forEach(walk);
    };
    walk(r.tree);
    expect(skipped.length).toBeGreaterThan(0);
    // Se exploran primero las primeras opciones: la 1 está, la última (sin respuesta) no.
    expect(r.paths.some((p) => p.steps.some((s) => s.label.includes("«1»")))).toBe(true);
    expect(r.paths.some((p) => p.end.kind === "waiting")).toBe(false);
  });

  it("no se pasa del máximo de caminos con variantes", () => {
    const r = exploreFlow(catalog, { flowId: flowId("Encuesta de satisfacción"), maxPaths: 9 });
    expect(r.paths.length).toBeLessThanOrEqual(9);
  });

  it("corta por el tope de acciones del simulador", () => {
    const r = exploreFlow(catalog, { flowId: flowId("Encuesta de satisfacción"), maxActions: 3, windowVariants: false });
    expect(r.truncated.actions).toBe(true);
  });
});

describe("saltos, esperas y pruebas A/B", () => {
  it("el camino termina en otro flujo cuando salta a él", () => {
    const flows = build([
      { id: "a", nodes: [keyword("t", "hola"), say("m", "Te paso"), n("g", "action", { label: "Ir a B", actionType: "goToFlow", flowId: "b" })], edges: [e("t", "m"), e("m", "g")] },
      { id: "b", status: "draft", nodes: [n("tb", "trigger", { triggerType: "keyword", keywords: [{ value: "zzz" }] }), say("mb", "Soy B")], edges: [e("tb", "mb")] },
    ]);
    const r = exploreFlow(flows, { flowId: "a" });
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].end.kind).toBe("goto");
    expect(r.paths[0].end.text).toContain("«b»");
    expect(r.paths[0].flowIds).toEqual(["a", "b"]);
    expect(r.paths[0].messages.map((m) => m.text)).toContain("Soy B");
    // La cobertura es la del flujo explorado.
    expect(r.coverage.complete).toBe(true);
    expect(highlightOfPath(r.paths[0]).map((h) => h.flowId)).toEqual(["a", "b"]);
  });

  it("avanza el tiempo de los nodos Espera", () => {
    const flow = build([
      { id: "d", nodes: [keyword("t", "hola"), n("w", "delay", { label: "Esperar", duration: 2, unit: "hours" }), say("m", "¿Sigues ahí?")], edges: [e("t", "w"), e("w", "m")] },
    ]);
    const r = exploreFlow(flow, { flowId: "d" });
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].steps.map((s) => s.kind)).toEqual(["start", "time"]);
    expect(r.paths[0].steps[1].label).toBe("Pasan 2 horas");
    expect(r.paths[0].end.kind).toBe("flow_end");
    expect(r.paths[0].messages.at(-1)?.text).toBe("¿Sigues ahí?");
  });

  it("prueba cada camino de una prueba A/B", () => {
    const flow = build([
      {
        id: "ab",
        nodes: [
          keyword("t", "hola"),
          n("s", "action", { label: "A/B", actionType: "abSplit", paths: [{ name: "A", weight: 50 }, { name: "B", weight: 50 }] }),
          say("ma", "Versión A"),
          say("mb", "Versión B"),
        ],
        edges: [e("t", "s"), e("s", "ma", "A"), e("s", "mb", "B")],
      },
    ]);
    const r = exploreFlow(flow, { flowId: "ab" });
    expect(r.paths.map((p) => p.messages.at(-1)?.text).sort()).toEqual(["Versión A", "Versión B"]);
    expect(r.coverage.complete).toBe(true);
    expect(r.coverage.outputsTotal).toBe(2);
  });

  it("un flujo sin disparador conocido no se puede arrancar", () => {
    const flow = build([{ id: "solo", nodes: [say("m", "Hola")], edges: [] }]);
    const r = exploreFlow(flow, { flowId: "solo" });
    expect(r.starts).toEqual([]);
    expect(r.paths).toEqual([]);
    expect(r.notes.join(" ")).toContain("no se pudo arrancar");
    expect(r.coverage.unreachedNodes).toHaveLength(1);
  });

  it("un flujo que no existe lanza un error claro", () => {
    expect(() => exploreFlow(catalog, { flowId: "no-existe" })).toThrow("no existe");
  });
});

describe("todas las plantillas", () => {
  it.each(["ecommerce", "gym", "general"] as const)("explora todos los flujos del negocio %s sin errores del explorador", async (business) => {
    const all = await buildCatalogFromTemplates({ business });
    expect(all.flows.length).toBeGreaterThan(0);
    for (const flow of all.flows) {
      const r = exploreFlow(all, { flowId: flow.id });
      expect(r.paths.length, flow.name).toBeGreaterThan(0);
      expect(r.paths.length, flow.name).toBeLessThanOrEqual(60);
      const errors = r.paths.filter((p) => p.end.kind === "error").map((p) => p.end.text);
      expect(errors, flow.name).toEqual([]);
    }
  });
});
