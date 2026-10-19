import { FlowBuilder, reemplaza } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.closedTrigger({
  caseType: "Venta de membresía",
  outcome: "won",
  label: "Se cierra una venta de membresía como ganada",
});
const bienvenida = f.message("Bienvenida, reglas y horarios", [
  { text: "¡Bienvenido al gimnasio! Ya eres parte de nuestra comunidad. Estamos felices de acompañarte en tu entrenamiento." },
  {
    text: [
      "Algunas reglas básicas:",
      `• ${reemplaza("Lleva una toalla y una botella de agua")}`,
      `• ${reemplaza("Usa ropa y calzado deportivo")}`,
      `• ${reemplaza("Guarda tus pertenencias en los casilleros")}`,
    ].join("\n"),
  },
  {
    text: [
      "Nuestros horarios:",
      `• Lunes a viernes: ${reemplaza("6:00 a 22:00")}`,
      `• Sábados: ${reemplaza("7:00 a 20:00")}`,
      `• Domingos y feriados: ${reemplaza("8:00 a 14:00")}`,
      "Si tienes dudas, escríbenos por aquí.",
    ].join("\n"),
  },
]);

f.chain(trigger, bienvenida);

export const gymBienvenidaSocio: FlowTemplate = {
  id: "gym-bienvenida-socio",
  name: "Bienvenida al nuevo socio",
  description:
    "Cuando una venta de membresía se cierra como ganada, da la bienvenida al nuevo socio y le envía las reglas básicas y los horarios del gimnasio.",
  business: "gym",
  category: "Socios",
  adjust: [
    "Reemplaza las reglas y los horarios de ejemplo (marcados como [REEMPLAZA: ...]) por los reales de tu gimnasio.",
    "Si tienes varias sedes con horarios distintos, deja solo lo común y usa \"Horarios de la sede\" para el detalle.",
    "Si la ventana de 24 h de WhatsApp está cerrada, el mensaje no se envía: configura una plantilla de respaldo en el nodo Enviar mensaje.",
  ],
  graph: f.build(),
};
