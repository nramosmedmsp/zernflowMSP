import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.noReplyTrigger({
  caseType: "Venta de membresía",
  minutes: 1440,
  label: "El cliente no responde en 24 horas",
});
const agendada = f.condition("¿Tenía visita agendada?", [
  {
    field: "case_stage",
    operator: "equals",
    ref: { kind: "stage", name: "Visita o clase de prueba agendada", caseType: "Venta de membresía" },
  },
]);
const pregunta = f.message(
  "Preguntar si quiere reprogramar",
  {
    text: "Hola, vimos que no pudiste venir a tu visita. ¿Quieres reprogramarla? Dinos qué día y hora te vienen mejor y te ayudamos.",
    quickReplies: ["Sí, reprogramar", "Hablar con un asesor"],
  },
  { template_name: "reprogramar_visita", language: "es", params: ["{nombre}"] },
);

f.chain(trigger, agendada);
f.yes(agendada, pregunta);

export const gymRecordatorioVisita: FlowTemplate = {
  id: "gym-recordatorio-visita",
  name: "Recordatorio de visita no asistida",
  description:
    "Si el cliente no responde en 24 horas y su gestión sigue en \"Visita o clase de prueba agendada\", le pregunta si quiere reprogramar. Como ya pasó la ventana de 24 h, usa una plantilla de WhatsApp.",
  business: "gym",
  category: "Agenda",
  adjust: [
    "Crea y aprueba en WhatsApp una plantilla llamada \"reprogramar_visita\" (idioma es) con una variable para el nombre, o cambia el nombre en el nodo por el de tu plantilla.",
    "La respuesta \"Sí, reprogramar\" activa la plantilla \"Agendar visita o clase de prueba\" (por la palabra clave \"reprogramar\") y \"Hablar con un asesor\" activa la plantilla del mismo nombre: publícalas también.",
    "Ajusta los minutos en el disparador si quieres avisar antes o después.",
  ],
  requires: ["gym-agendar-visita", "general-asesor"],
  allowedOpenEnds: [agendada],
  graph: f.build(),
};
