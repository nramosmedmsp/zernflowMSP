import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.keywordTrigger(
  [
    // Exactas para no activarse con palabras como "rebajas" o "stopper".
    { value: "baja", matchType: "exact" },
    { value: "stop", matchType: "exact" },
    "no más mensajes",
    "no mas mensajes",
    "darme de baja",
    "dar de baja",
  ],
  "Pide no recibir más mensajes",
);
const baja = f.unsubscribe("Desuscribir al contacto");
const confirma = f.message("Confirmar la baja", {
  text: "Listo, ya no te enviaremos más mensajes. Si más adelante quieres volver a recibirlos, escríbenos cuando quieras.",
});

f.chain(trigger, baja, confirma);

export const generalBaja: FlowTemplate = {
  id: "general-baja",
  name: "Darse de baja",
  description:
    "Cuando el cliente escribe \"baja\", \"stop\" o \"no más mensajes\", lo desuscribe de las difusiones y los mensajes automáticos, y le confirma.",
  business: "general",
  category: "Privacidad",
  adjust: [
    "Revisa el texto de confirmación.",
    "Las palabras \"baja\" y \"stop\" solo se activan si el mensaje es exactamente esa palabra.",
  ],
  graph: f.build(),
};
