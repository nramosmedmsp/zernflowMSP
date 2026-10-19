import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.keywordTrigger(
  ["pedido", "envío", "envio", "tracking", "seguimiento"],
  "Pregunta por su pedido o envío",
);
const clasifica = f.classify("Clasificar como Postventa (Estado de pedido)", {
  caseType: "Postventa",
  category: "Estado de pedido",
});
const pide = f.message("Pedir el número de pedido", {
  text: "Con gusto revisamos tu pedido. ¿Cuál es tu número de pedido?",
});
const espera = f.wait("Esperar el número de pedido");
const guarda = f.setField("Guardar el número de pedido", "numero_pedido", "{{message}}");
const confirma = f.message("Confirmar que se revisará", {
  text: "Gracias, estamos revisando el estado de tu pedido {{message}}. Un asesor te responderá en breve.",
});
const equipo = f.assignTeam("Asignar al equipo Atención", "Atención");

f.chain(trigger, clasifica, pide, espera, guarda, confirma, equipo);

export const ecommerceEstadoPedido: FlowTemplate = {
  id: "ecommerce-estado-pedido",
  name: "Estado de pedido",
  description:
    "Cuando el cliente pregunta por su pedido o envío, clasifica la gestión como Postventa con la categoría \"Estado de pedido\", pide el número de pedido, lo guarda en un campo del contacto y la asigna al equipo \"Atención\".",
  business: "ecommerce",
  category: "Postventa",
  adjust: [
    "Crea un equipo llamado \"Atención\" (o elige otro en el nodo Asignar a equipo). Si no existe, ese nodo queda sin configurar.",
    "Necesita la categoría \"Estado de pedido\" en el tipo de gestión Postventa (la trae la plantilla de negocio E-commerce). Si no existe, la gestión se clasifica igual pero sin categoría.",
    "El número de pedido llega con la siguiente respuesta del cliente (el flujo la espera), aunque sea solo un número.",
    "Revisa que las palabras clave no choquen con otros flujos tuyos.",
  ],
  customFields: [{ slug: "numero_pedido", name: "Número de pedido" }],
  graph: f.build(),
};
