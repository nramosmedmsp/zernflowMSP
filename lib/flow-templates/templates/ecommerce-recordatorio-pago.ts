import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.noReplyTrigger({
  caseType: "Venta",
  minutes: 120,
  label: "El cliente no responde en 2 horas",
});
const enEspera = f.condition("¿Sigue esperando el pago?", [
  {
    field: "case_stage",
    operator: "equals",
    ref: { kind: "stage", name: "Esperando pago", caseType: "Venta" },
  },
]);
const recordatorio = f.message(
  "Recordatorio amable de pago",
  {
    text: "Hola, ¿pudiste realizar el pago de tu pedido? Si necesitas ayuda con los medios de pago o tienes alguna duda, escríbenos y te ayudamos con gusto.",
  },
  { template_name: "recordatorio_pago", language: "es", params: ["{nombre}"] },
);

f.chain(trigger, enEspera);
f.yes(enEspera, recordatorio);

export const ecommerceRecordatorioPago: FlowTemplate = {
  id: "ecommerce-recordatorio-pago",
  name: "Recordatorio de pago",
  description:
    "Si el cliente no responde en 2 horas y la venta sigue en \"Esperando pago\", le envía un recordatorio amable. Si la ventana de 24 h ya se cerró, usa una plantilla de WhatsApp.",
  business: "ecommerce",
  category: "Pagos",
  adjust: [
    "Crea y aprueba en WhatsApp una plantilla llamada \"recordatorio_pago\" (idioma es) con una variable para el nombre, o cambia el nombre en el nodo por el de tu plantilla.",
    "Ajusta los minutos de espera en el disparador si prefieres otro tiempo.",
    "Si la venta ya no está en \"Esperando pago\", el flujo termina sin enviar nada.",
  ],
  allowedOpenEnds: [enEspera],
  graph: f.build(),
};
