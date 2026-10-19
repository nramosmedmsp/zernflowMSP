// Comportamientos del motor del laboratorio fuera de los escenarios de las
// plantillas: canales, estado, selección de flujos, bucles, esperas, equipos y
// horarios, cierre, perfiles y carga del catálogo.

import { beforeAll, describe, expect, it } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import type { BusinessHours } from "@/lib/business-hours";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import * as lab from "./actions";
import { deriveTriggers, describeTrigger, normalizeCatalog } from "./catalog";
import { buildCatalogFromTemplates } from "./from-templates";
import { ecommerceCatalog, flowIdOf, MONDAY_10AM, returningCustomer, Script } from "./lab.test-helper";
import { loadLabCatalog } from "./load-catalog";
import { buildSampleProfiles } from "./profiles";
import { createLabState } from "./state";
import type { LabCatalog, LabEdge, LabFlow, LabNode } from "./types";

// ── Flujos a mano ───────────────────────────────────────────────────────────

const trigger = (data: Record<string, unknown>): LabNode => ({ id: "t", type: "trigger", data: { label: "Disparador", ...data } });
const send = (id: string, messages: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): LabNode => ({
  id,
  type: "sendMessage",
  data: { label: `Mensaje ${id}`, messages, ...extra },
});
const action = (id: string, data: Record<string, unknown>): LabNode => ({ id, type: "action", data: { label: id, ...data } });
const edge = (source: string, target: string, sourceHandle?: string): LabEdge => ({ source, target, sourceHandle: sourceHandle ?? null });
const keywordFlow = (id: string, keyword: string, nodes: LabNode[], edges: LabEdge[], status: LabFlow["status"] = "published"): LabFlow => ({
  id,
  name: `Flujo ${id}`,
  status,
  nodes: [trigger({ triggerType: "keyword", keywords: [{ value: keyword, matchType: "contains" }] }), ...nodes],
  edges,
});

let base: LabCatalog;
beforeAll(async () => {
  base = await buildCatalogFromTemplates({ business: "ecommerce", flowTemplates: [] });
});

/** Catálogo de E-commerce (tipos de gestión, miembros) con los flujos dados. */
const withFlows = (flows: LabFlow[], extra: Partial<LabCatalog> = {}): LabCatalog =>
  normalizeCatalog({ ...base, flows, triggers: undefined, ...extra });

const existing = (catalog: LabCatalog, channel: "whatsapp" | "instagram" | "facebook" = "whatsapp") =>
  new Script(catalog, { channel, contact: { existed: true } });

// ── Canales y adaptación ────────────────────────────────────────────────────

describe("mensajes tal como se ven en cada canal", () => {
  const options = [
    { title: "Uno", type: "postback", payload: "uno" },
    { title: "Dos", type: "postback", payload: "dos" },
    { title: "Tres", type: "postback", payload: "tres" },
    { title: "Cuatro", type: "postback", payload: "cuatro" },
  ];
  const menu = (messages: Array<Record<string, unknown>>) =>
    withFlows([keywordFlow("menu", "menu", [send("m", messages)], [edge("t", "m")])]);

  it("tres botones: WhatsApp, Instagram y Facebook los muestran como botones", () => {
    const catalog = menu([{ text: "Elige", buttons: options.slice(0, 3) }]);
    for (const channel of ["whatsapp", "instagram", "facebook"] as const) {
      const s = existing(catalog, channel).says("menu");
      const msg = s.messages("bot")[0];
      expect(msg.buttons?.map((b) => b.title)).toEqual(["Uno", "Dos", "Tres"]);
      expect(msg.text).toBe("Elige");
      expect(msg.adaptation).toBeUndefined();
    }
  });

  it("cuatro botones: WhatsApp los convierte en una lista numerada y lo explica; Instagram los deja", () => {
    const catalog = menu([{ text: "Elige", buttons: options }]);
    const wa = existing(catalog, "whatsapp").says("menu").messages("bot")[0];
    expect(wa.buttons).toBeUndefined();
    expect(wa.text).toBe("Elige\n\n1. Uno\n2. Dos\n3. Tres\n4. Cuatro");
    expect(wa.adaptation?.[0]).toContain("hasta 3 botones");
    const ig = existing(catalog, "instagram").says("menu").messages("bot")[0];
    expect(ig.buttons).toHaveLength(4);
    expect(ig.text).toBe("Elige");
  });

  it("un botón con enlace en WhatsApp pasa a texto con el enlace; en Facebook sigue siendo botón", () => {
    const catalog = menu([{ text: "Mira", buttons: [{ title: "Tienda", type: "url", url: "https://tienda.pe" }] }]);
    const wa = existing(catalog, "whatsapp").says("menu").messages("bot")[0];
    expect(wa.text).toBe("Mira\n\n1. Tienda: https://tienda.pe");
    expect(wa.adaptation?.[0]).toContain("enlace");
    const fb = existing(catalog, "facebook").says("menu").messages("bot")[0];
    expect(fb.buttons).toEqual([{ title: "Tienda", type: "url", payload: undefined, url: "https://tienda.pe" }]);
  });

  it("carrusel: tarjetas en Messenger y texto numerado en WhatsApp", () => {
    const carousel = { elements: [{ title: "Whey", subtitle: "S/ 120", buttons: [{ type: "url", title: "Ver", url: "https://x.pe/whey" }] }] };
    const catalog = menu([{ text: "Productos", carousel }]);
    const fb = existing(catalog, "facebook").says("menu").messages("bot")[0];
    expect(fb.carousel?.[0]).toMatchObject({ title: "Whey", subtitle: "S/ 120" });
    const wa = existing(catalog, "whatsapp").says("menu").messages("bot")[0];
    expect(wa.carousel).toBeUndefined();
    expect(wa.text).toContain("1. Whey");
    expect(wa.adaptation?.[0]).toContain("carruseles");
  });

  it("las variables {{message}} se reemplazan en el texto y la imagen viaja como adjunto", () => {
    const catalog = menu([{ text: "Dijiste: {{message}}", mediaUrl: "https://x.pe/a.jpg", mediaType: "image" }]);
    const msg = existing(catalog).says("menu 2x1").messages("bot")[0];
    expect(msg.text).toBe("Dijiste: menu 2x1");
    expect(msg.attachment).toEqual({ type: "image", url: "https://x.pe/a.jpg" });
  });

  it("una pulsación de botón llega como mensaje con su carga y dispara el disparador de postback", () => {
    const flow: LabFlow = {
      id: "pb",
      name: "Postback",
      status: "published",
      nodes: [trigger({ triggerType: "postback", payload: "uno" }), send("m", [{ text: "Elegiste uno" }])],
      edges: [edge("t", "m")],
    };
    const s = existing(withFlows([flow])).press("Uno", "uno");
    expect(s.newBotTexts()).toEqual(["Elegiste uno"]);
    expect(s.messages("client")[0]).toMatchObject({ text: "Uno", payload: "uno" });
    expect(s.steps("trigger_evaluation")[0].data).toMatchObject({ reason: { via: "postback", payload: "uno" } });
    // Una carga distinta no coincide y la traza dice por qué.
    const other = existing(withFlows([flow])).press("Dos", "dos");
    expect(other.steps("trigger_evaluation")[0].text).toContain("Ningún flujo se dispara");
    expect(JSON.stringify(other.steps("trigger_evaluation")[0].data)).toContain("Espera la carga");
  });

  it("una respuesta rápida coincide con su disparador de respuesta rápida", () => {
    const flow: LabFlow = {
      id: "qr",
      name: "Respuesta rápida",
      status: "published",
      nodes: [trigger({ triggerType: "quick_reply", payload: "asesor" }), send("m", [{ text: "Va un asesor" }])],
      edges: [edge("t", "m")],
    };
    const s = existing(withFlows([flow])).press("Hablar con un asesor", "asesor", "quick_reply");
    expect(s.newBotTexts()).toEqual(["Va un asesor"]);
  });
});

