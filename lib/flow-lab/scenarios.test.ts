// Escenarios completos con el catálogo de las plantillas E-commerce y generales
// (lib/flow-templates + lib/business-templates.ts).
//
// Calendario: el reloj empieza el lunes 19/10/2026 a las 10:00 de Lima.

import { beforeAll, describe, expect, it } from "vitest";
import { ecommerceCatalog, flowIdOf, MONDAY_10AM, returningCustomer, Script } from "./lab.test-helper";
import type { LabCatalog } from "./types";

let catalog: LabCatalog;

beforeAll(async () => {
  // Recompra con plantilla automática de WhatsApp (como la que se configuraría en Ajustes).
  catalog = await ecommerceCatalog({
    patchCaseTypes: {
      Recompra: { autoTemplate: { template_name: "recordatorio_recompra", language: "es", params: ["{nombre}"] } },
    },
    globalKeywords: [],
  });
});

const prospect = () => new Script(catalog, { contact: { name: "Lucía", existed: false } });
/** Cliente que vuelve: su gestión nueva queda sin clasificar y por eso la bienvenida («Gestión nueva sin clasificar») lo saluda. */
const returning = () => returningCustomer(catalog);

describe("pregunta precio", () => {
  it("un prospecto nuevo que pregunta el precio recibe el catálogo, no la bienvenida", () => {
    const s = prospect().says("Hola, ¿cuál es el precio de la proteína?");

    // Gana la palabra clave: va antes que la bienvenida.
    const trigger = s.steps("trigger_evaluation")[0];
    expect(trigger.level).toBe("ok");
    expect(trigger.flowId).toBe(flowIdOf(catalog, "Catálogo y precios"));
    expect(trigger.text).toContain("precio");
    const candidates = trigger.data!.candidates as Array<{ flowName: string; outcome: string; why: string }>;
    // «Bienvenida y clasificación» ya no es un disparador de mensajes: escucha la gestión nueva sin clasificar.
    expect(candidates.find((c) => c.flowName === "Bienvenida y clasificación")).toBeUndefined();
    expect(candidates.find((c) => c.flowName === "Catálogo y precios")!.outcome).toBe("matched");
    // La gestión del prospecto se abre ya como Venta: no está sin clasificar y el saludo no corre.
    const opened = s.steps("case_event").find((x) => (x.data as { event?: string }).event === "case_opened");
    expect(opened?.text).toContain("ningún disparador coincide");
    const noGreeting = (opened!.data!.candidates as Array<{ flowName: string; outcome: string; why: string }>).find(
      (c) => c.flowName === "Bienvenida y clasificación",
    )!;
    expect(noGreeting.outcome).toBe("not_matched");
    expect(noGreeting.why).toContain("Solo aplica a gestiones sin clasificar");

    // Un mensaje con enlace y respuestas rápidas.
    const bot = s.messages("bot");
    expect(bot).toHaveLength(1);
    expect(bot[0].text).toContain("catálogo");
    expect(bot[0].quickReplies?.map((q) => q.title)).toEqual(["Hablar con un asesor", "Consultar mi pedido"]);
    expect(bot[0].flowId).toBe(flowIdOf(catalog, "Catálogo y precios"));

    // Pasa la venta a Asesorando y se ilumina el recorrido del mapa.
    expect(s.typeNameOf(s.openCase())).toBe("Venta");
    expect(s.stageNameOf(s.openCase())).toBe("Asesorando");
    expect(s.last.visited.map((v) => v.nodeId)).toEqual(["n1", "n2", "n3"]);
    expect(s.last.visited.every((v) => v.flowId === flowIdOf(catalog, "Catálogo y precios"))).toBe(true);
  });

  it("«lista» solo cuenta al inicio del mensaje", () => {
    const s = prospect().says("ya está lista mi compra");
    expect(s.messages("bot").map((m) => m.flowName)).not.toContain("Catálogo y precios");
    const lista = new Script(catalog, { contact: { existed: true } }).says("lista de precios por favor");
    expect(lista.messages("bot")[0].flowName).toBe("Catálogo y precios");
  });

  it("si la gestión no es una Venta, el flujo no cambia la etapa (no hay etapa de ese tipo)", () => {
    const s = prospect().says("precio").classify("Consulta").says("catálogo");
    expect(s.typeNameOf(s.openCase())).toBe("Consulta");
    expect(s.stageNameOf(s.openCase())).toBe("Abierta");
    expect(s.allText()).toContain("no pertenece a este tipo de gestión");
  });
});

