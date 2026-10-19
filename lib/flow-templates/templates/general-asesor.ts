import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.keywordTrigger(["asesor", "humano", "persona", "agente"], "Pide hablar con una persona");
const aviso = f.message("Avisar que lo comunicas con un asesor", {
  text: "Claro, te comunico con un asesor. En un momento te responde por este chat.",
});
// El reparto va antes de la atención humana: ese nodo detiene el flujo.
const reparte = f.distribute("Repartir a un asesor");
const humano = f.takeover("Pasar a atención humana", "El cliente pidió hablar con un asesor.");

f.chain(trigger, aviso, reparte, humano);

export const generalAsesor: FlowTemplate = {
  id: "general-asesor",
  name: "Hablar con un asesor",
  description:
    "Cuando el cliente pide hablar con una persona (asesor, humano, persona o agente), avisa que lo comunicas, reparte la gestión a un asesor y detiene la automatización para que lo atienda una persona.",
  business: "general",
  category: "Soporte",
  adjust: [
    "Cambia el texto del aviso por el tono de tu negocio y, si quieres, indica el horario de atención.",
    "Agrega o quita palabras clave. Con \"persona\" se activa también con frases como \"una persona me escribió\".",
    "Después de este flujo la automatización de esa conversación queda en pausa hasta que se reanude.",
  ],
  graph: f.build(),
};