// ── Estado ──────────────────────────────────────────────────────────────────

describe("estado serializable y acciones puras", () => {
  it("el estado sobrevive a JSON y las acciones dan lo mismo con el estado recuperado", async () => {
    const catalog = await ecommerceCatalog();
    const s = new Script(catalog, { contact: { existed: false } }).says("hola").press("Quiero comprar").wait(30);
    const revived = JSON.parse(JSON.stringify(s.state));
    expect(revived).toEqual(s.state);
    const a = lab.clientSays(catalog, s.state, { kind: "text", text: "Proteína" });
    const b = lab.clientSays(catalog, revived, { kind: "text", text: "Proteína" });
    expect(b.state).toEqual(a.state);
    expect(b.trace).toEqual(a.trace);
  });

  it("no modifica el estado ni el catálogo que recibe", async () => {
    const catalog = await ecommerceCatalog();
    const state = createLabState(catalog, { clock: MONDAY_10AM, contact: { existed: false } });
    const stateBefore = structuredClone(state);
    const catalogBefore = structuredClone(catalog);
    const result = lab.clientSays(catalog, state, { kind: "text", text: "hola" });
    expect(state).toEqual(stateBefore);
    expect(catalog).toEqual(catalogBefore);
    expect(result.state).not.toBe(state);
    expect(result.state.messages.length).toBeGreaterThan(state.messages.length);
    lab.advanceTime(catalog, result.state, 60 * 24);
    lab.closeCase(catalog, result.state, { kind: "resolved" });
    expect(catalog).toEqual(catalogBefore);
  });

  it("una acción rechazada deja el estado igual y explica el motivo", async () => {
    const catalog = await ecommerceCatalog();
    const s = new Script(catalog, { contact: { existed: false } });
    s.stage("Asesorando"); // sin gestión abierta
    expect(s.last.error).toBe("No hay una gestión abierta.");
    expect(s.state.cases).toHaveLength(0);
    s.says("hola");
    const before = structuredClone(s.state);
    s.says("   ");
    expect(s.last.error).toBe("El mensaje está vacío.");
    expect(s.state).toEqual(before);
    s.wait(0);
    expect(s.last.error).toContain("minutos");
    s.stage("Pagado");
    expect(s.last.error).toBe("Para ganar, perder o resolver la gestión usa Cerrar.");
    s.assign("u-nadie");
    expect(s.last.error).toBe("La persona no es miembro de este espacio de trabajo.");
  });

  it("el registro de eventos del estado resume lo ocurrido", async () => {
    const catalog = await ecommerceCatalog();
    const s = new Script(catalog, { contact: { existed: false } }).says("hola");
    expect(s.state.events.length).toBe(s.last.steps.length);
    expect(s.state.events.some((e) => e.kind === "message_sent")).toBe(true);
    expect(s.state.events.every((e) => e.at === MONDAY_10AM)).toBe(true);
  });
});

// ── Selección de flujos ─────────────────────────────────────────────────────

describe("flujos activos en la simulación", () => {
  const a = keywordFlow("a", "hola", [send("m", [{ text: "Soy A" }])], [edge("t", "m")]);
  const b = keywordFlow("b", "hola", [send("m", [{ text: "Soy B" }])], [edge("t", "m")]);
  const draft = keywordFlow("c", "borrador", [send("m", [{ text: "Soy el borrador" }])], [edge("t", "m")], "draft");

  it("por defecto corren los publicados; con la misma prioridad gana el primero", () => {
    const catalog = withFlows([a, b, draft]);
    expect(existing(catalog).says("hola").newBotTexts()).toEqual(["Soy A"]);
    expect(existing(catalog).says("borrador").steps("trigger_evaluation")[0].text).toContain("Ningún flujo se dispara");
  });

  it("se puede elegir una selección, también con borradores", () => {
    const catalog = withFlows([a, b, draft]);
    const onlyB = new Script(catalog, { enabledFlowIds: ["b"], contact: { existed: true } });
    expect(onlyB.says("hola").newBotTexts()).toEqual(["Soy B"]);
    const withDraft = new Script(catalog, { enabledFlowIds: ["c"], contact: { existed: true } });
    expect(withDraft.says("borrador").newBotTexts()).toEqual(["Soy el borrador"]);
    const switched = lab.setEnabledFlows(onlyB.state, null);
    expect(switched.enabledFlowIds).toBeNull();
    expect(onlyB.state.enabledFlowIds).toEqual(["b"]);
  });

  it("la prioridad numérica del disparador desempata a favor del mayor", () => {
    const high: LabFlow = { ...b, nodes: [trigger({ triggerType: "keyword", keywords: [{ value: "hola", matchType: "contains" }], config: { priority: 5 } }), ...b.nodes.slice(1)] };
    const catalog = withFlows([a, high]);
    expect(existing(catalog).says("hola").newBotTexts()).toEqual(["Soy B"]);
  });

  it("sin ningún flujo activo la traza lo dice", () => {
    const s = new Script(withFlows([a]), { enabledFlowIds: [], contact: { existed: true } }).says("hola");
    expect(s.steps("trigger_evaluation")[0].text).toContain("No hay flujos activos");
  });

  it("los disparadores se derivan con la misma función que usa la publicación", async () => {
    const catalog = await ecommerceCatalog();
    for (const flow of catalog.flows) {
      const expected = buildDesiredTriggers(flow.nodes as unknown as Array<Record<string, unknown>>, flow.id);
      const got = deriveTriggers([flow]);
      expect(got.map((t) => ({ type: t.type, config: t.config, priority: t.priority }))).toEqual(
        expected.map((t) => ({ type: t.type, config: t.config, priority: t.priority })),
      );
    }
  });
});

// ── Cuando ningún disparador coincide ───────────────────────────────────────

describe("explicación de los disparadores", () => {
  it("lista cada disparador con el motivo de que no coincida", async () => {
    const catalog = await ecommerceCatalog({ flowTemplates: ["general-bienvenida-simple", "ecommerce-catalogo"] });
    const s = new Script(catalog, { contact: { existed: true } }).says("buenas tardes");
    const step = s.steps("trigger_evaluation")[0];
    expect(step.level).toBe("warning");
    expect(step.text).toContain("no es el primer mensaje");
    const candidates = step.data!.candidates as Array<{ flowName: string; why: string; outcome: string }>;
    expect(candidates.every((c) => c.outcome === "not_matched")).toBe(true);
    expect(candidates.find((c) => c.flowName === "Bienvenida simple")!.why).toBe("No es el primer mensaje del contacto.");
    expect(candidates.find((c) => c.flowName === "Catálogo y precios")!.why).toBe("Ninguna de sus palabras clave aparece en el mensaje.");
  });
});

// ── Bucles ──────────────────────────────────────────────────────────────────

