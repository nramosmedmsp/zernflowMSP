import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.keywordTrigger(
  ["visita", "clase de prueba", "clase gratis", "agendar", "reprogramar"],
  "Quiere visitar o probar una clase",
);
const pide = f.message("Pedir día y hora preferidos", {
  text: "¡Excelente! Te esperamos para que conozcas el gimnasio. ¿Qué día y a qué hora te gustaría venir?",
});
const espera = f.wait("Esperar el día y la hora");
const guarda = f.setField("Guardar el día y la hora preferidos", "visita_preferida", "{{message}}");
const etapa = f.changeStage("Pasar a Visita o clase de prueba agendada", {
  caseType: "Venta de membresía",
  stage: "Visita o clase de prueba agendada",
});
const confirma = f.message("Confirmar y avisar que un asesor confirmará", {
  text: "Gracias, anotamos tu preferencia: {{message}}. Un asesor te confirmará el horario por este chat.",
});
const reparte = f.distribute("Repartir a un asesor");

f.chain(trigger, pide, espera, guarda, etapa, confirma, reparte);

export const gymAgendarVisita: FlowTemplate = {
  id: "gym-agendar-visita",
  name: "Agendar visita o clase de prueba",
  description:
    "Cuando el cliente quiere visitar el gimnasio o probar una clase, pide el día y la hora, guarda la respuesta, pasa la venta a \"Visita o clase de prueba agendada\", confirma y avisa que un asesor confirmará el horario.",
  business: "gym",
  category: "Agenda",
  adjust: [
    "Agrega o quita palabras clave según cómo te escriben tus clientes.",
    "La etapa cambia solo si la gestión abierta es una Venta de membresía.",
    "Ajusta el texto si ofreces la clase de prueba gratis o con costo.",
  ],
  customFields: [{ slug: "visita_preferida", name: "Visita preferida" }],
  graph: f.build(),
};