describe("gestión nueva sin clasificar → bienvenida → compra → producto → reparto", () => {
  it("un prospecto nuevo abre una Venta ya clasificada: la bienvenida sin clasificar no corre", () => {
    const s = prospect().says("Hola");
    expect(s.typeNameOf(s.openCase())).toBe("Venta");
    expect(s.stageNameOf(s.openCase())).toBe("Nuevo interesado");
    expect(s.state.contact.contactTypeId).toBe(s.contactTypeId("Prospecto"));
    expect(s.state.sessions.some((x) => x.flowId === flowIdOf(catalog, "Bienvenida y clasificación"))).toBe(false);
  });

  it("recorre la bienvenida hasta el aviso al asesor (cliente que vuelve, gestión sin clasificar)", () => {
    const s = returning().says("Hola");

    // Se abre la gestión y se reparte antes de buscar disparador (mismo orden que el webhook real); el evento corre después.
    const order = s.last.steps.map((x) => x.kind);
    expect(order.indexOf("case_opened")).toBeLessThan(order.indexOf("trigger_evaluation"));
    expect(order.indexOf("case_assigned")).toBeLessThan(order.indexOf("trigger_evaluation"));
    expect(order.indexOf("trigger_evaluation")).toBeLessThan(order.indexOf("flow_started"));
    expect(s.typeNameOf(s.openCase())).toBeUndefined();
    expect(s.state.contact.contactTypeId).toBe(s.contactTypeId("Cliente"));
    const eventStep = s.steps("case_event")[0];
    expect(eventStep.text).toContain("Evento «gestión nueva»");
    expect(eventStep.level).toBe("ok");

    // Saludo con tres botones: WhatsApp los admite tal cual.
    const greeting = s.messages("bot")[0];
    expect(greeting.buttons?.map((b) => b.title)).toEqual(["Quiero comprar", "Mi pedido", "Otra consulta"]);
    expect(greeting.adaptation).toBeUndefined();
    const greetingFlow = flowIdOf(catalog, "Bienvenida y clasificación");
    const greetingSession = () => s.state.sessions.find((x) => x.flowId === greetingFlow)!;
    expect(greetingSession()).toMatchObject({ status: "active", waitingForInput: true });

    // Elige "Quiero comprar": retoma la espera sin buscar disparador.
    s.press("Quiero comprar", "quiero_comprar");
    expect(s.steps("trigger_evaluation")).toHaveLength(0);
    expect(s.steps("flow_resumed")).toHaveLength(1);
    const cond = s.steps("condition")[0];
    expect(cond.data).toMatchObject({ passed: true, path: "yes" });
    expect(s.newBotTexts()).toEqual(["¡Genial! ¿Qué producto estás buscando? Cuéntame la marca, el sabor o el objetivo que tienes."]);
    expect(s.typeNameOf(s.openCase())).toBe("Venta");
    expect(s.steps("case_classified")).toHaveLength(1); // quedó sin clasificar: la bienvenida la clasifica como Venta
    expect(s.typeNameOf(s.openCase())).toBe("Venta");

    // Dice el producto: se guarda, se etiqueta y se avisa.
    s.says("Proteína whey vainilla");
    expect(s.state.contact.customFields.producto_interes).toBe("Proteína whey vainilla");
    expect(s.state.contact.tags).toEqual(["Interesado en compra"]);
    expect(s.newBotTexts()).toEqual(["Gracias, tomé nota de lo que buscas. Un asesor te escribirá en breve para ayudarte con tu pedido."]);
    expect(s.allText()).toContain("La gestión ya tiene responsable");
    expect(greetingSession().status).toBe("completed");
    expect(s.state.automationPaused).toBe(false);
  });

  it("«Mi pedido» clasifica como Postventa y repite el reparto en el equipo del tipo", () => {
    const s = returning().says("hola").press("Mi pedido");
    expect(s.typeNameOf(s.openCase())).toBe("Postventa");
    expect(s.stageNameOf(s.openCase())).toBe("Nueva");
    expect(s.steps("case_classified")[0].text).toContain("«Postventa»");
    expect(s.newBotTexts()[0]).toContain("Con gusto te ayudamos con tu pedido");
  });

  it("«Otra consulta» (ni compra ni pedido) clasifica como Consulta", () => {
    const s = returning().says("hola").press("Otra consulta");
    expect(s.typeNameOf(s.openCase())).toBe("Consulta");
    expect(s.newBotTexts()).toEqual(["Claro, cuéntanos tu consulta y un asesor te responderá en breve."]);
  });

  it("escribir «1» se interpreta como el primer botón («Quiero comprar») y la condición que busca «comprar» coincide", () => {
    const s = returning().says("hola").says("1");
    const interpreted = s.steps("info").find((x) => x.text.includes("se interpreta como la opción"));
    expect(interpreted?.text).toContain("La respuesta «1» se interpreta como la opción «Quiero comprar»");
    expect(interpreted?.text).toContain("carga «quiero_comprar»");
    expect(s.steps("flow_resumed")[0].text).toContain("con la respuesta «Quiero comprar»");
    expect(s.steps("condition")[0].data).toMatchObject({ passed: true, path: "yes" });
    expect(s.typeNameOf(s.openCase())).toBe("Venta");
    expect(s.newBotTexts()[0]).toContain("¿Qué producto estás buscando?");
  });

  it("«2.» y el texto del botón sin tildes ni mayúsculas también eligen la opción", () => {
    const pedido = returning().says("hola").says("2.");
    expect(pedido.typeNameOf(pedido.openCase())).toBe("Postventa");
    const consulta = returning().says("hola").says("OTRA CONSULTA");
    expect(consulta.typeNameOf(consulta.openCase())).toBe("Consulta");
    const pedido2 = returning().says("hola").says("mi PEDIDO");
    expect(pedido2.typeNameOf(pedido2.openCase())).toBe("Postventa");
  });

  it("un número fuera del menú (o un texto largo) no elige nada y la condición no coincide", () => {
    const s = returning().says("hola").says("7");
    expect(s.steps("info").some((x) => x.text.includes("se interpreta como la opción"))).toBe(false);
    expect(s.steps("condition")[0].data).toMatchObject({ passed: false });
    expect(s.typeNameOf(s.openCase())).toBe("Consulta");
  });

  it("después de un mensaje sin opciones, un número ya no es una opción del menú", () => {
    // El producto se pide con texto libre: «1» es la respuesta, no el primer botón del saludo.
    const s = returning().says("hola").press("Quiero comprar", "quiero_comprar").says("1");
    expect(s.state.contact.customFields.producto_interes).toBe("1");
  });
});

