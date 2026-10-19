import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.closedTrigger({
  caseType: "Postventa",
  outcome: "resolved",
  label: "Se resuelve una gestión de Postventa",
});
const pregunta = f.message("Preguntar la satisfacción (1 a 5)", {
  text: "¿Cómo calificarías la atención que recibiste? Responde con un número del 1 al 5, donde 1 es muy mala y 5 excelente.",
  quickReplies: ["1", "2", "3", "4", "5"],
});
const espera = f.wait("Esperar la calificación");
const baja = f.condition(
  "¿Calificó 1 o 2?",
  [
    { field: "variable:message", operator: "gt", value: "0" },
    { field: "variable:message", operator: "lt", value: "3" },
  ],
  "and",
);
const alta = f.condition(
  "¿Calificó 3, 4 o 5?",
  [
    { field: "variable:message", operator: "gt", value: "2" },
    { field: "variable:message", operator: "lt", value: "6" },
  ],
  "and",
);

const etiquetaMala = f.tag("Etiquetar: Insatisfecho", "Insatisfecho");
const lamenta = f.message("Lamentar y avisar a un asesor", {
  text: "Lamentamos que tu experiencia no haya sido la mejor. Un asesor te contactará para ayudarte a resolverlo.",
});
const humano = f.takeover("Pasar a atención humana", "Cliente insatisfecho en la encuesta de postventa (calificó 1 o 2). Contáctalo para entender qué pasó.");

const etiquetaBuena = f.tag("Etiquetar: Satisfecho", "Satisfecho");
const agradece = f.message("Agradecer la calificación", {
  text: "¡Gracias por tu calificación! Nos ayuda a seguir mejorando. Aquí estamos para lo que necesites.",
});

const invalida = f.message("Agradecer sin calificación válida", {
  text: "Gracias por responder. Si necesitas algo más, escríbenos cuando quieras.",
});

f.chain(trigger, pregunta, espera, baja);
f.yes(baja, etiquetaMala);
f.chain(etiquetaMala, lamenta, humano);
f.no(baja, alta);
f.yes(alta, etiquetaBuena);
f.chain(etiquetaBuena, agradece);
f.no(alta, invalida);

export const ecommerceEncuesta: FlowTemplate = {
  id: "ecommerce-encuesta",
  name: "Encuesta de satisfacción",
  description:
    "Cuando una gestión de Postventa se resuelve, pregunta del 1 al 5 con respuestas rápidas. Etiqueta al contacto como \"Satisfecho\" o \"Insatisfecho\" y, si calificó 1 o 2, pasa a atención humana.",
  business: "ecommerce",
  category: "Postventa",
  adjust: [
    "Si la ventana de 24 h de WhatsApp está cerrada, la pregunta no se envía: configura una plantilla de respaldo en el nodo Enviar mensaje.",
    "En WhatsApp, con más de 3 opciones las respuestas rápidas llegan como lista numerada: el cliente responde con el número.",
    "Si calificó 1 o 2, el texto del nodo Atención humana se guarda como nota interna en la gestión, para el asesor.",
  ],
  graph: f.build(),
};
