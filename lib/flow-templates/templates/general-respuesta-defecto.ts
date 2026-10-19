import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.defaultTrigger("Cualquier mensaje que no coincida con otro disparador");
const reparte = f.distribute("Repartir a un asesor si no tiene responsable");

f.chain(trigger, reparte);

export const generalRespuestaDefecto: FlowTemplate = {
  id: "general-respuesta-defecto",
  name: "Respuesta cuando ningún flujo aplica",
  description:
    "Se activa con cualquier mensaje que no coincida con otro disparador (y que no responda a una pregunta de un flujo). Si la gestión no tiene responsable, la reparte a un asesor.",
  business: "general",
  category: "Soporte",
  adjust: [
    "Es opcional: los flujos que hacen preguntas no la necesitan, porque la respuesta del cliente retoma la pregunta por sí sola.",
    "Si ya tienes un flujo con disparador \"Por defecto\", no hace falta: solo puede haber uno que se active.",
    "Puedes agregar aquí una respuesta automática (por ejemplo, un menú) además del reparto.",
  ],
  graph: f.build(),
};
