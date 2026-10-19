// Escenarios de ejemplo para la plantilla de negocio E-commerce con las
// plantillas de flujos tal como vienen (lib/flow-templates). Si cambias los
// textos o los nombres de tus flujos, estos escenarios avisan qué dejó de cumplirse.

import type { NamedScenario, ScenarioStep } from "../types";
import { example, existingContact, NEW_PROSPECT } from "./helpers";

/** Un asesor atiende una venta: pregunta el precio, pide un asesor y este responde. */
const ADVISOR_ATTENDS: ScenarioStep[] = [
  { type: "client_text", text: "precio" },
  { type: "client_text", text: "quiero hablar con un asesor" },
  { type: "advance", minutes: 3 },
  { type: "agent_reply", text: "Hola Lucía, te cuento las opciones" },
];

export const ECOMMERCE_EXAMPLES: NamedScenario[] = [
  example({
    name: "Pregunta el precio",
    description: "Un prospecto nuevo pregunta el precio de la proteína: recibe el catálogo (no la bienvenida) y la venta pasa a «Asesorando».",
    business: "ecommerce",
    profile: NEW_PROSPECT,
    steps: [{ type: "client_text", text: "Hola, ¿cuál es el precio de la proteína?" }],
    expect: [
      { kind: "flow_activated", flow: "Catálogo y precios" },
      { kind: "bot_message_contains", text: "catálogo con los precios" },
      { kind: "case_type", caseType: "Venta" },
      { kind: "case_stage", stage: "Asesorando" },
    ],
  }),
  example({
    name: "Bienvenida, comprar, producto y reparto",
    description:
      "Un cliente que vuelve a escribir (su gestión queda sin clasificar) recibe la bienvenida, elige «Quiero comprar», dice qué producto busca y la gestión se reparte a un asesor.",
    business: "ecommerce",
    profile: existingContact("Cliente"),
    steps: [
      { type: "client_text", text: "Hola" },
      { type: "client_button", title: "Quiero comprar", payload: "quiero_comprar" },
      { type: "client_text", text: "Proteína whey vainilla" },
    ],
    expect: [
      { kind: "flow_activated", flow: "Bienvenida y clasificación" },
      { kind: "bot_message_contains", text: "¿En qué te puedo ayudar?", after: 1 },
      { kind: "case_type", caseType: "Venta", after: 2 },
      { kind: "bot_message_contains", text: "¿Qué producto estás buscando?", after: 2 },
      { kind: "case_type", caseType: "Venta" },
      { kind: "custom_field", field: "Producto de interés", value: "Proteína whey vainilla" },
      { kind: "tag", tag: "Interesado en compra", present: true },
      { kind: "bot_message_contains", text: "Un asesor te escribirá en breve" },
      { kind: "assigned", assigned: true },
    ],
  }),
  example({
    name: "Pide un asesor",
    description: "El cliente pide hablar con una persona: el bot avisa, se reparte la gestión y la automatización queda en pausa.",
    business: "ecommerce",
    profile: NEW_PROSPECT,
    steps: [{ type: "client_text", text: "Quiero hablar con un asesor" }],
    expect: [
      { kind: "flow_activated", flow: "Hablar con un asesor" },
      { kind: "bot_message_contains", text: "te comunico con un asesor" },
      { kind: "assigned", assigned: true },
      { kind: "bot_paused", paused: true },
    ],
  }),
  example({
    name: "Con el bot en pausa no responde",
    description: "Después de pedir un asesor el bot queda en pausa: lo que el cliente escribe luego no dispara ningún flujo ni mensaje.",
    business: "ecommerce",
    profile: NEW_PROSPECT,
    steps: [
      { type: "client_text", text: "Quiero hablar con un asesor" },
      { type: "advance", minutes: 5 },
      { type: "client_text", text: "¿hola? ¿precio?" },
    ],
    expect: [
      { kind: "bot_paused", paused: true, after: 1 },
      { kind: "nothing_sent", after: 3 },
      { kind: "bot_paused", paused: true },
    ],
  }),
  example({
    name: "Mi pedido con número",
    description: "El cliente pregunta por su pedido: la gestión pasa a Postventa, el bot pide el número, lo guarda en el contacto y lo confirma.",
    business: "ecommerce",
    profile: NEW_PROSPECT,
    steps: [
      { type: "client_text", text: "Hola, quiero saber de mi pedido" },
      { type: "client_text", text: "PE-12345" },
    ],
    expect: [
      { kind: "flow_activated", flow: "Estado de pedido" },
      { kind: "case_type", caseType: "Postventa", after: 1 },
      { kind: "bot_message_contains", text: "¿Cuál es tu número de pedido?", after: 1 },
      { kind: "custom_field", field: "Número de pedido", value: "PE-12345" },
      { kind: "bot_message_contains", text: "estado de tu pedido PE-12345" },
    ],
  }),
  example({
    name: "Asesor mueve a «Pedido o enlace de pago enviado» y salen los datos de pago",
    description:
      "El asesor atiende la venta y la mueve a «Pedido o enlace de pago enviado»: el flujo «Datos de pago» envía los medios de pago aunque el bot esté en pausa y deja la venta en «Esperando pago».",
    business: "ecommerce",
    profile: NEW_PROSPECT,
    steps: [...ADVISOR_ATTENDS, { type: "change_stage", stage: "Pedido o enlace de pago enviado" }],
    expect: [
      { kind: "bot_paused", paused: true, after: 4 },
      { kind: "flow_activated", flow: "Datos de pago", scope: "step", after: 5 },
      { kind: "bot_message_contains", text: "Estos son nuestros medios de pago", scope: "step", after: 5 },
      { kind: "bot_message_contains", text: "captura del pago", scope: "step", after: 5 },
      { kind: "case_stage", stage: "Esperando pago" },
    ],
  }),
  example({
    name: "Sin respuesta en 2 horas: recordatorio de pago",
    description:
      "Con la venta en «Esperando pago» (el asesor reactivó el bot), si el cliente no responde en 2 horas el bot envía el recordatorio. A la 1 h 59 todavía no envía nada.",
    business: "ecommerce",
    profile: NEW_PROSPECT,
    steps: [
      ...ADVISOR_ATTENDS,
      { type: "pause_bot", paused: false },
      { type: "change_stage", stage: "Pedido o enlace de pago enviado" },
      { type: "advance", minutes: 119 },
      { type: "advance", minutes: 2 },
    ],
    expect: [
      { kind: "case_stage", stage: "Esperando pago", after: 6 },
      { kind: "nothing_sent", after: 7 },
      { kind: "flow_activated", flow: "Recordatorio de pago", scope: "step", after: 8 },
      { kind: "bot_message_contains", text: "¿pudiste realizar el pago", scope: "step", after: 8 },
    ],
  }),
  example({
    name: "Cerrar ganada: gracias y recompra a 25 días",
    description:
      "El asesor cierra la venta como ganada: se agradece la compra, el contacto pasa a «Cliente» y se programa una Recompra para dentro de 25 días.",
    business: "ecommerce",
    profile: NEW_PROSPECT,
    steps: [...ADVISOR_ATTENDS, { type: "close", outcome: "won" }],
    expect: [
      { kind: "flow_activated", flow: "Gracias por tu compra", scope: "step", after: 5 },
      { kind: "bot_message_contains", text: "¡Gracias por tu compra!", scope: "step", after: 5 },
      { kind: "case_status", status: "won", of: "Venta" },
      { kind: "contact_type", contactType: "Cliente" },
      { kind: "scheduled_case", caseType: "Recompra", inDays: 25 },
    ],
  }),
  example({
    name: "A los 25 días se activa la recompra",
    description:
      "Tras cerrar una venta ganada pasan 25 días: la gestión de Recompra programada se activa (abierta y con responsable). Si configuras una plantilla automática para Recompra en Ajustes, agrega la expectativa «Se envió una plantilla de WhatsApp».",
    business: "ecommerce",
    profile: NEW_PROSPECT,
    steps: [...ADVISOR_ATTENDS, { type: "close", outcome: "won" }, { type: "advance", minutes: 25 * 24 * 60 }],
    expect: [
      { kind: "scheduled_case", caseType: "Recompra", inDays: 25, after: 5 },
      { kind: "case_status", status: "open", of: "Recompra" },
      { kind: "assigned", assigned: true, of: "Recompra" },
    ],
  }),
  example({
    name: "Pasadas 24 horas, el recordatorio de pago sale como plantilla",
    description:
      "Si la ventana de 24 h de WhatsApp ya se cerró, «Datos de pago» (sin plantilla en el nodo) no envía nada y el recordatorio de pago, que sí la tiene, sale como plantilla «recordatorio_pago».",
    business: "ecommerce",
    profile: NEW_PROSPECT,
    steps: [
      { type: "client_text", text: "precio" },
      { type: "advance", minutes: 2 },
      { type: "agent_reply", text: "Te paso los datos" },
      { type: "advance", minutes: 25 * 60 },
      { type: "agent_reply", text: "¿Sigues interesada?" },
      { type: "pause_bot", paused: false },
      { type: "change_stage", stage: "Pedido o enlace de pago enviado" },
      { type: "advance", minutes: 121 },
    ],
    expect: [
      { kind: "nothing_sent", after: 7 },
      { kind: "template_sent", name: "recordatorio_pago", scope: "step", after: 8 },
      { kind: "flow_activated", flow: "Recordatorio de pago", scope: "step", after: 8 },
    ],
  }),
  example({
    name: "Se da de baja",
    description: "El cliente escribe «baja»: se le desuscribe de las difusiones y el bot confirma.",
    business: "ecommerce",
    profile: existingContact(null),
    steps: [{ type: "client_text", text: "baja" }],
    expect: [
      { kind: "flow_activated", flow: "Darse de baja" },
      { kind: "subscribed", subscribed: false },
      { kind: "bot_message_contains", text: "ya no te enviaremos más mensajes" },
    ],
  }),
  example({
    name: "Responde «1» al menú en WhatsApp",
    description:
      "Tras el saludo con opciones, el cliente responde solo «1» en vez de pulsar el botón: se entiende como la primera opción («Quiero comprar») y la conversación sigue por la compra.",
    business: "ecommerce",
    profile: existingContact("Cliente"),
    steps: [
      { type: "client_text", text: "hola" },
      { type: "client_text", text: "1" },
    ],
    expect: [
      { kind: "bot_message_contains", text: "¿En qué te puedo ayudar?", after: 1 },
      { kind: "case_type", caseType: "Venta" },
      { kind: "bot_message_contains", text: "¿Qué producto estás buscando?", scope: "step", after: 2 },
    ],
  }),
];
