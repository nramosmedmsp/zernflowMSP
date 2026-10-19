// Escenarios de ejemplo para la plantilla de negocio Gimnasio con las
// plantillas de flujos tal como vienen. Las sedes son las de ejemplo de las
// plantillas ("Sede 1", "Sede 2", "Sede 3"): deben llamarse igual que tus equipos.

import type { NamedScenario } from "../types";
import { example, existingContact, NEW_PROSPECT } from "./helpers";

export const GYM_EXAMPLES: NamedScenario[] = [
  example({
    name: "Bienvenida y sede",
    description:
      "Un contacto nuevo escribe: recibe el saludo, elige «Quiero inscribirme» y su sede, y la gestión (Venta de membresía) queda en el equipo de esa sede.",
    business: "gym",
    profile: NEW_PROSPECT,
    steps: [
      { type: "client_text", text: "Hola" },
      { type: "client_button", title: "Quiero inscribirme", payload: "quiero_inscribirme" },
      { type: "client_button", title: "Sede 2", payload: "sede_2" },
    ],
    expect: [
      { kind: "flow_activated", flow: "Bienvenida y sede" },
      { kind: "bot_message_contains", text: "¿En qué sede quieres que te atendamos?", after: 2 },
      { kind: "case_type", caseType: "Venta de membresía" },
      { kind: "case_team", team: "Sede 2" },
      { kind: "bot_message_contains", text: "un asesor de tu sede te atenderá" },
    ],
  }),
  example({
    name: "Agendar una visita",
    description:
      "El cliente pide una visita: el bot pregunta día y hora, los guarda, pasa la venta a «Visita o clase de prueba agendada» y avisa que un asesor confirmará.",
    business: "gym",
    profile: NEW_PROSPECT,
    steps: [
      { type: "client_text", text: "Quiero agendar una visita" },
      { type: "client_text", text: "El sábado a las 10 am" },
    ],
    expect: [
      { kind: "flow_activated", flow: "Agendar visita o clase de prueba" },
      { kind: "bot_message_contains", text: "¿Qué día y a qué hora te gustaría venir?", after: 1 },
      { kind: "custom_field", field: "Visita preferida", value: "El sábado a las 10 am" },
      { kind: "case_stage", stage: "Visita o clase de prueba agendada" },
      { kind: "bot_message_contains", text: "Un asesor te confirmará el horario" },
    ],
  }),
  example({
    name: "Congelamiento de membresía",
    description:
      "Un socio pide congelar su membresía: el bot pregunta motivo y fechas, los guarda, clasifica como Atención al socio, asigna a un asesor y pasa a atención humana.",
    business: "gym",
    profile: existingContact("Socio activo"),
    steps: [
      { type: "client_text", text: "Quiero congelar mi membresía" },
      { type: "client_text", text: "Viaje de trabajo" },
      { type: "client_text", text: "Del 1 al 30 de noviembre" },
    ],
    expect: [
      { kind: "flow_activated", flow: "Congelamiento" },
      { kind: "case_type", caseType: "Atención al socio", after: 1 },
      { kind: "custom_field", field: "Motivo de congelamiento", value: "Viaje de trabajo" },
      { kind: "custom_field", field: "Fechas de congelamiento", value: "Del 1 al 30 de noviembre" },
      { kind: "bot_message_contains", text: "Recibimos tu solicitud" },
      { kind: "assigned", assigned: true },
      { kind: "bot_paused", paused: true },
    ],
  }),
  example({
    name: "Renovación por vencer",
    description:
      "Un socio con la membresía por vencer escribe y el asesor mueve su Renovación a «Contactado»: el bot envía los planes de renovación y los medios de pago.",
    business: "gym",
    profile: { kind: "sample", name: "Socio con vencimiento en 5 días" },
    steps: [
      { type: "client_text", text: "Hola, quiero renovar mi membresía" },
      { type: "change_stage", stage: "Contactado" },
    ],
    expect: [
      { kind: "case_type", caseType: "Renovación", after: 1 },
      { kind: "flow_activated", flow: "Renovación interesada", scope: "step", after: 2 },
      { kind: "bot_message_contains", text: "Estos son nuestros planes de renovación", scope: "step", after: 2 },
      { kind: "case_stage", stage: "Contactado" },
    ],
  }),
  example({
    name: "Horarios por sede",
    description: "Un cliente elige su sede y pregunta por el horario: el bot responde el horario de esa sede, no el de las demás.",
    business: "gym",
    profile: NEW_PROSPECT,
    steps: [
      { type: "client_text", text: "Hola" },
      { type: "client_button", title: "Quiero inscribirme", payload: "quiero_inscribirme" },
      { type: "client_button", title: "Sede 3", payload: "sede_3" },
      { type: "client_text", text: "¿Cuál es el horario?" },
    ],
    expect: [
      { kind: "case_team", team: "Sede 3", after: 3 },
      { kind: "flow_activated", flow: "Horarios de la sede" },
      { kind: "bot_message_contains", text: "Horario de Sede 3", scope: "step", after: 4 },
    ],
  }),
  example({
    name: "Nuevo socio",
    description:
      "El asesor cierra la venta de membresía como ganada con la fecha de vencimiento: el bot da la bienvenida al socio, el contacto pasa a «Socio activo» y se programa su Renovación 7 días antes del vencimiento.",
    business: "gym",
    profile: { kind: "custom", name: "Lucía", contactType: "Prospecto", tags: [], existed: true, caseType: "Venta de membresía", stage: "Asesorando", recentInbound: true },
    steps: [{ type: "close", outcome: "won", keyDate: "2026-11-30" }],
    expect: [
      { kind: "flow_activated", flow: "Bienvenida al nuevo socio" },
      { kind: "bot_message_contains", text: "Bienvenido al gimnasio" },
      { kind: "case_status", status: "won", of: "Venta de membresía" },
      { kind: "contact_type", contactType: "Socio activo" },
      { kind: "scheduled_case", caseType: "Renovación", inDays: 35 },
    ],
  }),
  example({
    name: "Visita agendada que no asistió: plantilla de reprogramación",
    description:
      "Una venta con visita agendada a la que el cliente no responde en 24 horas: como la ventana de WhatsApp ya se cerró, el bot pregunta si quiere reprogramar con la plantilla «reprogramar_visita».",
    business: "gym",
    profile: { kind: "custom", name: "Lucía", contactType: "Prospecto", tags: [], existed: true, caseType: "Venta de membresía", stage: "Visita o clase de prueba agendada", recentInbound: true },
    steps: [
      { type: "agent_reply", text: "Te esperamos mañana a las 10" },
      { type: "advance", minutes: 25 * 60 },
    ],
    expect: [
      { kind: "flow_activated", flow: "Recordatorio de visita no asistida", scope: "step", after: 2 },
      { kind: "template_sent", name: "reprogramar_visita", scope: "step", after: 2 },
    ],
  }),
];
