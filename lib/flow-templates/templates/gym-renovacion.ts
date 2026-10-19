import { FlowBuilder, reemplaza } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.stageTrigger({
  caseType: "Renovación",
  stage: "Contactado",
  label: "La renovación pasa a \"Contactado\"",
});
const planes = f.message("Enviar planes y medios de pago", [
  { text: "¡Hola! Tu membresía está por vencer y queremos que sigas entrenando con nosotros. Estos son nuestros planes de renovación:" },
  {
    text: [
      `• Mensual: ${reemplaza("S/ 120")}`,
      `• Trimestral: ${reemplaza("S/ 330")}`,
      `• Anual: ${reemplaza("S/ 1100")}`,
    ].join("\n"),
  },
  {
    text: [
      "Puedes pagar por:",
      `• Yape o Plin: ${reemplaza("999 999 999")} a nombre de ${reemplaza("titular")}`,
      `• Transferencia: ${reemplaza("banco, cuenta y CCI")}`,
      "• En la sede, con efectivo o tarjeta",
      "Cuando pagues, envíanos la captura por aquí. Si prefieres hablar con un asesor, escribe \"asesor\".",
    ].join("\n"),
  },
]);

f.chain(trigger, planes);

export const gymRenovacion: FlowTemplate = {
  id: "gym-renovacion",
  name: "Renovación interesada",
  description:
    "Cuando una renovación pasa a \"Contactado\", envía los planes de renovación y los medios de pago, y explica cómo hablar con un asesor.",
  business: "gym",
  category: "Renovación",
  adjust: [
    "Reemplaza los planes, precios y datos de pago de ejemplo (marcados como [REEMPLAZA: ...]) por los reales antes de publicar.",
    "Para que \"asesor\" funcione, publica también la plantilla general \"Hablar con un asesor\".",
    "Si la ventana de 24 h de WhatsApp está cerrada, el mensaje no se envía: configura una plantilla de respaldo en el nodo Enviar mensaje.",
  ],
  requires: ["general-asesor"],
  graph: f.build(),
};