describe("protección contra bucles entre flujos de eventos", () => {
  it("A cambia a la etapa que dispara B y B vuelve a la que dispara A: se corta en la cadena", async () => {
    const stage = (name: string) => base.caseTypes.find((t) => t.name === "Venta")!.stages.find((s) => s.name === name)!.id;
    const venta = base.caseTypes.find((t) => t.name === "Venta")!.id;
    const onStage = (id: string, stageId: string, toStage: string): LabFlow => ({
      id,
      name: `Cuando pasa a ${id}`,
      status: "published",
      nodes: [
        trigger({ triggerType: "case_stage_changed", caseTypeId: venta, stageId }),
        action("c", { actionType: "changeStage", stageId: stage(toStage) }),
      ],
      edges: [edge("t", "c")],
    });
    const catalog = withFlows([onStage("A", stage("Asesorando"), "Esperando pago"), onStage("B", stage("Esperando pago"), "Asesorando")]);
    const s = new Script(catalog, { contact: { existed: true } }).says("hola").stage("Nuevo interesado");
    s.stage("Asesorando");
    // Asesorando → A → Esperando pago → B → Asesorando → (A ya corrió en la cadena: se corta).
    const events = s.steps("case_event");
    const blocked = events.filter((e) => JSON.stringify(e.data).includes("ya corrió en la cadena"));
    expect(blocked).toHaveLength(1);
    expect(s.stageNameOf(s.openCase())).toBe("Asesorando");
    expect(s.steps("flow_started").map((x) => x.flowId)).toEqual(["A", "B"]);
  });
});

// ── Esperas ─────────────────────────────────────────────────────────────────

describe("esperas de respuesta", () => {
  const ask = keywordFlow(
    "ask",
    "pregunta",
    [
      send("q", [{ text: "¿Color?" }]),
      action("w", { actionType: "smartDelay", timeout: 30, timeoutUnit: "minutes" }),
      send("r", [{ text: "Anotado: {{message}}" }]),
    ],
    [edge("t", "q"), edge("q", "w"), edge("w", "r")],
  );
  const other = keywordFlow("otro", "rojo", [send("m", [{ text: "Disparador suelto" }])], [edge("t", "m")]);

  it("la respuesta dentro del plazo retoma el flujo, sin buscar disparadores", () => {
    const s = existing(withFlows([ask, other])).says("pregunta").wait(10).says("rojo");
    expect(s.newBotTexts()).toEqual(["Anotado: rojo"]);
    expect(s.steps("trigger_evaluation")).toHaveLength(0);
  });

  it("vencida la espera, la respuesta ya no retoma y busca un disparador", () => {
    const s = existing(withFlows([ask, other])).says("pregunta").wait(31);
    expect(s.steps("session_expired")).toHaveLength(1);
    expect(s.state.sessions[0].status).toBe("expired");
    s.says("rojo");
    expect(s.newBotTexts()).toEqual(["Disparador suelto"]);
  });

  it("un nodo Espera reanuda el flujo en el instante exacto", () => {
    const delayed = keywordFlow(
      "d",
      "demora",
      [send("a", [{ text: "Antes" }]), { id: "e", type: "delay", data: { label: "Espera", duration: 90, unit: "minutes" } }, send("b", [{ text: "Después" }])],
      [edge("t", "a"), edge("a", "e"), edge("e", "b")],
    );
    const s = existing(withFlows([delayed])).says("demora");
    expect(s.newBotTexts()).toEqual(["Antes"]);
    s.wait(89);
    expect(s.newBotTexts()).toEqual([]);
    s.wait(2);
    expect(s.newBotTexts()).toEqual(["Después"]);
    expect(s.last.steps.find((x) => x.kind === "message_sent")!.at).toBe("2026-10-19T16:30:00.000Z");
    expect(s.state.jobs[0].status).toBe("done");
    expect(s.state.sessions[0].status).toBe("completed");
  });

  it("con el bot en pausa por una respuesta humana, «cliente sin responder» y los cambios de etapa sí ejecutan sus flujos", async () => {
    const catalog = await ecommerceCatalog();
    const s = new Script(catalog, { contact: { existed: false } })
      .says("precio")
      .wait(2)
      .agent("Te paso los datos")
      .stage("Pedido o enlace de pago enviado");
    expect(s.state.automationPaused).toBe(true);
    // «Datos de pago» corre aunque el asesor tenga el bot en pausa.
    expect(s.newBotTexts()[0]).toContain("Estos son nuestros medios de pago");
    s.wait(125);
    const event = s.steps("case_event").find((e) => (e.data as { event?: string }).event === "client_no_reply");
    expect(event).toBeDefined();
    expect(s.newBotTexts()[0]).toContain("pudiste realizar el pago");
    expect(s.state.automationPaused).toBe(true);
    // Y no se vuelve a emitir para ese mismo mensaje.
    s.wait(24 * 60);
    expect(s.steps("case_event").filter((e) => (e.data as { event?: string }).event === "client_no_reply")).toHaveLength(0);
  });
});

// ── Otros nodos ─────────────────────────────────────────────────────────────

describe("nodos sin efecto en la simulación", () => {
  it("la prueba A/B sigue el camino que da el generador de números", () => {
    const flow = keywordFlow(
      "ab",
      "ab",
      [
        action("s", { actionType: "abSplit", paths: [{ name: "A", weight: 50 }, { name: "B", weight: 50 }] }),
        send("a", [{ text: "Camino A" }]),
        send("b", [{ text: "Camino B" }]),
      ],
      [edge("t", "s"), edge("s", "a", "A"), edge("s", "b", "B")],
    );
    const catalog = withFlows([flow]);
    const run = (random: number) => {
      const state = createLabState(catalog, { clock: MONDAY_10AM, contact: { existed: true } });
      return lab.clientSays(catalog, state, { kind: "text", text: "ab" }, { random: () => random }).trace.messages[1].text;
    };
    expect(run(0.1)).toBe("Camino A");
    expect(run(0.9)).toBe("Camino B");
  });

  it("solicitud HTTP, IA y secuencias avisan que no se simulan; una respuesta de prueba llena la variable", () => {
    const flow = keywordFlow(
      "x",
      "x",
      [
        action("h", { actionType: "httpRequest", method: "GET", url: "https://api.pe/{{message}}", responseVariable: "datos" }),
        { id: "i", type: "aiResponse", data: { label: "IA", model: "m", systemPrompt: "p", temperature: 0, maxTokens: 10, contextMessages: 1 } },
        action("q", { actionType: "enrollSequence", sequenceId: "seq" }),
        send("m", [{ text: "{{ai_response}} / {{datos}}" }]),
      ],
      [edge("t", "h"), edge("h", "i"), edge("i", "q"), edge("q", "m")],
    );
    const catalog = withFlows([flow]);
    const plain = existing(catalog).says("x");
    expect(plain.last.warnings).toHaveLength(3);
    expect(plain.last.warnings[0]).toContain("no hace solicitudes HTTP");
    expect(plain.newBotTexts()).toEqual(["[Respuesta de IA] / {{datos}}"]);
    const state = createLabState(catalog, { clock: MONDAY_10AM, contact: { existed: true } });
    const mocked = lab.clientSays(catalog, state, { kind: "text", text: "x" }, { httpResponses: { h: "ok" } });
    expect(mocked.trace.messages[1].text).toBe("[Respuesta de IA] / ok");
  });

  it("guardar un campo que no existe en el espacio avisa (el motor real no guarda nada)", () => {
    const flow = keywordFlow("f", "f", [action("c", { actionType: "setCustomField", fieldSlug: "no_existe", value: "1" })], [edge("t", "c")]);
    const s = existing(withFlows([flow])).says("f");
    expect(s.last.warnings[0]).toContain("no existe");
    expect(s.state.contact.customFields).toEqual({});
  });

  it("las condiciones leen etiquetas, campos, suscripción, plataforma y la gestión", () => {
    const venta = base.caseTypes.find((t) => t.name === "Venta")!;
    const flow = keywordFlow(
      "c",
      "c",
      [
        {
          id: "k",
          type: "condition",
          data: {
            label: "¿Todo?",
            logic: "and",
            conditions: [
              { field: "tag:VIP", operator: "equals", value: "true" },
              { field: "custom_field:talla", operator: "equals", value: "m" },
              { field: "is_subscribed", operator: "equals", value: "true" },
              { field: "platform", operator: "equals", value: "instagram" },
              { field: "case_type", operator: "equals", value: venta.id },
              { field: "has_assignee", operator: "equals", value: "true" },
              { field: "within_hours", operator: "equals", value: "true" },
            ],
          },
        },
        send("si", [{ text: "Todo cumple" }]),
        send("no", [{ text: "Algo falla" }]),
      ],
      [edge("t", "k"), edge("k", "si", "yes"), edge("k", "no", "no")],
    );
    const catalog = withFlows([flow]);
    const s = new Script(catalog, { channel: "instagram", contact: { existed: false, tags: ["VIP"], customFields: { talla: "M" } } }).says("c");
    expect(s.newBotTexts()).toEqual(["Todo cumple"]);
    const items = (s.steps("condition")[0].data as { conditions: Array<{ description: string; result: boolean }> }).conditions;
    expect(items.map((i) => i.result)).toEqual([true, true, true, true, true, true, true]);
    expect(items[4].description).toBe("Tipo de gestión = «Venta»");
    const wa = new Script(catalog, { contact: { existed: true, tags: ["VIP"], customFields: { talla: "M" } } }).says("c");
    expect(wa.newBotTexts()).toEqual(["Algo falla"]);
  });
});

