import { FlowBuilder, reemplaza } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.stageTrigger({
  caseType: "Venta",
  stage: "Pedido o enlace de pago enviado",
  label: "La venta pasa a \"Pedido o enlace de pago enviado\"",
});
const datos = f.message("Enviar los medios de pago", [
  {
    text: [
      "Estos son nuestros medios de pago:",
      "",
      `• Yape: ${reemplaza("999 999 999")} a nombre de ${reemplaza("titular")}`,
      `• Plin: ${reemplaza("999 999 999")} a nombre de ${reemplaza("titular")}`,
      `• Transferencia: ${reemplaza("banco")}, cuenta ${reemplaza("número de cuenta")}, CCI ${reemplaza("número CCI")}, titular ${reemplaza("titular")}`,
    ].join("\n"),
  },
  { text: "Cuando hayas pagado, envíanos la captura del pago por este chat para confirmar tu pedido." },
]);
const etapa = f.changeStage("Pasar a Esperando pago", { caseType: "Venta", stage: "Esperando pago" });

f.chain(trigger, datos, etapa);

export const ecommerceDatosPago: FlowTemplate = {
  id: "ecommerce-datos-pago",
  name: "Datos de pago",
  description:
    "Cuando el asesor deja la venta en \"Pedido o enlace de pago enviado\", envía los datos de Yape, Plin y transferencia, pide la captura del pago y pasa la venta a \"Esperando pago\".",
  business: "ecommerce",
  category: "Pagos",
  adjust: [
    "Reemplaza TODOS los datos marcados como [REEMPLAZA: ...] (números de Yape y Plin, banco, cuentas y titulares) por los reales antes de publicar.",
    "Borra los medios de pago que no uses.",
    "Si la ventana de 24 h de WhatsApp está cerrada, el mensaje no se envía: configura una plantilla de respaldo en el nodo Enviar mensaje.",
  ],
  graph: f.build(),
};
