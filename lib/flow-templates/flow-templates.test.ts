import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { BUSINESS_TEMPLATES } from "@/lib/business-templates";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { simulateFlow, type SimulationResult, type SimulationStep } from "@/lib/flow-engine/simulator";
import { BUILDER_TRIGGER_TYPES, buildDesiredTriggers } from "@/lib/flow-triggers";
import {
  BUSINESS_FILTERS,
  FLOW_TEMPLATES,
  categoriesOf,
  defaultBusinessFilter,
  getFlowTemplate,
  summarizeTemplate,
  templatesForBusiness,
} from "./index";
import { installFlowTemplate } from "./install";
import { resolveFlowTemplate, type CanvasNode } from "./resolve";
import type { FlowTemplate, TemplateCatalog, TemplateEdge } from "./types";

// ── Catálogo de pruebas: los tipos de gestión reales de las plantillas de negocio ──

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${++idCounter}`;

function fullCatalog(): TemplateCatalog {
  const caseTypes = [...BUSINESS_TEMPLATES.ecommerce.caseTypes, ...BUSINESS_TEMPLATES.gym.caseTypes].map((t) => ({
    id: newId("tipo"),
    name: t.name,
    stages: t.stages.map((s) => ({ id: newId("etapa"), name: s.name, kind: s.kind })),
    categories: (t.categories ?? []).map((c) => ({ id: newId("categoria"), name: c.name })),
  }));
  return {
    caseTypes,
    teams: ["Atención", "Sede 1", "Sede 2", "Sede 3"].map((name) => ({ id: newId("equipo"), name })),
    contactTypes: [{ id: newId("ct"), name: "Prospecto" }],
  };
}

const CATALOG = fullCatalog();
const stageId = (type: string, stage: string) =>
  CATALOG.caseTypes.find((t) => t.name === type)!.stages.find((s) => s.name === stage)!.id;
const teamId = (name: string) => CATALOG.teams.find((t) => t.name === name)!.id;
const categoryId = (type: string, category: string) =>
  CATALOG.caseTypes.find((t) => t.name === type)!.categories!.find((c) => c.name === category)!.id;

function resolved(template: FlowTemplate, catalog = CATALOG) {
  return resolveFlowTemplate(template, catalog);
}

const allIds = FLOW_TEMPLATES.map((t) => t.id);

// ── Biblioteca ──────────────────────────────────────────────────────────────

describe("biblioteca de plantillas", () => {
  it("tiene las plantillas pedidas por negocio", () => {
    const byBusiness = (b: string) => FLOW_TEMPLATES.filter((t) => t.business === b).map((t) => t.name);
    expect(byBusiness("ecommerce")).toEqual([
      "Bienvenida y clasificación",
      "Catálogo y precios",
      "Datos de pago",
      "Recordatorio de pago",
      "Gracias por tu compra",
      "Estado de pedido",
      "Encuesta de satisfacción",
      "Recompra interesada",
    ]);
    expect(byBusiness("gym")).toEqual([
      "Bienvenida y sede",
      "Agendar visita o clase de prueba",
      "Recordatorio de visita no asistida",
      "Bienvenida al nuevo socio",
      "Congelamiento",
      "Renovación interesada",
      "Horarios de la sede",
    ]);
    expect(byBusiness("general")).toEqual([
      "Bienvenida simple",
      "Hablar con un asesor",
      "Respuesta cuando ningún flujo aplica",
      "Darse de baja",
      "Preguntas frecuentes",
      "Captura de clientes potenciales",
    ]);
  });

  it("los ids son únicos y cada plantilla tiene descripción, categoría y qué ajustar", () => {
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const t of FLOW_TEMPLATES) {
      expect(t.description.length, t.id).toBeGreaterThan(30);
      expect(t.category, t.id).toBeTruthy();
      expect(t.adjust.length, t.id).toBeGreaterThan(0);
      for (const required of t.requires ?? []) expect(allIds, `${t.id} requiere ${required}`).toContain(required);
    }
  });

  it("los datos de ejemplo marcados para reemplazar se explican en \"qué ajustar\"", () => {
    for (const t of FLOW_TEMPLATES) {
      const text = JSON.stringify(t.graph.nodes.map((n) => n.data));
      if (text.includes("[REEMPLAZA")) {
        expect(t.adjust.join(" ").toLowerCase(), t.id).toContain("reemplaza");
      }
    }
  });

  it("los campos personalizados que usa cada plantilla están declarados", () => {
    for (const t of FLOW_TEMPLATES) {
      const used = t.graph.nodes.filter((n) => n.data.actionType === "setCustomField").map((n) => n.data.fieldSlug);
      const declared = (t.customFields ?? []).map((f) => f.slug);
      expect(declared.sort(), t.id).toEqual([...new Set(used)].sort());
    }
  });

  it("ninguna plantilla depende de parches del motor", () => {
    for (const t of FLOW_TEMPLATES) {
      // La respuesta por defecto es opcional: las preguntas se retoman solas.
      expect(t.requires ?? [], t.id).not.toContain("general-respuesta-defecto");
      // Las condiciones sobre el mensaje no repiten variantes de mayúsculas.
      for (const n of t.graph.nodes.filter((x) => x.type === "condition")) {
        const conditions = n.data.conditions as Array<{ field: string; operator: string; value: string }>;
        if (n.data.logic === "or") {
          const values = conditions.map((c) => c.value.toLowerCase());
          expect(new Set(values).size, `${t.id}/${n.id} repite una comparación`).toBe(values.length);
        }
      }
      // Tampoco etiquetas que reemplacen a una categoría ni avisos de límites del motor.
      expect(t.adjust.join(" "), t.id).not.toMatch(/todavía no|reemplaza a mano|elige la categoría de la gestión a mano/i);
    }
    const flujo = getFlowTemplate("general-respuesta-defecto")!;
    expect(flujo.name).toBe("Respuesta cuando ningún flujo aplica");
    expect(flujo.adjust.join(" ")).toContain("opcional");
  });

  it("clasificar con categoría en vez de la etiqueta de reemplazo", () => {
    for (const id of ["ecommerce-estado-pedido", "gym-congelamiento"]) {
      const t = getFlowTemplate(id)!;
      expect(t.graph.nodes.some((n) => n.data.actionType === "addTag"), id).toBe(false);
      expect(t.graph.nodes.find((n) => n.data.actionType === "classifyCase")!.refs?.category, id).toBeTruthy();
    }
  });

  it("las plantillas generales no dependen del tipo de negocio", () => {
    for (const t of FLOW_TEMPLATES.filter((x) => x.business === "general")) {
      expect(t.graph.nodes.filter((n) => n.refs).length, t.id).toBe(0);
    }
  });
});

// ── Grafos válidos ──────────────────────────────────────────────────────────

function outgoing(edges: TemplateEdge[], id: string) {
  return edges.filter((e) => e.source === id);
}

function reachable(template: FlowTemplate): Set<string> {
  const trigger = template.graph.nodes.find((n) => n.type === "trigger")!;
  const seen = new Set<string>([trigger.id]);
  const queue = [trigger.id];
  while (queue.length) {
    for (const e of outgoing(template.graph.edges, queue.shift()!)) {
      if (!seen.has(e.target)) {
        seen.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return seen;
}

function hasCycle(template: FlowTemplate): boolean {
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    for (const e of outgoing(template.graph.edges, id)) if (visit(e.target)) return true;
    state.set(id, 2);
    return false;
  };
  return template.graph.nodes.some((n) => visit(n.id));
}

describe.each(FLOW_TEMPLATES.map((t) => [t.id, t] as const))("grafo de %s", (_id, template) => {
  const { nodes, edges } = template.graph;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  it("tiene un solo disparador y todos los nodos son alcanzables sin ciclos", () => {
    expect(nodes.filter((n) => n.type === "trigger")).toHaveLength(1);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    for (const e of edges) {
      expect(byId.has(e.source), `origen ${e.source}`).toBe(true);
      expect(byId.has(e.target), `destino ${e.target}`).toBe(true);
    }
    expect([...reachable(template)].sort()).toEqual(nodes.map((n) => n.id).sort());
    expect(hasCycle(template)).toBe(false);
  });

  it("las condiciones tienen destino en Sí y en No, y el resto de nodos una sola salida", () => {
    const openEnds = new Set(template.allowedOpenEnds ?? []);
    for (const n of nodes) {
      const out = outgoing(edges, n.id);
      if (n.type === "condition") {
        expect(out.some((e) => e.sourceHandle === "yes"), `${n.id} sin salida Sí`).toBe(true);
        if (!openEnds.has(n.id)) expect(out.some((e) => e.sourceHandle === "no"), `${n.id} sin salida No`).toBe(true);
        for (const e of out) expect(["yes", "no"]).toContain(e.sourceHandle);
        expect(out.length).toBeLessThanOrEqual(2);
      } else {
        expect(out.length, `${n.id} (${n.data.actionType ?? n.type})`).toBeLessThanOrEqual(1);
        for (const e of out) expect(e.sourceHandle).toBeUndefined();
      }
    }
  });

  it("el flujo termina: ninguna rama se queda en una espera o en una condición sin destino", () => {
    for (const n of nodes) {
      if (n.data.actionType === "smartDelay") expect(outgoing(edges, n.id), n.id).toHaveLength(1);
    }
  });

  it("los botones y respuestas rápidas tienen destino", () => {
    // Todas las plantillas de la biblioteca: los mensajes sin espera deben poder
    // contestarse con una palabra clave de alguna plantilla.
    const keywordTriggers = FLOW_TEMPLATES.flatMap((t) => t.graph.nodes)
      .filter((n) => n.type === "trigger" && n.data.triggerType === "keyword")
      .flatMap((n) => n.data.keywords as Array<{ value: string; matchType: string }>);
    const matches = (title: string) => {
      const text = title.toLowerCase();
      return keywordTriggers.some((k) => {
        const kw = k.value.toLowerCase();
        return k.matchType === "exact" ? text === kw : k.matchType === "startsWith" ? text.startsWith(kw) : text.includes(kw);
      });
    };

    for (const n of nodes.filter((x) => x.type === "sendMessage")) {
      const messages = n.data.messages as Array<{
        text: string;
        buttons?: Array<{ title: string; type: string; payload: string }>;
        quickReplies?: Array<{ title: string; payload: string }>;
      }>;
      const options = messages.flatMap((m) => [...(m.buttons ?? []), ...(m.quickReplies ?? [])]);
      if (options.length === 0) continue;
      for (const o of options) {
        expect(o.title.length, `título de ${n.id}`).toBeLessThanOrEqual(20);
        expect(o.payload, `payload de ${n.id}`).toBeTruthy();
      }
      const next = outgoing(edges, n.id)[0];
      const after = next ? byId.get(next.target) : undefined;
      if (after?.data.actionType === "smartDelay") {
        // Menú con espera: lo que sigue a la espera debe bifurcar según la respuesta.
        const following = byId.get(outgoing(edges, after.id)[0].target)!;
        expect(following.type, `${n.id}: tras la espera debe haber una condición`).toBe("condition");
      } else {
        for (const o of options) expect(matches(o.title), `"${o.title}" no activa ninguna plantilla`).toBe(true);
      }
    }
  });

  it("el disparador es válido para la base y se sincroniza al publicar", () => {
    const out = resolved(template);
    expect(out.notices.filter((x) => x.level === "warning")).toEqual([]);
    const rows = buildDesiredTriggers(out.nodes as unknown as Array<Record<string, unknown>>, "flujo-1");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(BUILDER_TRIGGER_TYPES as readonly string[]).toContain(row.type);
    expect(["keyword", "welcome", "default", "case_opened", "case_stage_changed", "case_closed", "client_no_reply"]).toContain(row.type);
    const config = row.config as Record<string, unknown>;
    if (row.type === "keyword") expect((config.keywords as unknown[]).length).toBeGreaterThan(0);
    if (row.type === "case_stage_changed") {
      expect(config.case_type_id).toBeTruthy();
      expect(config.stage_id).toBeTruthy();
    }
    if (row.type === "case_closed") {
      expect(config.case_type_id).toBeTruthy();
      expect(["won", "lost", "resolved"]).toContain(config.outcome);
    }
    if (row.type === "client_no_reply") {
      expect(config.case_type_id).toBeTruthy();
      expect(Number.isInteger(config.minutes) && (config.minutes as number) > 0).toBe(true);
    }
  });

  it("el atención humana va al final de su rama (detiene el flujo)", () => {
    for (const n of nodes.filter((x) => x.data.actionType === "humanTakeover")) {
      expect(outgoing(edges, n.id), n.id).toHaveLength(0);
    }
  });
});

describe("disparadores pedidos", () => {
  const trigger = (id: string) => getFlowTemplate(id)!.graph.nodes.find((n) => n.type === "trigger")!;
  const words = (id: string) => (trigger(id).data.keywords as Array<{ value: string }>).map((k) => k.value);

  it("palabras clave", () => {
    expect(words("ecommerce-catalogo")).toEqual(expect.arrayContaining(["precio", "precios", "catálogo", "catalogo", "lista"]));
    expect(words("ecommerce-estado-pedido")).toEqual(["pedido", "envío", "envio", "tracking", "seguimiento"]);
    expect(words("gym-congelamiento")).toEqual(["congelar", "congelamiento", "pausar"]);
    expect(words("gym-horarios")).toEqual(["horario", "horarios", "atienden"]);
    expect(words("general-asesor")).toEqual(["asesor", "humano", "persona", "agente"]);
    expect(words("general-baja")).toEqual(expect.arrayContaining(["baja", "stop", "no más mensajes"]));
  });

  it("eventos de gestión", () => {
    const t = (id: string) => ({ ...trigger(id).data, refs: trigger(id).refs });
    expect(t("ecommerce-bienvenida")).toMatchObject({ triggerType: "case_opened" });
    // Clasifica también a quien vuelve: solo gestiones nuevas que quedan sin clasificar.
    expect(t("ecommerce-bienvenida")).toMatchObject({ label: "Gestión nueva sin clasificar", onlyUnclassified: true });
    expect(t("ecommerce-datos-pago")).toMatchObject({
      triggerType: "case_stage_changed",
      refs: { caseType: "Venta", stage: "Pedido o enlace de pago enviado" },
    });
    expect(t("ecommerce-recordatorio-pago")).toMatchObject({
      triggerType: "client_no_reply",
      minutes: 120,
      refs: { caseType: "Venta" },
    });
    expect(t("ecommerce-gracias-compra")).toMatchObject({ triggerType: "case_closed", outcome: "won", refs: { caseType: "Venta" } });
    expect(t("ecommerce-encuesta")).toMatchObject({ triggerType: "case_closed", outcome: "resolved", refs: { caseType: "Postventa" } });
    expect(t("ecommerce-recompra")).toMatchObject({
      triggerType: "case_stage_changed",
      refs: { caseType: "Recompra", stage: "Interesado" },
    });
    expect(t("gym-recordatorio-visita")).toMatchObject({
      triggerType: "client_no_reply",
      minutes: 1440,
      refs: { caseType: "Venta de membresía" },
    });
    expect(t("gym-bienvenida-socio")).toMatchObject({
      triggerType: "case_closed",
      outcome: "won",
      refs: { caseType: "Venta de membresía" },
    });
    expect(t("gym-renovacion")).toMatchObject({
      triggerType: "case_stage_changed",
      refs: { caseType: "Renovación", stage: "Contactado" },
    });
  });
});

// ── Resolución por nombre ───────────────────────────────────────────────────

describe("resolución por nombre", () => {
  it("con todo el catálogo, ningún nodo de gestión queda sin configurar", () => {
    for (const template of FLOW_TEMPLATES) {
      const out = resolved(template);
      expect(out.notices, template.id).toEqual([]);
      for (const n of out.nodes) {
        const d = n.data;
        if (d.actionType === "classifyCase") expect(d.caseTypeId, `${template.id}/${n.id}`).toBeTruthy();
        if (d.actionType === "changeStage") expect(d.stageId, `${template.id}/${n.id}`).toBeTruthy();
        if (d.actionType === "assignTeam") expect(d.teamId, `${template.id}/${n.id}`).toBeTruthy();
        if (n.type === "condition") {
          for (const c of d.conditions as Array<{ field: string; value: string }>) {
            expect(c.value, `${template.id}/${n.id}/${c.field}`).not.toBe("");
          }
        }
      }
    }
  });

  it("cambia los nombres por los ids del espacio", () => {
    const out = resolved(getFlowTemplate("ecommerce-bienvenida")!);
    const venta = out.nodes.find((n) => n.data.label === "Clasificar como Venta")!;
    expect(venta.data).toMatchObject({
      actionType: "classifyCase",
      caseTypeId: CATALOG.caseTypes.find((t) => t.name === "Venta")!.id,
      caseTypeName: "Venta",
    });

    const pago = resolved(getFlowTemplate("ecommerce-datos-pago")!);
    expect(pago.nodes.find((n) => n.type === "trigger")!.data).toMatchObject({
      caseTypeId: CATALOG.caseTypes.find((t) => t.name === "Venta")!.id,
      stageId: stageId("Venta", "Pedido o enlace de pago enviado"),
    });
    expect(pago.nodes.find((n) => n.data.actionType === "changeStage")!.data).toMatchObject({
      stageId: stageId("Venta", "Esperando pago"),
      stageName: "Esperando pago",
    });

    const recordatorio = resolved(getFlowTemplate("ecommerce-recordatorio-pago")!);
    const condition = recordatorio.nodes.find((n) => n.type === "condition")!.data.conditions as Array<{ field: string; operator: string; value: string }>;
    expect(condition[0]).toEqual({ field: "case_stage", operator: "equals", value: stageId("Venta", "Esperando pago") });
  });

  it("Clasificar gestión lleva la categoría del tipo (Estado de pedido, Congelamiento)", () => {
    const pedido = resolved(getFlowTemplate("ecommerce-estado-pedido")!).nodes.find((n) => n.data.actionType === "classifyCase")!;
    expect(pedido.data).toMatchObject({
      caseTypeName: "Postventa",
      categoryId: categoryId("Postventa", "Estado de pedido"),
      categoryName: "Estado de pedido",
    });
    const congelar = resolved(getFlowTemplate("gym-congelamiento")!).nodes.find((n) => n.data.actionType === "classifyCase")!;
    expect(congelar.data).toMatchObject({
      caseTypeName: "Atención al socio",
      categoryId: categoryId("Atención al socio", "Congelamiento"),
    });
  });

  it("si la categoría no existe en el tipo, el nodo clasifica sin categoría y avisa", () => {
    const sinCategorias: TemplateCatalog = {
      ...CATALOG,
      caseTypes: CATALOG.caseTypes.map((t) => ({ ...t, categories: [] })),
    };
    const out = resolved(getFlowTemplate("ecommerce-estado-pedido")!, sinCategorias);
    const node = out.nodes.find((n) => n.data.actionType === "classifyCase")!;
    expect(node.data.caseTypeId).toBeTruthy();
    expect(node.data.categoryId).toBeUndefined();
    expect(out.notices.map((n) => n.message)).toEqual([
      'El tipo de gestión "Postventa" no tiene una categoría llamada "Estado de pedido"; el nodo clasifica sin categoría.',
    ]);
  });

  it("no modifica la plantilla original", () => {
    const template = getFlowTemplate("ecommerce-bienvenida")!;
    const before = JSON.stringify(template.graph);
    resolved(template);
    expect(JSON.stringify(template.graph)).toBe(before);
  });

  it("ignora mayúsculas, tildes y espacios de más", () => {
    const catalog: TemplateCatalog = {
      caseTypes: [],
      teams: [{ id: "t-aten", name: "  ATENCION  " }],
      contactTypes: [],
    };
    const out = resolved(getFlowTemplate("ecommerce-estado-pedido")!, catalog);
    expect(out.nodes.find((n) => n.data.actionType === "assignTeam")!.data).toMatchObject({ teamId: "t-aten", teamName: "  ATENCION  " });
  });

  it("sin coincidencias deja el nodo sin configurar y avisa", () => {
    const empty: TemplateCatalog = { caseTypes: [], teams: [], contactTypes: [] };
    const out = resolved(getFlowTemplate("ecommerce-estado-pedido")!, empty);
    const classify = out.nodes.find((n) => n.data.actionType === "classifyCase")!;
    const team = out.nodes.find((n) => n.data.actionType === "assignTeam")!;
    expect(classify.data.caseTypeId).toBeUndefined();
    expect(team.data.teamId).toBeUndefined();
    expect(out.notices.map((x) => x.message)).toEqual([
      'No existe el tipo de gestión "Postventa" en tu espacio; el nodo quedó sin configurar.',
      'No existe un equipo llamado "Atención"; el nodo quedó sin configurar. Elige el equipo en el nodo.',
    ]);
    expect(out.notices.every((x) => x.level === "warning" && x.nodeId && x.nodeLabel)).toBe(true);
  });

  it("una sede que no existe deja sin configurar solo su nodo", () => {
    const catalog: TemplateCatalog = {
      caseTypes: CATALOG.caseTypes,
      teams: CATALOG.teams.filter((t) => t.name !== "Sede 2"),
      contactTypes: [],
    };
    const out = resolved(getFlowTemplate("gym-bienvenida-sede")!, catalog);
    const assigns = out.nodes.filter((n) => n.data.actionType === "assignTeam");
    expect(assigns.map((n) => [n.data.label, Boolean(n.data.teamId)])).toEqual([
      ["Asignar al equipo Sede 1", true],
      ["Asignar al equipo Sede 2", false],
      ["Asignar al equipo Sede 3", true],
    ]);
    expect(out.notices).toHaveLength(1);
    expect(out.notices[0].message).toContain("Sede 2");
  });

  it("una etapa que no existe (o no es abierta) deja el nodo sin etapa y avisa", () => {
    const catalog: TemplateCatalog = {
      caseTypes: [
        {
          id: "v",
          name: "Venta",
          stages: [
            { id: "e1", name: "Asesorando", kind: "won" },
            { id: "e2", name: "Otra", kind: "open" },
          ],
        },
      ],
      teams: [],
      contactTypes: [],
    };
    const out = resolved(getFlowTemplate("ecommerce-catalogo")!, catalog);
    const node = out.nodes.find((n) => n.data.actionType === "changeStage")!;
    expect(node.data.stageId).toBeUndefined();
    expect(out.notices[0].message).toContain('no tiene una etapa abierta llamada "Asesorando"');
  });

  it("un disparador sin tipo o etapa avisa que se activaría con cualquiera", () => {
    const empty: TemplateCatalog = { caseTypes: [], teams: [], contactTypes: [] };
    const out = resolved(getFlowTemplate("ecommerce-datos-pago")!, empty);
    const trigger = out.nodes.find((n) => n.type === "trigger")!;
    expect(trigger.data.caseTypeId).toBeUndefined();
    expect(trigger.data.stageId).toBeUndefined();
    expect(out.notices.some((x) => x.nodeId === trigger.id && x.message.includes("cualquier"))).toBe(true);
    // El tipo faltante se avisa una sola vez por nodo.
    expect(out.notices.filter((x) => x.nodeId === trigger.id && x.message.includes('"Venta"'))).toHaveLength(1);
  });

  it("las condiciones por equipo quedan sin valor si el equipo no existe", () => {
    const empty: TemplateCatalog = { caseTypes: CATALOG.caseTypes, teams: [], contactTypes: [] };
    const out = resolved(getFlowTemplate("gym-horarios")!, empty);
    const conditions = out.nodes.filter((n) => n.type === "condition");
    expect(conditions).toHaveLength(3);
    for (const c of conditions) expect((c.data.conditions as Array<{ value: string }>)[0].value).toBe("");
    expect(out.notices).toHaveLength(3);
  });
});

// ── Instalación ─────────────────────────────────────────────────────────────

describe("instalación", () => {
  const WS = "ws-1";

  function seeded() {
    const fake = new FakeDb();
    fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
    for (const ct of CATALOG.caseTypes) {
      fake.seed("case_types", [{ id: ct.id, workspace_id: WS, name: ct.name }]);
      fake.seed(
        "case_categories",
        (ct.categories ?? []).map((c) => ({ id: c.id, case_type_id: ct.id, name: c.name })),
      );
      fake.seed(
        "case_stages",
        ct.stages.map((s) => ({ id: s.id, case_type_id: ct.id, name: s.name, kind: s.kind })),
      );
    }
    fake.seed(
      "teams",
      CATALOG.teams.map((t) => ({ id: t.id, workspace_id: WS, name: t.name })),
    );
    return fake;
  }

  it("crea el flujo como borrador, con los ids resueltos y sin publicarlo", async () => {
    const fake = seeded();
    const template = getFlowTemplate("ecommerce-estado-pedido")!;
    const installed = await installFlowTemplate(fake.asDb(), WS, template);

    const flows = fake.rows("flows");
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ id: installed.flowId, workspace_id: WS, name: "Estado de pedido", status: "draft" });
    expect(flows[0].published_at ?? null).toBeNull();
    const nodes = flows[0].nodes as CanvasNode[];
    expect(nodes.find((n) => n.data.actionType === "assignTeam")!.data.teamId).toBe(teamId("Atención"));
    expect((nodes[0] as unknown as { refs?: unknown }).refs).toBeUndefined();
    // Publicar es otro paso: no se crean disparadores.
    expect(fake.rows("triggers")).toHaveLength(0);
    expect(installed.adjust).toEqual(template.adjust);
  });

  it("instala con la categoría resuelta desde la base", async () => {
    const fake = seeded();
    await installFlowTemplate(fake.asDb(), WS, getFlowTemplate("gym-congelamiento")!);
    const nodes = fake.rows("flows")[0].nodes as CanvasNode[];
    expect(nodes.find((n) => n.data.actionType === "classifyCase")!.data.categoryId).toBe(
      categoryId("Atención al socio", "Congelamiento"),
    );
  });

  it("crea los campos personalizados que faltan, sin duplicar los existentes", async () => {
    const fake = seeded();
    const template = getFlowTemplate("gym-congelamiento")!;
    fake.seed("custom_field_definitions", [{ workspace_id: WS, name: "Motivo", slug: "motivo_congelamiento", type: "text" }]);

    const first = await installFlowTemplate(fake.asDb(), WS, template);
    expect(fake.rows("custom_field_definitions").map((f) => f.slug).sort()).toEqual(["fechas_congelamiento", "motivo_congelamiento"]);
    expect(first.notices.some((n) => n.level === "info" && n.message.includes("Fechas de congelamiento"))).toBe(true);

    const second = await installFlowTemplate(fake.asDb(), WS, template);
    expect(fake.rows("custom_field_definitions")).toHaveLength(2);
    expect(second.notices.filter((n) => n.level === "info")).toEqual([]);
    expect(fake.rows("flows")).toHaveLength(2);
  });

  it("si falta algo, crea el flujo igual y devuelve los avisos", async () => {
    const fake = new FakeDb();
    fake.seed("workspaces", [{ id: WS, name: "Gimnasio", slug: "gym", settings: {} }]);
    fake.seed("case_types", [{ id: "ct1", workspace_id: WS, name: "Venta de membresía" }]);
    fake.seed("case_stages", [{ id: "s1", case_type_id: "ct1", name: "Nuevo interesado", kind: "open" }]);
    fake.seed("teams", [{ id: "tm1", workspace_id: WS, name: "Sede 1" }]);

    const installed = await installFlowTemplate(fake.asDb(), WS, getFlowTemplate("gym-bienvenida-sede")!);
    const warnings = installed.notices.filter((n) => n.level === "warning");
    // Atención al socio, Sede 2 y Sede 3 no existen.
    expect(warnings.map((w) => w.message).join("\n")).toMatch(/Atención al socio[\s\S]*Sede 2[\s\S]*Sede 3/);
    expect(fake.rows("flows")[0].status).toBe("draft");
  });

  it("no mira los tipos, etapas ni equipos de otro espacio ni los archivados", async () => {
    const fake = new FakeDb();
    fake.seed("workspaces", [
      { id: WS, name: "A", slug: "a", settings: {} },
      { id: "ws-2", name: "B", slug: "b", settings: {} },
    ]);
    fake.seed("teams", [
      { id: "otro", workspace_id: "ws-2", name: "Atención" },
      { id: "viejo", workspace_id: WS, name: "Atención", archived_at: new Date().toISOString() },
    ]);
    const installed = await installFlowTemplate(fake.asDb(), WS, getFlowTemplate("ecommerce-estado-pedido")!);
    const team = (fake.rows("flows")[0].nodes as CanvasNode[]).find((n) => n.data.actionType === "assignTeam")!;
    expect(team.data.teamId).toBeUndefined();
    expect(installed.notices.some((n) => n.message.includes("Atención"))).toBe(true);
  });
});

// ── Filtros y resumen para la pantalla ──────────────────────────────────────

describe("pantalla de plantillas", () => {
  it("abre con el negocio del espacio", () => {
    expect(defaultBusinessFilter("ecommerce")).toBe("ecommerce");
    expect(defaultBusinessFilter("gym")).toBe("gym");
    expect(defaultBusinessFilter("general")).toBe("all");
    expect(defaultBusinessFilter("blank")).toBe("all");
    expect(defaultBusinessFilter(undefined)).toBe("all");
    expect(BUSINESS_FILTERS).toEqual(["all", "ecommerce", "gym", "general"]);
  });

  it("filtra por negocio (incluye las generales) y por categoría", () => {
    const ecommerce = templatesForBusiness("ecommerce", FLOW_TEMPLATES);
    expect(ecommerce.some((t) => t.business === "gym")).toBe(false);
    expect(ecommerce.some((t) => t.business === "general")).toBe(true);
    expect(templatesForBusiness("general", FLOW_TEMPLATES).every((t) => t.business === "general")).toBe(true);
    expect(templatesForBusiness("all", FLOW_TEMPLATES)).toHaveLength(FLOW_TEMPLATES.length);
    const categories = categoriesOf(templatesForBusiness("gym", FLOW_TEMPLATES));
    expect(categories).toEqual(expect.arrayContaining(["Bienvenida", "Agenda", "Socios", "Horarios"]));
    expect(new Set(categories).size).toBe(categories.length);
  });

  it("cada tarjeta tiene disparador, pasos y qué ajustar", () => {
    for (const t of FLOW_TEMPLATES) {
      const s = summarizeTemplate(t);
      expect(s.trigger, t.id).toBeTruthy();
      expect(s.steps.length, t.id).toBe(t.graph.nodes.length - 1);
      expect(s.steps.every(Boolean), t.id).toBe(true);
      expect(s.adjust, t.id).toEqual(t.adjust);
      // La tarjeta viaja al navegador: debe ser serializable.
      expect(() => JSON.stringify(s)).not.toThrow();
    }
    expect(summarizeTemplate(getFlowTemplate("ecommerce-recordatorio-pago")!).trigger).toBe(
      "El cliente no responde en 2 horas (gestión de Venta)",
    );
    expect(summarizeTemplate(getFlowTemplate("gym-recordatorio-visita")!).trigger).toContain("24 horas");
    expect(summarizeTemplate(getFlowTemplate("ecommerce-datos-pago")!).trigger).toBe(
      'La gestión de Venta pasa a la etapa "Pedido o enlace de pago enviado"',
    );
  });
});

// ── Simulador ───────────────────────────────────────────────────────────────

function stepsOf(result: SimulationResult | SimulationStep[]) {
  return Array.isArray(result) ? result : result.steps;
}

/** Detalle de las acciones y del traspaso a atención humana (con su nota). */
function details(steps: SimulationStep[]): string[] {
  return steps.flatMap((s) => {
    if (s.result.type === "action") return [s.result.detail];
    if (s.result.type === "human_takeover") return [s.result.note ? `Atención humana: ${s.result.note}` : "Atención humana"];
    return [];
  });
}

function texts(steps: SimulationStep[]): string[] {
  return steps.flatMap((s) => (s.result.type === "message" ? s.result.texts : []));
}

/**
 * Recorre la plantilla como una conversación: el primer mensaje inicia el flujo
 * y cada mensaje siguiente responde a una espera de respuesta del simulador.
 */
function simulateTurns(
  template: FlowTemplate,
  messages: string[],
  opts: { windowOpen?: boolean; mockCase?: Record<string, unknown> } = {},
  catalog = CATALOG,
) {
  const { nodes, edges } = resolved(template, catalog);
  const [first, ...replies] = messages;
  const result = simulateFlow(nodes as unknown as Node[], edges as unknown as Edge[], { incomingMessage: first, replies, ...opts });
  const answered = result.steps.filter((s) => s.result.type === "reply").length;
  expect(answered, "cada respuesta debe contestar una espera del flujo").toBe(replies.length);
  return {
    steps: result.steps.filter((s) => s.nodeType !== "end" && s.result.type !== "reply"),
    errors: result.errors,
    pendingWait: result.waiting?.waitingNodeId ?? null,
  };
}

describe("cada plantilla corre en el simulador", () => {
  const sampleMessage = (t: FlowTemplate) => {
    const trigger = t.graph.nodes.find((n) => n.type === "trigger")!;
    const keywords = trigger.data.keywords as Array<{ value: string }> | undefined;
    return keywords?.[0]?.value ?? "hola";
  };

  it.each(FLOW_TEMPLATES.map((t) => [t.id, t] as const))("%s: sin errores y con pasos reales", (_id, template) => {
    const { nodes, edges } = resolved(template);
    const result = simulateFlow(nodes as unknown as Node[], edges as unknown as Edge[], {
      incomingMessage: sampleMessage(template),
      // Respuestas de relleno para las esperas de la plantilla.
      replies: ["ok", "ok", "ok"],
      // Las plantillas con condición de gestión se prueban con la gestión que las dispara.
      mockCase: {
        stageId: CATALOG.caseTypes.flatMap((t) => t.stages).find((s) => s.name === "Esperando pago")!.id,
        teamId: teamId("Sede 1"),
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.steps.filter((s) => s.result.type === "error")).toEqual([]);
    expect(result.steps[0].result).toMatchObject({ type: "trigger", matched: true });
    expect(result.steps.length).toBeGreaterThan(2);
    expect(result.waiting).toBeUndefined();
    expect(result.completed).toBe(true);
    // Termina en el fin del flujo o, si pasa a una persona, en Atención humana.
    expect(["flow_end", "human_takeover"]).toContain(result.steps[result.steps.length - 1].result.type);
  });

  it("ecommerce: bienvenida con las tres opciones", () => {
    const template = getFlowTemplate("ecommerce-bienvenida")!;

    const venta = simulateTurns(template, ["hola", "Quiero comprar", "Creatina monohidratada"]);
    expect(venta.errors).toEqual([]);
    expect(details(venta.steps)).toEqual([
      'Clasificaría la gestión como "Venta"',
      "Asignar producto_interes = Creatina monohidratada",
      "Agregar etiqueta: Interesado en compra",
      "Repartiría la gestión a un asesor del equipo actual",
    ]);
    expect(texts(venta.steps).some((t) => t.includes("¿Qué producto estás buscando?"))).toBe(true);

    const pedido = simulateTurns(template, ["hola", "Mi pedido"]);
    expect(details(pedido.steps)).toEqual(['Clasificaría la gestión como "Postventa"', "Repartiría la gestión a un asesor del equipo actual"]);

    const otra = simulateTurns(template, ["hola", "Otra consulta"]);
    expect(details(otra.steps)).toEqual(['Clasificaría la gestión como "Consulta"', "Repartiría la gestión a un asesor del equipo actual"]);
  });

  it("ecommerce: catálogo envía el enlace y pasa la venta a Asesorando", () => {
    for (const message of ["precios", "catalogo"]) {
      const out = simulateTurns(getFlowTemplate("ecommerce-catalogo")!, [message]);
      expect(out.errors).toEqual([]);
      expect(texts(out.steps)[0]).toContain("catálogo");
      expect(details(out.steps)).toEqual(['Cambiaría la etapa de la gestión a "Asesorando"']);
    }
  });

  it("ecommerce: datos de pago y cambio a Esperando pago", () => {
    const out = simulateTurns(getFlowTemplate("ecommerce-datos-pago")!, [""]);
    expect(out.errors).toEqual([]);
    expect(texts(out.steps).join("\n")).toContain("Yape");
    expect(texts(out.steps).join("\n")).toContain("captura del pago");
    expect(details(out.steps)).toEqual(['Cambiaría la etapa de la gestión a "Esperando pago"']);
  });

  it("ecommerce: recordatorio de pago solo si sigue en Esperando pago, con plantilla si la ventana se cerró", () => {
    const template = getFlowTemplate("ecommerce-recordatorio-pago")!;
    const waiting = { stageId: stageId("Venta", "Esperando pago") };

    const open = simulateTurns(template, [""], { mockCase: waiting });
    expect(texts(open.steps)[0]).toContain("¿pudiste realizar el pago");

    const closed = simulateTurns(template, [""], { mockCase: waiting, windowOpen: false });
    expect(closed.steps.find((s) => s.result.type === "template")?.result).toEqual({
      type: "template",
      templateName: "recordatorio_pago",
      language: "es",
      params: ["Cliente de prueba"],
    });

    const paid = simulateTurns(template, [""], { mockCase: { stageId: stageId("Venta", "Asesorando") } });
    expect(texts(paid.steps)).toEqual([]);
    expect(paid.steps.some((s) => s.result.type === "template")).toBe(false);
  });

  it("ecommerce: gracias por tu compra", () => {
    const out = simulateTurns(getFlowTemplate("ecommerce-gracias-compra")!, [""]);
    const all = texts(out.steps).join("\n");
    expect(all).toContain("Gracias por tu compra");
    expect(all).toContain("Lima");
    expect(all).toContain("Provincia");
    expect(all).toContain("pedido");
  });

  it("ecommerce: estado de pedido guarda el número y asigna a Atención", () => {
    const out = simulateTurns(getFlowTemplate("ecommerce-estado-pedido")!, ["pedido", "PE-10458"]);
    expect(out.errors).toEqual([]);
    expect(details(out.steps)).toEqual([
      'Clasificaría la gestión como "Postventa", con la categoría "Estado de pedido"',
      "Asignar numero_pedido = PE-10458",
      'Asignaría la gestión al equipo "Atención" y la repartiría a un asesor del equipo',
    ]);
    expect(texts(out.steps).some((t) => t.includes("PE-10458"))).toBe(true);
  });

  it("ecommerce: sin el equipo Atención el simulador muestra el nodo sin configurar", () => {
    const sinEquipo: TemplateCatalog = { ...CATALOG, teams: [] };
    const out = simulateTurns(getFlowTemplate("ecommerce-estado-pedido")!, ["pedido", "PE-1"], {}, sinEquipo);
    expect(out.steps.some((s) => s.result.type === "error" && s.nodeType === "assignTeam")).toBe(true);
  });

  it("ecommerce: encuesta según la calificación", () => {
    const template = getFlowTemplate("ecommerce-encuesta")!;

    for (const nota of ["1", "2"]) {
      const out = simulateTurns(template, ["", nota]);
      expect(details(out.steps)).toEqual([
        "Agregar etiqueta: Insatisfecho",
        "Atención humana: Cliente insatisfecho en la encuesta de postventa (calificó 1 o 2). Contáctalo para entender qué pasó.",
      ]);
      expect(texts(out.steps).some((t) => t.includes("Lamentamos"))).toBe(true);
    }
    for (const nota of ["3", "4", "5"]) {
      const out = simulateTurns(template, ["", nota]);
      expect(details(out.steps)).toEqual(["Agregar etiqueta: Satisfecho"]);
    }
    const rara = simulateTurns(template, ["", "no sé"]);
    expect(details(rara.steps)).toEqual([]);
    expect(texts(rara.steps).some((t) => t.includes("Gracias por responder"))).toBe(true);
    const fuera = simulateTurns(template, ["", "9"]);
    expect(details(fuera.steps)).toEqual([]);
  });

  it("ecommerce: recompra interesada envía el enlace y ofrece un asesor", () => {
    const out = simulateTurns(getFlowTemplate("ecommerce-recompra")!, [""]);
    expect(texts(out.steps).join("\n")).toContain("volver a comprar");
    const message = out.steps.find((s) => s.result.type === "message")!;
    expect(message.nodeLabel).toContain("asesor");
  });

  it("gimnasio: bienvenida, clasificación y sede", () => {
    const template = getFlowTemplate("gym-bienvenida-sede")!;

    const venta = simulateTurns(template, ["hola", "Quiero inscribirme", "Sede 2"]);
    expect(venta.errors).toEqual([]);
    expect(details(venta.steps)).toEqual([
      'Clasificaría la gestión como "Venta de membresía"',
      'Asignaría la gestión al equipo "Sede 2" y la repartiría a un asesor del equipo',
    ]);

    const socio = simulateTurns(template, ["hola", "Ya soy socio", "Sede 3"]);
    expect(details(socio.steps)).toEqual([
      'Clasificaría la gestión como "Atención al socio"',
      'Asignaría la gestión al equipo "Sede 3" y la repartiría a un asesor del equipo',
    ]);

    const otra = simulateTurns(template, ["hola", "Otra consulta", "Sede 1"]);
    expect(details(otra.steps)[1]).toContain('"Sede 1"');

    const desconocida = simulateTurns(template, ["hola", "Otra consulta", "no sé"]);
    expect(details(desconocida.steps)).toEqual([
      'Clasificaría la gestión como "Atención al socio"',
      "Repartiría la gestión a un asesor del equipo actual",
    ]);
    expect(texts(venta.steps).at(-1)).toContain("asesor de tu sede");
  });

  it("gimnasio: agendar visita guarda la respuesta y cambia la etapa", () => {
    const out = simulateTurns(getFlowTemplate("gym-agendar-visita")!, ["quiero una visita", "El sábado a las 10"]);
    expect(out.errors).toEqual([]);
    expect(details(out.steps)).toEqual([
      "Asignar visita_preferida = El sábado a las 10",
      'Cambiaría la etapa de la gestión a "Visita o clase de prueba agendada"',
      "Repartiría la gestión a un asesor del equipo actual",
    ]);
    expect(texts(out.steps).at(-1)).toContain("El sábado a las 10");
    expect(texts(out.steps).at(-1)).toContain("asesor te confirmará");
  });

  it("gimnasio: recordatorio de visita no asistida", () => {
    const template = getFlowTemplate("gym-recordatorio-visita")!;
    const agendada = { stageId: stageId("Venta de membresía", "Visita o clase de prueba agendada") };
    const open = simulateTurns(template, [""], { mockCase: agendada });
    expect(texts(open.steps)[0]).toContain("reprogramarla");
    const closed = simulateTurns(template, [""], { mockCase: agendada, windowOpen: false });
    expect(closed.steps.some((s) => s.result.type === "template")).toBe(true);
    const otra = simulateTurns(template, [""], { mockCase: { stageId: stageId("Venta de membresía", "Asesorando") } });
    expect(texts(otra.steps)).toEqual([]);
  });

  it("gimnasio: bienvenida al socio, renovación y congelamiento", () => {
    const socio = simulateTurns(getFlowTemplate("gym-bienvenida-socio")!, [""]);
    expect(texts(socio.steps).join("\n")).toMatch(/Bienvenido[\s\S]*reglas[\s\S]*horarios/);

    const renovacion = simulateTurns(getFlowTemplate("gym-renovacion")!, [""]);
    const all = texts(renovacion.steps).join("\n");
    expect(all).toContain("planes");
    expect(all).toContain("Yape");

    const congelar = simulateTurns(getFlowTemplate("gym-congelamiento")!, ["quiero congelar", "viaje por trabajo", "del 1 al 30 de junio"]);
    expect(congelar.errors).toEqual([]);
    expect(details(congelar.steps)).toEqual([
      'Clasificaría la gestión como "Atención al socio", con la categoría "Congelamiento"',
      "Asignar motivo_congelamiento = viaje por trabajo",
      "Asignar fechas_congelamiento = del 1 al 30 de junio",
      "Repartiría la gestión a un asesor del equipo actual",
      "Atención humana: Solicitud de congelamiento: revisa el motivo y las fechas guardados en los campos del contacto.",
    ]);
  });

  it("gimnasio: el horario depende del equipo de la gestión", () => {
    const template = getFlowTemplate("gym-horarios")!;
    for (const sede of ["Sede 1", "Sede 2", "Sede 3"]) {
      const out = simulateTurns(template, ["horarios"], { mockCase: { teamId: teamId(sede) } });
      expect(texts(out.steps)).toHaveLength(1);
      expect(texts(out.steps)[0]).toContain(`Horario de ${sede}`);
      expect(texts(out.steps)[0]).not.toContain("Estos son los horarios");
    }
    const sinSede = simulateTurns(template, ["horarios"]);
    const message = texts(sinSede.steps)[0];
    expect(message).toContain("Estos son los horarios de nuestras sedes");
    for (const sede of ["Sede 1", "Sede 2", "Sede 3"]) expect(message).toContain(`Horario de ${sede}`);
  });

  it("general: asesor, baja, respuesta por defecto, preguntas frecuentes y captura de datos", () => {
    const asesor = simulateTurns(getFlowTemplate("general-asesor")!, ["quiero hablar con un asesor"]);
    expect(details(asesor.steps)).toEqual([
      "Repartiría la gestión a un asesor del equipo actual",
      "Atención humana: El cliente pidió hablar con un asesor.",
    ]);

    const baja = simulateTurns(getFlowTemplate("general-baja")!, ["baja"]);
    expect(baja.steps.map((s) => s.result.type)).toEqual(["trigger", "unsubscribe", "message"]);

    const defecto = simulateTurns(getFlowTemplate("general-respuesta-defecto")!, ["cualquier cosa"]);
    expect(details(defecto.steps)).toEqual(["Repartiría la gestión a un asesor del equipo actual"]);

    const template = getFlowTemplate("general-faq")!;
    expect(texts(simulateTurns(template, ["ayuda"]).steps)[0]).toContain("Te puedo ayudar");
    expect(texts(simulateTurns(template, ["Ayuda"]).steps)[0]).toContain("Te puedo ayudar");
    expect(texts(simulateTurns(template, ["preguntas"]).steps)[0]).toContain("preguntas más frecuentes");

    const captura = simulateTurns(getFlowTemplate("general-captura-datos")!, ["me interesa", "Lucía Torres", "lucia@correo.pe"]);
    expect(details(captura.steps)).toEqual([
      "Asignar nombre_completo = Lucía Torres",
      "Asignar correo_electronico = lucia@correo.pe",
      "Agregar etiqueta: Cliente potencial",
    ]);
    expect(texts(captura.steps).some((t) => t.includes("¡Gracias, Lucía Torres!"))).toBe(true);

    const bienvenida = simulateTurns(getFlowTemplate("general-bienvenida-simple")!, ["hola"]);
    expect(bienvenida.steps.map((s) => s.result.type)).toEqual(["trigger", "message", "delay", "message"]);
  });
});
