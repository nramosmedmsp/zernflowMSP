import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.welcomeTrigger();
const saludo = f.message("Saludo", {
  text: "¡Hola! Bienvenido, qué gusto tenerte por aquí. ¿En qué podemos ayudarte hoy?",
});
const espera = f.delay("Esperar 1 minuto", 60, "seconds");
const seguimiento = f.message("Seguimiento", {
  text: "Por cierto, cuéntanos qué necesitas y te ayudamos enseguida.",
});

f.chain(trigger, saludo, espera, seguimiento);

export const generalBienvenidaSimple: FlowTemplate = {
  id: "general-bienvenida-simple",
  name: "Bienvenida simple",
  description:
    "Saluda a los clientes nuevos con un mensaje de bienvenida, espera un minuto y envía un seguimiento para mantener la conversación. Sirve para cualquier negocio.",
  business: "general",
  category: "Bienvenida",
  adjust: [
    "Cambia los textos por el saludo de tu negocio.",
    "Si prefieres que pregunte qué necesita el cliente y clasifique la gestión, usa la bienvenida de E-commerce o de Gimnasio en lugar de esta: no publiques dos bienvenidas a la vez.",
  ],
  graph: f.build(),
};
