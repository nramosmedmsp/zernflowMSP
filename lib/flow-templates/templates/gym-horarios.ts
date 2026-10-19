import { FlowBuilder, reemplaza } from "../builder";
import type { FlowTemplate } from "../types";
import { GYM_SAMPLE_SEDES } from "./gym-sedes";

const f = new FlowBuilder();

const horarioDe = (sede: string) =>
  [
    `Horario de ${sede}:`,
    `• Lunes a viernes: ${reemplaza("6:00 a 22:00")}`,
    `• Sábados: ${reemplaza("7:00 a 20:00")}`,
    `• Domingos y feriados: ${reemplaza("8:00 a 14:00")}`,
  ].join("\n");

const trigger = f.keywordTrigger(["horario", "horarios", "atienden"], "Pregunta por el horario");

// Una condición por sede (equipo de la gestión) y su respuesta.
const respuestas = GYM_SAMPLE_SEDES.map((sede) => ({
  condicion: f.condition(`¿La gestión es de ${sede}?`, [
    { field: "case_team", operator: "equals", ref: { kind: "team", name: sede } },
  ]),
  mensaje: f.message(`Horario de ${sede}`, { text: horarioDe(sede) }),
}));
// Sin sede conocida: se envían todos los horarios.
const todas = f.message("Horarios de todas las sedes", {
  text: ["Estos son los horarios de nuestras sedes:", ...GYM_SAMPLE_SEDES.map((sede) => `\n${horarioDe(sede)}`)].join("\n"),
});

f.link(trigger, respuestas[0].condicion);
respuestas.forEach((r, i) => {
  f.yes(r.condicion, r.mensaje);
  const next = respuestas[i + 1];
  f.no(r.condicion, next ? next.condicion : todas);
});

export const gymHorarios: FlowTemplate = {
  id: "gym-horarios",
  name: "Horarios de la sede",
  description:
    "Cuando el cliente pregunta por el horario, responde el de la sede según el equipo de su gestión. Si todavía no tiene sede, envía los horarios de todas.",
  business: "gym",
  category: "Horarios",
  adjust: [
    "Reemplaza los horarios de ejemplo (marcados como [REEMPLAZA: ...]) por los reales de cada sede.",
    "Cambia \"Sede 1\", \"Sede 2\" y \"Sede 3\" por los nombres reales de tus sedes; deben ser iguales al nombre del equipo de cada sede.",
    "Si una sede no existe como equipo, su condición queda sin valor y nunca se cumple.",
    "Mantén estos horarios iguales a los de Configuración > Horarios.",
  ],
  graph: f.build(),
};
