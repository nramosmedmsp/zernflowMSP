import { FlowBuilder, reemplaza } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.keywordTrigger(["ayuda", "preguntas", "preguntas frecuentes", "faq"], "Pide ayuda o preguntas frecuentes");
const pideAyuda = f.replyContains("¿Escribió \"ayuda\"?", "ayuda");
const ayuda = f.message("Respuesta de ayuda", {
  text: [
    "Te puedo ayudar con lo siguiente:",
    "• Precios y promociones",
    "• Pedidos y envíos",
    "• Soporte con tu compra",
    "",
    "Escribe tu consulta y te respondo enseguida. Si prefieres una persona, escribe \"asesor\".",
  ].join("\n"),
});
const faq = f.message("Preguntas frecuentes", {
  text: [
    "Estas son nuestras preguntas más frecuentes:",
    "",
    `1. ¿Cómo hago mi pedido? ${reemplaza("explica cómo comprar")}`,
    `2. ¿Qué medios de pago aceptan? ${reemplaza("Yape, Plin, transferencia, tarjeta")}`,
    `3. ¿Hacen envíos a todo el Perú? ${reemplaza("explica tus zonas de envío")}`,
    "",
    "¿Tienes otra duda? Escríbela y te ayudamos.",
  ].join("\n"),
});

f.chain(trigger, pideAyuda);
f.yes(pideAyuda, ayuda);
f.no(pideAyuda, faq);

export const generalFaq: FlowTemplate = {
  id: "general-faq",
  name: "Preguntas frecuentes",
  description:
    "Responde cuando el cliente escribe \"ayuda\" o \"preguntas\": con \"ayuda\" muestra los temas en los que puedes ayudarlo y con \"preguntas\" las respuestas más frecuentes.",
  business: "general",
  category: "Soporte",
  adjust: [
    "Reemplaza las respuestas de ejemplo (marcadas como [REEMPLAZA: ...]) y las preguntas por las de tu negocio.",
    "Agrega más palabras clave si tus clientes usan otras.",
    "Para que \"asesor\" funcione, publica también la plantilla \"Hablar con un asesor\".",
  ],
  requires: ["general-asesor"],
  graph: f.build(),
};