describe("pide un asesor (el bot queda en pausa)", () => {
  it("avisa, reparte, deja una nota y pausa la automatización", () => {
    const s = prospect().says("Quiero hablar con un asesor");
    expect(s.steps("trigger_evaluation")[0].flowId).toBe(flowIdOf(catalog, "Hablar con un asesor"));
    expect(s.newBotTexts()).toEqual(["Claro, te comunico con un asesor. En un momento te responde por este chat."]);
    expect(s.state.automationPaused).toBe(true);
    expect(s.openCase()?.notes).toEqual([
      { at: MONDAY_10AM, body: "El cliente pidió hablar con un asesor.", authorId: null },
    ]);
    expect(s.state.sessions.at(-1)).toMatchObject({ status: "completed" });
    expect(s.state.sessions.at(-1)!.humanTakeoverAt).toBe(MONDAY_10AM);
  });

  it("con el bot en pausa, los mensajes del cliente actualizan la gestión pero no disparan flujos", () => {
    const s = prospect().says("asesor").wait(5).says("¿hola? ¿precio?");
    expect(s.steps("trigger_evaluation")).toHaveLength(0);
    expect(s.last.warnings[0]).toContain("pausa");
    expect(s.newBotTexts()).toEqual([]);
    // La gestión sí registra el mensaje y la espera.
    expect(s.openCase()?.lastInboundAt).toBe(s.state.clock);
    // La espera del cliente sigue contando desde su primer mensaje sin responder.
    expect(s.openCase()?.waitingSince).toBe(MONDAY_10AM);
  });
});

