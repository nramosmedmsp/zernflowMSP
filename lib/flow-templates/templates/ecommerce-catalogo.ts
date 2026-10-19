import { FlowBuilder, reemplaza } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.keywordTrigger(
  [
    "precio",
    "precios",
    "catálogo",
    "catalogo",
    // "lista" solo al inicio, para no activarse con frases como "ya está lista mi compra".
    { value: "lista", matchType: "startsWith" },
  ],
  "Pregunta por precios o catálogo",
);
const catalogo = f.message("Enviar el catálogo", {
  text: `Aquí puedes ver nuestro catálogo con los precios actualizados:\n${reemplaza("https://tutienda.pe/catalogo")}\n\n¿Te ayudo a elegir algo?`,
  quickReplies: ["Hablar con un asesor", "Consultar mi pedido"],
});
const etapa = f.changeStage("Pasar a Asesorando", { caseType: "Venta", stage: "Asesorando" });

f.chain(trigger, catalogo, etapa);

export const ecommerceCatalogo: FlowTemplate = {
  id: "ecommerce-catalogo",
  name: "Catálogo y precios",
  description:
    "Cuando el cliente pregunta por precios o el catálogo, le envía el enlace con respuestas rápidas y pasa la venta a la etapa \"Asesorando\".",
  business: "ecommerce",
  category: "Ventas",
  adjust: [
    "Reemplaza el enlace de ejemplo por el de tu catálogo o lista de precios.",
    "Cambia las respuestas rápidas si quieres otras opciones.",
    "La etapa cambia solo si la gestión abierta es una Venta.",
  ],
  graph: f.build(),
};
