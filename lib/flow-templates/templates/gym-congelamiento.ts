import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.keywordTrigger(["congelar", "congelamiento", "pausar"], "Quiere congelar su membresía");
const clasifica = f.classify("Clasificar como Atención al socio (Congelamiento)", {
  caseType: "Atención al socio",
  category: "Congelamiento",
});
const pideMotivo = f.message("Preguntar el motivo", {
  text: "Con gusto te ayudamos con el congelamiento de tu membresía. ¿Cuál es el motivo?",
});
const esperaMotivo = f.wait("Esperar el motivo");
const guardaMotivo = f.setField("Guardar el motivo", "motivo_congelamiento", "{{message}}");
const pideFechas = f.message("Preguntar las fechas", {
  text: "Gracias. ¿Desde qué fecha y hasta qué fecha quieres congelar tu membresía?",
});
const esperaFechas = f.wait("Esperar las fechas");
const guardaFechas = f.setField("Guardar las fechas", "fechas_congelamiento", "{{message}}");
const confirma = f.message("Avisar que un asesor revisará", {
  text: "Recibimos tu solicitud. Un asesor la revisará y te confirmará por este chat.",
});
const reparte = f.distribute("Repartir a un asesor");
const humano = f.takeover("Pasar a atención humana", "Solicitud de congelamiento: revisa el motivo y las fechas guardados en los campos del contacto.");

f.chain(
  trigger,
  clasifica,
  pideMotivo,
  esperaMotivo,
  guardaMotivo,
  pideFechas,
  esperaFechas,
  guardaFechas,
  confirma,
  reparte,
  humano,
);

export const gymCongelamiento: FlowTemplate = {
  id: "gym-congelamiento",
  name: "Congelamiento",
  description:
    "Cuando el socio pide congelar su membresía, clasifica la gestión como Atención al socio con la categoría \"Congelamiento\", pregunta el motivo y las fechas, los guarda y pasa a atención humana con un asesor asignado.",
  business: "gym",
  category: "Socios",
  adjust: [
    "Necesita la categoría \"Congelamiento\" en el tipo de gestión Atención al socio (la trae la plantilla de negocio Gimnasio). Si no existe, la gestión se clasifica igual pero sin categoría.",
    "Agrega a tu política las condiciones del congelamiento (plazos, costos) en los mensajes si quieres informarlas.",
    "El texto del nodo Atención humana se guarda como nota interna en la gestión, para el asesor; los datos que respondió el socio quedan además en los campos del contacto.",
  ],
  customFields: [
    { slug: "motivo_congelamiento", name: "Motivo de congelamiento" },
    { slug: "fechas_congelamiento", name: "Fechas de congelamiento" },
  ],
  graph: f.build(),
};