describe("asesor → Pedido o enlace de pago enviado → datos de pago → recordatorio", () => {
  /** Cliente que pide asesor, asesor que responde. */
  function withAdvisor() {
    return prospect().says("precio").says("quiero hablar con un asesor").wait(3).agent("Hola Lucía, te cuento las opciones");
  }

  it("el asesor responde: sella la primera respuesta y pausa el bot", () => {
    const s = withAdvisor();
    const row = s.openCase()!;
    expect(row.waitingSince).toBeNull();
    expect(row.firstResponseAt).toBe(s.state.clock);
    expect(s.state.automationPaused).toBe(true);
    expect(s.steps("info").some((x) => x.text.includes("Primera respuesta humana"))).toBe(true);
  });

  it("con el bot en pausa, el cambio de etapa sí dispara «Datos de pago» (los flujos de gestión son intencionales)", () => {
    const s = withAdvisor();
    expect(s.state.automationPaused).toBe(true);
    s.stage("Pedido o enlace de pago enviado");
    const event = s.steps("case_event")[0];
    expect(event.level).toBe("ok");
    expect(event.text).toContain("coinciden «Datos de pago»");
    expect(s.steps("info").some((x) => x.text.includes("pero los flujos de eventos de gestión se ejecutan igual"))).toBe(true);
    expect(s.newBotTexts()).toHaveLength(2);
    expect(s.newBotTexts()[0]).toContain("Estos son nuestros medios de pago");
    expect(s.stageNameOf(s.openCase())).toBe("Esperando pago");
    // Sigue en pausa: el bot no habla encima del asesor cuando escribe el cliente.
    expect(s.state.automationPaused).toBe(true);
    s.says("ya pagué, precio");
    expect(s.steps("trigger_evaluation")).toHaveLength(0);
    expect(s.last.warnings[0]).toContain("pausa");
  });

  it("pausar y reanudar a mano equivale al botón de la bandeja", () => {
    const s = prospect().says("precio").botPaused(true);
    expect(s.state.automationPaused).toBe(true);
    expect(s.steps("bot_paused")[0].text).toContain("Pausar bot");
    s.says("catálogo");
    expect(s.steps("trigger_evaluation")).toHaveLength(0);
    s.botPaused(false);
    expect(s.state.automationPaused).toBe(false);
    expect(s.steps("bot_resumed")[0].text).toContain("Reanudar bot");
    s.says("catálogo");
    expect(s.steps("trigger_evaluation")[0].level).toBe("ok");
  });

  it("con el bot activo: datos de pago, etapa «Esperando pago» y, a las 2 h, el recordatorio", () => {
    const s = withAdvisor().botPaused(false).stage("Pedido o enlace de pago enviado");

    // Dos mensajes con los medios de pago y la etapa siguiente.
    const texts = s.newBotTexts();
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("Estos son nuestros medios de pago");
    expect(texts[1]).toContain("captura del pago");
    expect(s.stageNameOf(s.openCase())).toBe("Esperando pago");
    // Hubo dos cambios de etapa: el del asesor y el del flujo (con su cadena).
    expect(s.steps("case_stage_changed").map((x) => x.text)).toEqual([
      expect.stringContaining("«Pedido o enlace de pago enviado»"),
      expect.stringContaining("«Esperando pago»"),
    ]);

    // A la 1 h 59 todavía no; a las 2 h, el recordatorio (ventana abierta: texto).
    s.wait(119);
    expect(s.newBotTexts()).toEqual([]);
    s.wait(2);
    expect(s.newBotTexts()).toEqual([
      "Hola, ¿pudiste realizar el pago de tu pedido? Si necesitas ayuda con los medios de pago o tienes alguna duda, escríbenos y te ayudamos con gusto.",
    ]);
    const event = s.steps("case_event").find((x) => (x.data as { event?: string }).event === "client_no_reply");
    expect(event?.text).toContain("120 min");
    // El recordatorio no se sella: no reinicia la cuenta ni se repite cada 2 h.
    s.wait(600);
    expect(s.newBotTexts()).toEqual([]);
  });

  it("si la venta ya no está en «Esperando pago», el recordatorio termina sin enviar", () => {
    const s = withAdvisor().botPaused(false).stage("Pedido o enlace de pago enviado").stage("Asesorando").wait(130);
    expect(s.newBotTexts()).toEqual([]);
    expect(s.steps("condition")[0].data).toMatchObject({ passed: false });
  });
});