// ── Equipos, horarios y feriados ────────────────────────────────────────────

describe("equipos, horarios y feriados", () => {
  const weekdays: BusinessHours = { mon: [["09:00", "18:00"]], tue: [["09:00", "18:00"]], wed: [["09:00", "18:00"]], thu: [["09:00", "18:00"]], fri: [["09:00", "18:00"]] };
  const teams = async (holidays: Array<{ date: string; teamId: string | null }> = []) =>
    buildCatalogFromTemplates({
      business: "ecommerce",
      flowTemplates: ["general-respuesta-defecto"],
      teams: [
        { id: "t-lima", name: "Sede Lima", isDefault: true, assignmentMode: "round_robin", businessHours: weekdays },
        { id: "t-cusco", name: "Sede Cusco", isDefault: false, assignmentMode: "round_robin", businessHours: null },
      ],
      teamMembers: [
        { teamId: "t-lima", userId: "u-ana", role: "agent", caseTypeIds: null },
        { teamId: "t-cusco", userId: "u-beto", role: "agent", caseTypeIds: null },
      ],
      holidays,
      offHoursReply: { enabled: true, text: "Estamos cerrados. Abrimos {apertura}.", min_hours_between: null },
    });

  it("el contacto de una sede se reparte a su equipo (y a sus asesores)", async () => {
    const catalog = await teams();
    const cusco = new Script(catalog, { contact: { existed: true, teamId: "t-cusco" } }).says("hola");
    expect(cusco.openCase()).toMatchObject({ teamId: "t-cusco", assigneeId: "u-beto" });
    const lima = new Script(catalog, { contact: { existed: true } }).says("hola");
    expect(lima.openCase()).toMatchObject({ teamId: "t-lima", assigneeId: "u-ana" });
  });

  it("fuera del horario del equipo: respuesta automática y la gestión espera; al abrir se reparte", async () => {
    const catalog = await teams();
    // Domingo 18/10/2026 10:00 (Lima).
    const s = new Script(catalog, { clock: "2026-10-18T15:00:00.000Z", contact: { existed: true } }).says("hola");
    expect(s.openCase()?.assigneeId).toBeNull();
    expect(s.botTexts()).toEqual(["Estamos cerrados. Abrimos mañana 9:00."]);
    expect(s.steps("off_hours_reply")).toHaveLength(1);
    s.wait(22 * 60);
    expect(s.openCase()?.assigneeId).toBeNull(); // 08:00 del lunes: todavía no
    s.wait(61);
    expect(s.openCase()?.assigneeId).toBe("u-ana");
    expect(s.last.steps.find((x) => x.kind === "case_assigned")!.at).toBe("2026-10-19T14:00:00.000Z");
  });

  it("un feriado mueve la apertura al día siguiente", async () => {
    const catalog = await teams([{ date: "2026-10-19", teamId: null }]);
    const s = new Script(catalog, { clock: "2026-10-18T15:00:00.000Z", contact: { existed: true } }).says("hola");
    expect(s.botTexts()).toEqual(["Estamos cerrados. Abrimos martes 9:00."]);
    s.wait(24 * 60 + 61); // lunes feriado
    expect(s.openCase()?.assigneeId).toBeNull();
    s.wait(24 * 60);
    expect(s.openCase()?.assigneeId).toBe("u-ana");
  });

  it("la respuesta fuera de horario no se repite en la misma gestión", async () => {
    const catalog = await teams();
    const s = new Script(catalog, { clock: "2026-10-18T15:00:00.000Z", contact: { existed: true } }).says("hola").wait(5).says("¿hay alguien?");
    expect(s.botTexts()).toHaveLength(1);
    expect(s.last.steps.some((x) => x.text.includes("no se repite"))).toBe(true);
  });

  it("una gestión programada que cae fuera de horario pasa a la próxima apertura", async () => {
    const catalog = await buildCatalogFromTemplates({
      business: "ecommerce",
      flowTemplates: [],
      teams: [{ id: "t-lima", name: "Sede Lima", isDefault: true, assignmentMode: "round_robin", businessHours: weekdays }],
      teamMembers: [{ teamId: "t-lima", userId: "u-ana", role: "agent", caseTypeIds: null }],
    });
    const recompra = catalog.caseTypes.find((t) => t.name === "Recompra")!;
    const s = new Script(catalog, { clock: "2026-10-16T22:00:00.000Z", contact: { existed: true } }); // viernes 17:00 Lima
    s.state.cases.push({
      id: "case-1",
      caseTypeId: recompra.id,
      stageId: recompra.stages[0].id,
      status: "scheduled",
      scheduledFor: "2026-10-16T23:30:00.000Z", // 18:30: ya cerrado
    } as never);
    s.wait(120);
    const row = s.state.cases[0];
    expect(row.status).toBe("scheduled");
    expect(row.scheduledFor).toBe("2026-10-19T14:00:00.000Z"); // lunes 09:00 Lima
    expect(s.steps("case_scheduled")[0].text).toContain("fuera de horario");
    s.wait(3 * 24 * 60);
    expect(s.state.cases[0].status).toBe("open");
    expect(s.state.cases[0].assigneeId).toBe("u-ana");
  });

  it("un asesor ausente no recibe gestiones y la gestión queda por asignar hasta que vuelva", async () => {
    const catalog = await buildCatalogFromTemplates({
      business: "ecommerce",
      flowTemplates: [],
      members: [{ userId: "u-ana", name: "Ana", availability: "away" }],
    });
    const s = new Script(catalog, { contact: { existed: true } }).says("hola");
    expect(s.openCase()?.assigneeId).toBeNull();
    expect(s.steps("case_unassigned")[0].text).toContain("No hay asesores disponibles");
    s.apply(lab.setMemberAvailability(catalog, s.state, "u-ana", "available"));
    s.wait(1);
    expect(s.openCase()?.assigneeId).toBe("u-ana");
  });
});

