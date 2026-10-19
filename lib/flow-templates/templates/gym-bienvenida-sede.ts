import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";
import { GYM_SAMPLE_SEDES } from "./gym-sedes";


const f = new FlowBuilder();

const trigger = f.welcomeTrigger();
const saludo = f.message("Saludo con opciones", {
  text: "¡Hola! Gracias por escribirnos. ¿En qué te podemos ayudar?",
  buttons: ["Quiero inscribirme", "Ya soy socio", "Otra consulta"],
});
const espera = f.wait("Esperar la opción elegida");
const quiereInscribirse = f.replyContains("¿Quiere inscribirse?", "inscribir");
const venta = f.classify("Clasificar como Venta de membresía", { caseType: "Venta de membresía" });
const socio = f.classify("Clasificar como Atención al socio", { caseType: "Atención al socio" });

const preguntaSede = f.message("Preguntar la sede", {
  text: "¿En qué sede quieres que te atendamos?",
  buttons: [...GYM_SAMPLE_SEDES],
});
const esperaSede = f.wait("Esperar la sede");

const confirma = f.message("Avisar que un asesor de la sede responderá", {
  text: "¡Listo! En un momento un asesor de tu sede te atenderá por este chat.",
});

f.chain(trigger, saludo, espera, quiereInscribirse);
f.yes(quiereInscribirse, venta);
f.no(quiereInscribirse, socio);
f.link(venta, preguntaSede);
f.link(socio, preguntaSede);
f.chain(preguntaSede, esperaSede);

// Una condición por sede; si no reconoce la sede, reparte con el equipo actual.
let previous = esperaSede;
let previousHandle: "yes" | "no" | undefined;
for (const sede of GYM_SAMPLE_SEDES) {
  const esSede = f.replyContains(`¿Eligió ${sede}?`, sede);
  const asigna = f.assignTeam(`Asignar al equipo ${sede}`, sede);
  f.link(previous, esSede, previousHandle);
  f.yes(esSede, asigna);
  f.link(asigna, confirma);
  previous = esSede;
  previousHandle = "no";
}
const sinSede = f.distribute("Repartir con el equipo actual");
f.link(previous, sinSede, "no");
f.link(sinSede, confirma);

export const gymBienvenidaSede: FlowTemplate = {
  id: "gym-bienvenida-sede",
  name: "Bienvenida y sede",
  description:
    "Saluda en el primer mensaje con tres opciones, clasifica la gestión (Venta de membresía o Atención al socio), pregunta la sede con botones y asigna la gestión al equipo de esa sede.",
  business: "gym",
  category: "Bienvenida",
  adjust: [
    "Cambia \"Sede 1\", \"Sede 2\" y \"Sede 3\" (en los botones y en los nodos Asignar a equipo) por los nombres reales de tus sedes; deben ser iguales al nombre del equipo de cada sede.",
    "Si tienes más o menos de tres sedes, agrega o quita botones, condiciones y nodos de asignación.",
    "Si una sede no existe como equipo, su nodo Asignar a equipo queda sin configurar.",
    "Si publicas también \"Bienvenida simple\", desactiva una de las dos: ambas se activan con el primer mensaje.",
  ],
  graph: f.build(),
};