describe("pasar 24 h: plantilla o aviso", () => {
  function windowClosed() {
    return prospect()
      .says("precio")
      .wait(2)
      .agent("Te paso los datos")
      .wait(25 * 60)
      // Un mensaje nuevo del asesor reinicia la cuenta de «cliente sin responder» (la anterior venció con el bot en pausa).
      .agent("¿Sigues interesada?")
      .botPaused(false);
  }

  it("la traza avisa cuando se cierra la ventana de 24 h", () => {
    const s = prospect().says("precio").wait(24 * 60 + 1);
    const closed = s.steps("window_closed");
    expect(closed).toHaveLength(1);
    expect(closed[0].at).toBe("2026-10-20T15:00:00.000Z");
  });

  it("sin plantilla en el nodo, el mensaje no se envía y se avisa", () => {
    const s = windowClosed().stage("Pedido o enlace de pago enviado");
    expect(s.newBotTexts()).toEqual([]);
    const skipped = s.steps("message_skipped");
    expect(skipped).toHaveLength(1); // un solo nodo con dos mensajes: se decide por nodo
    expect(skipped[0].text).toContain("La ventana de 24 h de WhatsApp está cerrada y el nodo no tiene una plantilla configurada");
    expect(s.last.warnings.length).toBeGreaterThan(0);
    // Aun así la etapa sigue su camino.
    expect(s.stageNameOf(s.openCase())).toBe("Esperando pago");
  });

  it("con plantilla en el nodo, se envía la plantilla con el nombre del contacto", () => {
    const s = windowClosed().stage("Pedido o enlace de pago enviado").wait(121);
    // El cliente no responde en 2 h y la ventana de 24 h está cerrada: el recordatorio sale por plantilla.
    const reminder = s.messages("bot").at(-1)!;
    expect(reminder.kind).toBe("template");
    expect(reminder.template).toEqual({ name: "recordatorio_pago", language: "es", params: ["Lucía"] });
    expect(reminder.text).toContain("recordatorio_pago");
    expect(s.steps("message_sent").at(-1)!.text).toContain("Ventana de 24 h cerrada: se envía la plantilla de WhatsApp «recordatorio_pago»");
  });

  it("en Instagram no hay ventana ni plantillas: el nodo envía el texto", () => {
    const s = new Script(catalog, { channel: "instagram", contact: { existed: false } })
      .says("precio")
      .agent("Te paso los datos")
      .wait(25 * 60)
      .botPaused(false)
      .stage("Pedido o enlace de pago enviado");
    expect(s.newBotTexts()).toHaveLength(2);
    expect(s.steps("message_skipped")).toHaveLength(0);
  });
});