// ── Cierre ──────────────────────────────────────────────────────────────────

describe("cierre de gestiones", () => {
  it("perder una venta exige el motivo cuando el tipo tiene motivos de perdida", async () => {
    const catalog = await ecommerceCatalog();
    const s = new Script(catalog, { contact: { existed: false } }).says("precio");
    s.close({ kind: "lost" });
    expect(s.last.error).toBe("Elige el motivo del resultado.");
    const reason = catalog.caseTypes.find((t) => t.name === "Venta")!.reasons.find((r) => r.name === "Precio")!;
    s.close({ kind: "lost", outcomeReasonId: reason.id });
    expect(s.last.error).toBeUndefined();
    const row = s.state.cases[0];
    expect(row).toMatchObject({ status: "lost", outcomeReasonId: reason.id });
    expect(s.steps("case_closed")[0].text).toContain("motivo: Precio");
    // Perdida: no hay reglas de ganada (ni Cliente ni Recompra).
    expect(s.state.cases).toHaveLength(1);
    expect(s.state.contact.contactTypeId).toBe(s.contactTypeId("Prospecto"));
  });

  it("una gestión sin clasificar solo se cierra como resuelta", async () => {
    const catalog = await buildCatalogFromTemplates({ business: "ecommerce", flowTemplates: [] });
    const s = new Script(catalog, { contact: { existed: true, contactTypeId: base.contactTypes.find((t) => t.name === "Cliente")!.id } }).says("hola");
    expect(s.openCase()?.caseTypeId).toBeNull();
    s.close({ kind: "won" });
    expect(s.last.error).toBe("Clasifica la gestión antes de cerrarla como ganada o perdida.");
    s.close({ kind: "resolved" });
    expect(s.state.cases[0].status).toBe("resolved");
  });

  it("el asesor puede elegir otra fecha para la gestión programada o no programar nada", async () => {
    const catalog = await ecommerceCatalog();
    const custom = new Script(catalog, { contact: { existed: false } }).says("precio").close({ kind: "won", scheduleOverride: { scheduleAt: "2026-11-02" } });
    expect(custom.casesOfType("Recompra")[0].scheduledFor).toBe("2026-11-02T14:00:00.000Z");
    const skipped = new Script(catalog, { contact: { existed: false } }).says("precio").close({ kind: "won", scheduleOverride: { skip: true } });
    expect(skipped.casesOfType("Recompra")).toHaveLength(0);
    expect(skipped.state.contact.contactTypeId).toBe(skipped.contactTypeId("Cliente"));
    const invalid = new Script(catalog, { contact: { existed: false } }).says("precio").close({ kind: "won", scheduleOverride: { scheduleAt: "mañana" } });
    expect(invalid.last.error).toBe("La fecha de la gestión programada no es válida.");
  });

  it("la vista previa del cierre muestra el tipo de contacto y la fecha de la Recompra sin cambiar nada", async () => {
    const catalog = await ecommerceCatalog();
    const s = new Script(catalog, { contact: { existed: false } }).says("precio");
    const before = structuredClone(s.state);
    const result = lab.previewClose(catalog, s.state, { kind: "won" });
    expect("preview" in result && result.preview).toMatchObject({
      kind: "won",
      askKeyDate: null,
      contactType: { to: s.contactTypeId("Cliente") },
      schedules: [{ caseTypeName: "Recompra", scheduledFor: "2026-11-13T14:00:00.000Z", basis: "days_after", days: 25 }],
    });
    expect(s.state).toEqual(before);
  });

  it("cerrar y reabrir: un mensaje dentro de las 24 h reabre la gestión en la etapa anterior al cierre", async () => {
    const catalog = await ecommerceCatalog();
    const s = new Script(catalog, { contact: { existed: false } }).says("precio").stage("Pedido o enlace de pago enviado").close({ kind: "resolved" as never });
    // «resolved» no existe en Venta: se rechaza; se cierra como ganada.
    expect(s.last.error).toContain("no tiene una etapa");
    s.close({ kind: "won" }).wait(60).says("una duda más");
    expect(s.steps("case_reopened")).toHaveLength(1);
    expect(s.state.cases[0].status).toBe("open");
    expect(s.stageNameOf(s.state.cases[0])).toBe("Esperando pago");
    s.close({ kind: "won" }).wait(25 * 60).says("hola otra vez");
    expect(s.steps("case_reopened")).toHaveLength(0);
    expect(s.steps("case_opened")).toHaveLength(1);
  });
});

// ── Cambios de un asesor ────────────────────────────────────────────────────

describe("acciones del asesor", () => {
  it("asignar, devolver a la cola y reclasificar", async () => {
    const catalog = await ecommerceCatalog();
    const s = new Script(catalog, { contact: { existed: false } }).says("precio");
    expect(s.openCase()?.assigneeId).toBe("u-ana");
    s.assign("u-beto");
    expect(s.openCase()?.assigneeId).toBe("u-beto");
    s.assign(null);
    expect(s.openCase()?.assigneeId).toBeNull();
    expect(s.steps("case_unassigned")).toHaveLength(1);
    s.classify("Postventa");
    expect(s.typeNameOf(s.openCase())).toBe("Postventa");
    expect(s.stageNameOf(s.openCase())).toBe("Nueva");
    expect(s.openCase()?.assigneeId).toBeTruthy(); // al reclasificar sin responsable se reparte de nuevo
  });

  it("editar el contacto anota qué campos cambiaron", async () => {
    const catalog = await ecommerceCatalog();
    const s = new Script(catalog, { contact: { existed: true } }).contact({ tags: ["VIP"], subscribed: false, keyDate: "2026-12-01" });
    expect(s.state.contact).toMatchObject({ tags: ["VIP"], subscribed: false, keyDate: "2026-12-01" });
    expect(s.steps("contact_changed")[0].text).toContain("tags, subscribed, keyDate");
    s.contact({ tags: ["VIP"] });
    expect(s.steps("info")[0].text).toBe("No hay cambios en el contacto.");
  });

  it("la respuesta del asesor con la ventana de 24 h cerrada avisa que el CRM real exigiría una plantilla", async () => {
    const catalog = await ecommerceCatalog();
    const s = new Script(catalog, { contact: { existed: false } }).says("precio").wait(25 * 60).agent("¿Sigues ahí?");
    expect(s.last.warnings[0]).toContain("ventana de 24 h");
  });
});

// ── Perfiles ────────────────────────────────────────────────────────────────

