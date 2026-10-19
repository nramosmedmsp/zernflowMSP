import { FlowBuilder, reemplaza } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.stageTrigger({
  caseType: "Recompra",
  stage: "Interesado",
  label: "La recompra pasa a \"Interesado\"",
});
const enlace = f.message("Enviar el enlace de recompra y ofrecer un asesor", [
  {
    text: `¡Qué bueno que quieras volver a comprar! Puedes hacer tu pedido de nuevo aquí:\n${reemplaza("https://tutienda.pe/recompra")}`,
  },
  {
    text: "Si prefieres, también te puedo comunicar con un asesor.",
    quickReplies: ["Hablar con un asesor"],
  },
]);

f.chain(trigger, enlace);

export const ecommerceRecompra: FlowTemplate = {
  id: "ecommerce-recompra",
  name: "Recompra interesada",
  description:
    "Cuando una gestión de Recompra pasa a \"Interesado\", envía el enlace para volver a comprar y ofrece hablar con un asesor.",
  business: "ecommerce",
  category: "Recompra",
  adjust: [
    "Reemplaza el enlace de ejemplo por el de tu tienda o formulario de recompra.",
    "Para que el botón \"Hablar con un asesor\" funcione, publica también la plantilla general \"Hablar con un asesor\".",
    "Si la ventana de 24 h de WhatsApp está cerrada, el mensaje no se envía: configura una plantilla de respaldo en el nodo Enviar mensaje.",
  ],
  requires: ["general-asesor"],
  graph: f.build(),
};