describe("cerrar ganada → gracias + recompra programada a 25 días", () => {
  function closedWon() {
    return prospect().says("precio").says("asesor").wait(3).agent("Listo, te espero").close({ kind: "won" });
  }

  it("aplica las reglas del tipo: Cliente y Recompra a 25 días a las 09:00 de Lima", () => {
    const s = closedWon();
    expect(s.state.contact.contactTypeId).toBe(s.contactTypeId("Cliente"));
    const [recompra] = s.casesOfType("Recompra");
    expect(recompra.status).toBe("scheduled");
    // Lunes 19/10 + 25 días = viernes 13/11 a las 09:00 de Lima (14:00 UTC).
    expect(recompra.scheduledFor).toBe("2026-11-13T14:00:00.000Z");
    expect(s.steps("rule_applied").map((x) => x.text)).toEqual([
      expect.stringContaining("«Cliente»"),
    ]);
    expect(s.steps("case_scheduled")[0].text).toContain("13/11/2026 09:00 (Lima)");
  });

  it("el cierre reanuda el bot y «Gracias por tu compra» se envía", () => {
    const s = closedWon();
    expect(s.steps("bot_resumed")).toHaveLength(1);
    expect(s.state.automationPaused).toBe(false);
    const texts = s.newBotTexts();
    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain("¡Gracias por tu compra!");
    // Eventos: etapa final y cierre; solo el de cierre tiene flujo.
    const events = s.steps("case_event");
    expect(events.map((e) => (e.data as { event: string }).event)).toEqual(["case_stage_changed", "case_closed"]);
    expect(events[0].text).toContain("ningún disparador coincide");
    expect(events[1].text).toContain("«Gracias por tu compra»");
  });

  it("una segunda compra ganada deja Cliente frecuente y mueve la Recompra programada (no la duplica)", () => {
    const s = closedWon()
      .wait(60 * 24 * 2)
      .says("quiero comprar de nuevo, precio")
      .classify("Venta") // un Cliente ya no tiene Venta sugerida: la gestión nace sin clasificar
      .close({ kind: "won" });
    expect(s.state.contact.contactTypeId).toBe(s.contactTypeId("Cliente frecuente"));
    expect(s.casesOfType("Recompra")).toHaveLength(1);
    expect(s.steps("case_scheduled")[0].data).toMatchObject({ rescheduled: true });
  });

  it("avanzar 25 días activa la recompra: plantilla automática, etapa siguiente y flujo «Recompra interesada»", () => {
    const s = closedWon().wait(25 * 24 * 60);
    const [recompra] = s.casesOfType("Recompra");
    expect(recompra.status).toBe("open");
    expect(recompra.assigneeId).toBeTruthy();
    expect(s.steps("case_activated")).toHaveLength(1);

    // Plantilla automática de WhatsApp con el nombre.
    const template = s.messages("bot").find((m) => m.kind === "template")!;
    expect(template.template).toEqual({ name: "recordatorio_recompra", language: "es", params: ["Lucía"] });
    expect(template.text).toContain("Hola Lucía, ya casi se te acaba tu suplemento");
    expect(recompra.autoTemplateSentAt).toBeTruthy();

    // Pasa a la segunda etapa ("Interesado") y eso dispara «Recompra interesada»; la ventana está cerrada
    // (el cliente escribió hace 25 días) y el nodo no tiene plantilla: no se envía.
    expect(s.stageNameOf(recompra)).toBe("Interesado");
    expect(s.steps("case_event").some((e) => e.text.includes("«Recompra interesada»"))).toBe(true);
    expect(s.steps("message_skipped").length).toBeGreaterThan(0);
  });

  it("si el cliente vuelve a escribir tras la activación, la gestión de Recompra es la que se usa", () => {
    const s = closedWon().wait(25 * 24 * 60).says("sí, quiero mi pedido, precio");
    expect(s.openCase()?.caseTypeId).toBe(s.typeId("Recompra"));
    expect(s.steps("case_reused")).toHaveLength(1);
  });
});

describe("se da de baja", () => {
  it("«baja» exacta desuscribe y confirma", () => {
    const s = new Script(catalog, { contact: { existed: true } }).says("baja");
    expect(s.state.contact.subscribed).toBe(false);
    expect(s.newBotTexts()[0]).toContain("ya no te enviaremos más mensajes");
    expect(s.steps("subscription_changed")[0].data).toEqual({ subscribed: false });
  });

  it("«rebajas» no es «baja»: el disparador es de coincidencia exacta", () => {
    const s = new Script(catalog, { contact: { existed: true } }).says("¿tienen rebajas?");
    expect(s.state.contact.subscribed).toBe(true);
    expect(s.messages("bot").map((m) => m.flowName)).not.toContain("Darse de baja");
  });

  it("la frase «no más mensajes» también", () => {
    const s = new Script(catalog, { contact: { existed: true } }).says("por favor no más mensajes");
    expect(s.state.contact.subscribed).toBe(false);
  });

  it("una palabra clave global con acción de baja se resuelve antes que los flujos", async () => {
    const withGlobal = await ecommerceCatalog({ globalKeywords: [{ keyword: "STOP", action: "unsubscribe" }] });
    const s = new Script(withGlobal, { contact: { existed: true } }).says(" stop ");
    expect(s.state.contact.subscribed).toBe(false);
    expect(s.newBotTexts()).toEqual([]); // el flujo «Darse de baja» no corre
    expect(s.steps("global_keyword")[0].text).toContain("se da de baja");
    expect(s.steps("trigger_evaluation")).toHaveLength(0);
    // Y se puede volver a suscribir.
    const back = await ecommerceCatalog({ globalKeywords: [{ keyword: "alta", action: "subscribe" }] });
    const t = new Script(back, { contact: { existed: true, subscribed: false } }).says("ALTA");
    expect(t.state.contact.subscribed).toBe(true);
  });
});