describe("perfiles iniciales", () => {
  it("se arman por nombre con el catálogo de E-commerce", async () => {
    const catalog = await ecommerceCatalog();
    const [nuevo, recurrente, esperando, socio] = buildSampleProfiles(catalog, MONDAY_10AM);

    expect(nuevo).toMatchObject({ id: "prospecto-nuevo", cases: [], messages: [], notices: [] });
    expect(nuevo.contact.existed).toBe(false);

    expect(recurrente.contact.tags).toEqual(["Cliente frecuente", "VIP"]);
    expect(recurrente.contact.contactTypeId).toBe(catalog.contactTypes.find((t) => t.name === "Cliente frecuente")!.id);
    expect(recurrente.cases[0]).toMatchObject({ status: "won" });
    expect(recurrente.notices).toEqual([]);

    const venta = catalog.caseTypes.find((t) => t.name === "Venta")!;
    expect(esperando.cases[0]).toMatchObject({
      caseTypeId: venta.id,
      stageId: venta.stages.find((s) => s.name === "Esperando pago")!.id,
      status: "open",
      assigneeId: "u-ana",
    });
    expect(esperando.notices).toEqual([]);

    // El espacio de E-commerce no tiene Renovación ni «Socio activo»: se avisa y el perfil se arma igual.
    expect(socio.cases).toEqual([]);
    // Sin «Socio activo» se usa «Cliente», que sí existe: solo falta Renovación.
    expect(socio.notices).toEqual(["El espacio no tiene un tipo de gestión «Renovación»."]);
    expect(socio.contact.contactTypeId).toBe(catalog.contactTypes.find((t) => t.name === "Cliente")!.id);
    expect(socio.contact.keyDate).toBe("2026-10-24");
  });

  it("el socio por vencer, con el catálogo de gimnasio, tiene su Renovación abierta", async () => {
    const catalog = await buildCatalogFromTemplates({ business: "gym" });
    const socio = buildSampleProfiles(catalog, MONDAY_10AM)[3];
    expect(socio.notices).toEqual([]);
    expect(socio.contact.contactTypeId).toBe(catalog.contactTypes.find((t) => t.name === "Socio activo")!.id);
    const renovacion = catalog.caseTypes.find((t) => t.name === "Renovación")!;
    expect(socio.cases[0]).toMatchObject({ caseTypeId: renovacion.id, stageId: renovacion.stages[0].id, status: "open" });
  });

  it("un perfil arranca la simulación con su gestión y su conversación", async () => {
    const catalog = await ecommerceCatalog();
    const profile = buildSampleProfiles(catalog, MONDAY_10AM)[2];
    const s = new Script(catalog, { profile });
    expect(s.state.messages).toHaveLength(2);
    expect(s.stageNameOf(s.openCase())).toBe("Esperando pago");
    // Avanzar 2 h: el recordatorio de pago sale (el cliente no responde desde hace 2,5 h).
    s.wait(35);
    expect(s.newBotTexts()).toEqual([
      "Hola, ¿pudiste realizar el pago de tu pedido? Si necesitas ayuda con los medios de pago o tienes alguna duda, escríbenos y te ayudamos con gusto.",
    ]);
    // Los ids de los mensajes y gestiones siguen sin repetirse.
    const ids = s.state.messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("el cliente recurrente escribe y se abre una gestión nueva (la anterior se cerró hace 12 días)", async () => {
    const catalog = await ecommerceCatalog();
    const s = new Script(catalog, { profile: buildSampleProfiles(catalog, MONDAY_10AM)[1] }).says("hola, precio de la creatina");
    expect(s.steps("case_opened")).toHaveLength(1);
    expect(s.state.cases).toHaveLength(2);
    expect(s.state.contact.tags).toEqual(["Cliente frecuente", "VIP"]);
  });
});

// ── Carga del catálogo ──────────────────────────────────────────────────────

describe("loadLabCatalog sobre la base en memoria", () => {
  it("arma flujos, disparadores, tipos de gestión, equipos, horarios, feriados y palabras clave", async () => {
    const fake = new FakeDb();
    const WS = "ws-load";
    const hours = { mon: [["09:00", "18:00"]] };
    fake.seed("workspaces", [
      {
        id: WS,
        name: "Tienda real",
        slug: "tienda",
        settings: { business_hours: hours, off_hours_reply: { enabled: true, text: "Cerrado", min_hours_between: 6 }, assignment_mode: "least_load", reassign_after_minutes: 30 },
        global_keywords: [{ keyword: "baja", action: "unsubscribe" }],
      },
    ]);
    fake.seed("workspace_members", [
      { workspace_id: WS, user_id: "u-1", role: "owner" },
      { workspace_id: WS, user_id: "u-2", role: "member", availability: "away" },
    ]);
    await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "gym");
    const [team] = fake.seed("teams", [{ workspace_id: WS, name: "Sede Lima", is_default: true, assignment_mode: "manual", business_hours: hours }]);
    fake.seed("team_members", [{ team_id: team.id, user_id: "u-2", role: "agent", case_type_ids: null }]);
    fake.seed("holidays", [{ workspace_id: WS, date: "2026-12-25", team_id: null }]);
    fake.seed("custom_field_definitions", [{ workspace_id: WS, slug: "talla", name: "Talla" }]);
    fake.seed("tags", [{ workspace_id: WS, name: "VIP" }]);
    const flowNodes = [
      { id: "t", type: "trigger", data: { triggerType: "keyword", keywords: [{ value: "hola", matchType: "exact" }] } },
      { id: "m", type: "sendMessage", data: { messages: [{ text: "Hola" }] } },
    ];
    fake.seed("flows", [
      { id: "f1", workspace_id: WS, name: "Hola", status: "published", nodes: flowNodes, edges: [{ id: "e", source: "t", target: "m" }] },
      { id: "f2", workspace_id: WS, name: "Borrador", status: "draft", nodes: [], edges: [] },
      { id: "f3", workspace_id: WS, name: "Archivado", status: "archived", nodes: [], edges: [] },
    ]);

    const catalog = await loadLabCatalog(WS, { db: fake.asDb(), memberNames: { "u-1": "Dueña" } });
    expect(catalog.workspaceName).toBe("Tienda real");
    expect(catalog.flows.map((f) => [f.id, f.status])).toEqual([["f1", "published"], ["f2", "draft"]]);
    expect(catalog.triggers).toEqual([
      { id: "f1:trigger:1", flowId: "f1", type: "keyword", config: { keywords: [{ value: "hola", matchType: "exact" }] }, priority: 0, isActive: true, nodeId: "t" },
    ]);
    expect(catalog.caseTypes.map((t) => t.name)).toEqual(["Venta de membresía", "Atención al socio", "Renovación"]);
    const venta = catalog.caseTypes[0];
    expect(venta.stages.map((s) => s.name)).toEqual(["Nuevo interesado", "Asesorando", "Visita o clase de prueba agendada", "Visitó la sede", "Inscrito", "No se inscribió"]);
    expect(venta.reasons).toHaveLength(6);
    expect(venta.rules.map((r) => r.action)).toEqual(["set_contact_type", "ask_key_date", "schedule_case"]);
    expect(catalog.contactTypes.find((t) => t.isDefault)?.name).toBe("Prospecto");
    expect(catalog.teams).toEqual([{ id: team.id, name: "Sede Lima", isDefault: true, assignmentMode: "manual", businessHours: hours }]);
    expect(catalog.members.map((m) => [m.userId, m.name, m.availability])).toEqual([["u-1", "Dueña", "available"], ["u-2", "Asesor 2", "away"]]);
    expect(catalog.teamMembers).toEqual([{ teamId: team.id, userId: "u-2", role: "agent", caseTypeIds: null }]);
    expect(catalog.workspaceMode).toBe("least_load");
    expect(catalog.workspaceHours).toEqual(hours);
    expect(catalog.offHoursReply).toEqual({ enabled: true, text: "Cerrado", min_hours_between: 6 });
    expect(catalog.reassignAfterMinutes).toBe(30);
    expect(catalog.holidays).toEqual([{ date: "2026-12-25", teamId: null }]);
    expect(catalog.globalKeywords).toEqual([{ keyword: "baja", action: "unsubscribe" }]);
    expect(catalog.customFields).toEqual([{ slug: "talla", name: "Talla" }]);
    expect(catalog.tags).toEqual(["VIP"]);
    // Es JSON: se puede guardar y volver a usar.
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });

  it("falla con un mensaje claro si el espacio no existe", async () => {
    await expect(loadLabCatalog("no-existe", { db: new FakeDb().asDb() })).rejects.toThrow("No se pudo leer el espacio de trabajo");
  });
});

describe("flujos de las plantillas en el mapa", () => {
  it("cada nodo recorrido lleva el id del flujo y del nodo", async () => {
    const catalog = await ecommerceCatalog();
    const s = returningCustomer(catalog).says("hola").press("Quiero comprar");
    const flowId = flowIdOf(catalog, "Bienvenida y clasificación");
    const flow = catalog.flows.find((f) => f.id === flowId)!;
    const nodeIds = new Set(flow.nodes.map((n) => n.id));
    expect(s.last.visited.length).toBeGreaterThan(3);
    expect(s.last.visited.every((v) => v.flowId === flowId && nodeIds.has(v.nodeId))).toBe(true);
    // Los pasos de la traza que tocan un nodo llevan su id y su etiqueta.
    for (const step of s.steps("node")) {
      expect(nodeIds.has(step.nodeId!)).toBe(true);
      expect(step.nodeLabel).toBeTruthy();
    }
  });
});

// ── Gestión nueva (case_opened) ─────────────────────────────────────────────

describe("disparador «Gestión nueva»", () => {
  const caseOpenedFlow = (id: string, config: Record<string, unknown> = {}, text = `Hola desde ${id}`): LabFlow => ({
    id,
    name: `Flujo ${id}`,
    status: "published",
    nodes: [trigger({ triggerType: "case_opened", ...config }), send("m", [{ text }])],
    edges: [edge("t", "m")],
  });
  const customerTypeId = () => base.contactTypes.find((t) => t.name === "Cliente")!.id;
  const prospectTypeId = () => base.contactTypes.find((t) => t.name === "Prospecto")!.id;
  const customer = (catalog: LabCatalog) => new Script(catalog, { contact: { existed: true, contactTypeId: customerTypeId() } });

  it("se deriva del nodo con la misma función que usa la publicación y se describe en español", () => {
    const catalog = withFlows([caseOpenedFlow("a", { onlyUnclassified: true, contactTypeIds: [customerTypeId()] })]);
    expect(catalog.triggers).toMatchObject([{ type: "case_opened", config: { only_unclassified: true, contact_type_ids: [customerTypeId()] } }]);
    expect(describeTrigger(catalog, catalog.triggers[0])).toBe("gestión nueva sin clasificar (clientes de tipo Cliente)");
    const plain = withFlows([caseOpenedFlow("b")]);
    expect(describeTrigger(plain, plain.triggers[0])).toBe("gestión nueva");
  });

  it("corre al abrirse la gestión entrante, después de repartirla, con el evento en la traza", () => {
    const s = customer(withFlows([caseOpenedFlow("nueva")])).says("hola");
    expect(s.newBotTexts()).toEqual(["Hola desde nueva"]);
    const kinds = s.last.steps.map((x) => x.kind);
    expect(kinds.indexOf("case_opened")).toBeLessThan(kinds.indexOf("case_event"));
    const event = s.steps("case_event")[0];
    expect(event.text).toContain("Evento «gestión nueva» de la gestión «Sin clasificar»");
    expect(event.data).toMatchObject({ event: "case_opened" });
    // La conversación sigue: el segundo mensaje reutiliza la gestión y no vuelve a disparar.
    s.says("¿hay alguien?");
    expect(s.newBotTexts()).toEqual([]);
    expect(s.steps("case_event")).toHaveLength(0);
  });

  it("«solo sin clasificar»: un cliente (sin tipo sugerido) sí, un prospecto (se abre como Venta) no, y la traza dice por qué", () => {
    const catalog = withFlows([caseOpenedFlow("sin", { onlyUnclassified: true })]);
    expect(customer(catalog).says("hola").newBotTexts()).toEqual(["Hola desde sin"]);
    const prospect = new Script(catalog, { contact: { existed: false } }).says("hola");
    expect(prospect.newBotTexts()).toEqual([]);
    const candidates = prospect.steps("case_event")[0].data!.candidates as Array<{ outcome: string; why: string }>;
    expect(candidates[0]).toMatchObject({ outcome: "not_matched" });
    expect(candidates[0].why).toContain("Solo aplica a gestiones sin clasificar; esta quedó como «Venta»");
  });

  it("solo para ciertos tipos de contacto", () => {
    const catalog = withFlows([caseOpenedFlow("clientes", { contactTypeIds: [customerTypeId()] })]);
    expect(customer(catalog).says("hola").newBotTexts()).toEqual(["Hola desde clientes"]);
    const prospect = new Script(catalog, { contact: { existed: true, contactTypeId: prospectTypeId() } }).says("hola");
    expect(prospect.newBotTexts()).toEqual([]);
    expect((prospect.steps("case_event")[0].data!.candidates as Array<{ why: string }>)[0].why).toContain(
      "Solo aplica a clientes de tipo «Cliente»; este es «Prospecto»",
    );
  });

  it("reabrir una gestión cerrada hace menos de 24 h no es una gestión nueva", () => {
    const catalog = withFlows([caseOpenedFlow("nueva")]);
    const s = customer(catalog).says("hola").wait(5).close({ kind: "resolved" });
    expect(s.newBotTexts()).toEqual([]);
    s.wait(60).says("una cosa más");
    expect(s.steps("case_reopened")).toHaveLength(1);
    expect(s.newBotTexts()).toEqual([]);
    // Pasadas las 24 h sí se abre una gestión nueva y el flujo corre.
    s.close({ kind: "resolved" }).wait(25 * 60).says("hola otra vez");
    expect(s.steps("case_opened")).toHaveLength(1);
    expect(s.newBotTexts()).toEqual(["Hola desde nueva"]);
  });

  it("corre aunque el bot esté en pausa en la conversación", () => {
    const s = customer(withFlows([caseOpenedFlow("nueva")])).says("hola").wait(5).agent("Te ayudo").close({ kind: "resolved" });
    // Cerrar la gestión reanuda el bot; se pausa a mano (botón de la bandeja) antes del mensaje nuevo.
    s.wait(25 * 60).botPaused(true).says("hola otra vez");
    expect(s.state.automationPaused).toBe(true);
    expect(s.newBotTexts()).toEqual(["Hola desde nueva"]);
  });

  it("un flujo en borrador no corre", () => {
    const catalog = withFlows([{ ...caseOpenedFlow("borrador"), status: "draft" }]);
    expect(customer(catalog).says("hola").newBotTexts()).toEqual([]);
  });
});

// ── Respuestas numéricas a menús ────────────────────────────────────────────

describe("respuestas a menús", () => {
  const flow = (messages: Array<Record<string, unknown>>, afterMenu?: LabNode): LabFlow =>
    keywordFlow(
      "menu",
      "menu",
      [
        send("m", messages),
        ...(afterMenu ? [afterMenu] : []),
        action("w", { actionType: "smartDelay", timeout: 30, timeoutUnit: "minutes" }),
        action("f", { actionType: "setCustomField", fieldSlug: "producto_interes", value: "{{message}}" }),
        action("tag", { actionType: "addTag", tagName: "Eligió" }),
      ],
      [edge("t", "m"), ...(afterMenu ? [edge("m", afterMenu.id), edge(afterMenu.id, "w")] : [edge("m", "w")]), edge("w", "f"), edge("f", "tag")],
    );
  const four = ["Miraflores", "San Isidro", "Surco", "La Molina"].map((title) => ({ title, type: "postback", payload: title.toLowerCase().replace(" ", "_") }));
  const catalogWith = (f: LabFlow) =>
    withFlows([f], { customFields: [{ slug: "producto_interes", name: "Producto" }] as LabCatalog["customFields"] });

  it("«3.» elige la tercera opción de una lista numerada de WhatsApp y {{message}} pasa a ser su título", () => {
    const s = existing(catalogWith(flow([{ text: "Elige sede", buttons: four }]))).says("menu");
    expect(s.messages("bot")[0].text).toContain("3. Surco");
    s.says("3.");
    expect(s.state.contact.customFields.producto_interes).toBe("Surco");
    expect(s.steps("info").find((x) => x.text.includes("se interpreta"))?.text).toBe(
      "La respuesta «3.» se interpreta como la opción «Surco» del último menú del bot (carga «surco»).",
    );
  });

  it("el texto de la opción, sin tildes ni mayúsculas, también la elige", () => {
    const s = existing(catalogWith(flow([{ text: "Elige sede", buttons: four }]))).says("menu").says("la molina");
    expect(s.state.contact.customFields.producto_interes).toBe("La Molina");
  });

  it("respuestas rápidas (Instagram): «2» elige la segunda", () => {
    const quick = [{ title: "Hoy", payload: "hoy" }, { title: "Mañana", payload: "manana" }];
    const s = existing(catalogWith(flow([{ text: "¿Cuándo?", quickReplies: quick }])), "instagram").says("menu").says("2");
    expect(s.state.contact.customFields.producto_interes).toBe("Mañana");
    expect(s.state.contact.tags).toEqual(["Eligió"]);
  });

  it("lo que no es una opción queda tal cual: «7», o un texto distinto", () => {
    const s = existing(catalogWith(flow([{ text: "Elige sede", buttons: four }]))).says("menu").says("7");
    expect(s.state.contact.customFields.producto_interes).toBe("7");
    expect(s.steps("info").some((x) => x.text.includes("se interpreta"))).toBe(false);
    const t = existing(catalogWith(flow([{ text: "Elige sede", buttons: four }]))).says("menu").says("quiero la de Surco");
    expect(t.state.contact.customFields.producto_interes).toBe("quiero la de Surco");
  });

  it("si el último mensaje del bot no tiene opciones, un número no se interpreta como opción", () => {
    const f = flow([{ text: "Elige sede", buttons: four }], send("after", [{ text: "Escribe tu respuesta" }]));
    const s = existing(catalogWith(f)).says("menu").says("1");
    expect(s.state.contact.customFields.producto_interes).toBe("1");
  });

  it("un botón con enlace cuenta en la numeración pero no se puede elegir", () => {
    const buttons = [{ title: "Catálogo", type: "url", url: "https://x.pe" }, { title: "Asesor", type: "postback", payload: "asesor" }];
    const s = existing(catalogWith(flow([{ text: "¿Qué prefieres?", buttons }]))).says("menu").says("1");
    expect(s.state.contact.customFields.producto_interes).toBe("1");
    const t = existing(catalogWith(flow([{ text: "¿Qué prefieres?", buttons }]))).says("menu").says("2");
    expect(t.state.contact.customFields.producto_interes).toBe("Asesor");
  });

  it("el menú viaja en la sesión como variable interna y sobrevive al estado JSON", () => {
    const s = existing(catalogWith(flow([{ text: "Elige sede", buttons: four }]))).says("menu");
    const menu = JSON.parse(s.state.sessions[0].variables.__menu);
    expect(menu).toMatchObject({ kind: "button" });
    expect(menu.options[0]).toEqual({ title: "Miraflores", payload: "miraflores" });
    s.state = JSON.parse(JSON.stringify(s.state));
    s.says("1");
    expect(s.state.contact.customFields.producto_interes).toBe("Miraflores");
  });
});

// ── Cliente sin responder ───────────────────────────────────────────────────

describe("cliente sin responder tras un mensaje del bot", () => {
  const reminder = (): LabFlow => ({
    id: "recordatorio",
    name: "Recordatorio",
    status: "published",
    nodes: [trigger({ triggerType: "client_no_reply", minutes: 30 }), send("m", [{ text: "¿Sigues ahí?" }])],
    edges: [edge("t", "m")],
  });
  const greeting = (): LabFlow => keywordFlow("saludo", "hola", [send("m", [{ text: "¡Hola! ¿Qué buscas?" }])], [edge("t", "m")]);

  it("el último mensaje es del bot y el cliente espera respuesta humana (waiting_since): avisa a los 30 min, una sola vez", () => {
    const catalog = withFlows([greeting(), reminder()]);
    const s = existing(catalog).says("hola");
    expect(s.openCase()?.waitingSince).toBe(MONDAY_10AM);
    expect(s.openCase()?.lastOutboundAt).toBe(MONDAY_10AM);
    s.wait(29);
    expect(s.newBotTexts()).toEqual([]);
    s.wait(1);
    expect(s.newBotTexts()).toEqual(["¿Sigues ahí?"]);
    expect(s.openCase()?.noReplyEventMinutes).toBe(30);
    // waiting_since conserva su significado: el cliente sigue esperando a una persona.
    expect(s.openCase()?.waitingSince).toBe(MONDAY_10AM);
    // El recordatorio no sella la salida: no se repite para el mismo mensaje.
    s.wait(600);
    expect(s.newBotTexts()).toEqual([]);
  });

  it("si el cliente contesta antes, no avisa; un mensaje nuevo del bot reinicia la cuenta", () => {
    const catalog = withFlows([greeting(), reminder()]);
    const s = existing(catalog).says("hola").wait(20).says("hola");
    s.wait(25);
    expect(s.steps("case_event")).toHaveLength(0);
    s.wait(10);
    expect(s.newBotTexts()).toEqual(["¿Sigues ahí?"]);
  });

  it("el mensaje de una persona también cuenta, y con el bot en pausa el aviso igual corre", () => {
    const catalog = withFlows([reminder()]);
    const s = existing(catalog).says("necesito ayuda").wait(1).agent("Te ayudo");
    expect(s.state.automationPaused).toBe(true);
    s.wait(31);
    expect(s.newBotTexts()).toEqual(["¿Sigues ahí?"]);
  });
});
