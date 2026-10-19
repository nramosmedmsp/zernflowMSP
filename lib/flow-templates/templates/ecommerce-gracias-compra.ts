import { FlowBuilder, reemplaza } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.closedTrigger({
  caseType: "Venta",
  outcome: "won",
  label: "Se cierra una venta como ganada",
});
const gracias = f.message("Agradecer, tiempos de envío y seguimiento", [
  { text: "¡Gracias por tu compra! Ya confirmamos tu pago y estamos preparando tu pedido." },
  {
    text: [
      "Tiempos de envío según tu destino:",
      `• Lima: ${reemplaza("1 a 2 días hábiles")}`,
      `• Provincia: ${reemplaza("3 a 5 días hábiles")}`,
      "Te avisaremos apenas salga tu pedido.",
    ].join("\n"),
  },
  { text: "Para consultar el estado de tu pedido escribe \"pedido\" y te ayudamos." },
]);

f.chain(trigger, gracias);

export const ecommerceGraciasCompra: FlowTemplate = {
  id: "ecommerce-gracias-compra",
  name: "Gracias por tu compra",
  description:
    "Cuando una venta se cierra como ganada, agradece la compra, informa los tiempos de envío para Lima y provincia y explica cómo consultar el pedido.",
  business: "ecommerce",
  category: "Postventa",
  adjust: [
    "Reemplaza los tiempos de envío de ejemplo (marcados como [REEMPLAZA: ...]) por los reales de tu tienda.",
    "Agrega o quita destinos según tus zonas de envío.",
    "Si la ventana de 24 h de WhatsApp está cerrada, el mensaje no se envía: configura una plantilla de respaldo en el nodo Enviar mensaje.",
  ],
  graph: f.build(),
};
