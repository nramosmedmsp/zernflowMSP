import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.keywordTrigger(
  ["me interesa", "más información", "mas informacion", "quiero información", "quiero informacion"],
  "Pide información",
);
const pideNombre = f.message("Pedir el nombre", {
  text: "¡Genial, con gusto te ayudo! ¿Cómo te llamas?",
});
const esperaNombre = f.wait("Esperar el nombre");
const guardaNombre = f.setField("Guardar el nombre", "nombre_completo", "{{message}}");
const pideCorreo = f.message("Pedir el correo", {
  text: "¡Gracias, {{message}}! ¿Cuál es tu correo electrónico para enviarte más detalles?",
});
const esperaCorreo = f.wait("Esperar el correo");
const guardaCorreo = f.setField("Guardar el correo", "correo_electronico", "{{message}}");
const etiqueta = f.tag("Etiquetar como cliente potencial", "Cliente potencial");
const despide = f.message("Confirmar y avisar", {
  text: "¡Listo! Guardamos tus datos. En breve te contactaremos con la información.",
});

f.chain(trigger, pideNombre, esperaNombre, guardaNombre, pideCorreo, esperaCorreo, guardaCorreo, etiqueta, despide);

export const generalCapturaDatos: FlowTemplate = {
  id: "general-captura-datos",
  name: "Captura de clientes potenciales",
  description:
    "Cuando el cliente muestra interés, le pregunta el nombre y el correo paso a paso, guarda cada respuesta en un campo del contacto y lo etiqueta como cliente potencial.",
  business: "general",
  category: "Ventas",
  adjust: [
    "Cambia las palabras clave y los textos por los de tu negocio.",
    "Agrega más preguntas (teléfono, ciudad, producto) copiando los pasos de pregunta, espera y guardado.",
    "Cada respuesta del cliente retoma la pregunta en curso por sí sola: no hace falta otro flujo. Si el cliente tarda más de 24 horas en contestar, la espera vence y su mensaje se trata como uno nuevo.",
  ],
  customFields: [
    { slug: "nombre_completo", name: "Nombre completo" },
    { slug: "correo_electronico", name: "Correo electrónico" },
  ],
  graph: f.build(),
};
