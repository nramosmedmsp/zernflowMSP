import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.welcomeTrigger();
const saludo = f.message("Saludo con opciones", {
  text: "¡Hola! Gracias por escribirnos. Soy el asistente virtual de la tienda. ¿En qué te puedo ayudar?",
  buttons: ["Quiero comprar", "Mi pedido", "Otra consulta"],
});
const espera = f.wait("Esperar la opción elegida");
const esVenta = f.replyContains("¿Quiere comprar?", "comprar");

// Venta
const clasificaVenta = f.classify("Clasificar como Venta", { caseType: "Venta" });
const preguntaProducto = f.message("Preguntar qué producto busca", {
  text: "¡Genial! ¿Qué producto estás buscando? Cuéntame la marca, el sabor o el objetivo que tienes.",
});
const esperaProducto = f.wait("Esperar el producto");
const guardaProducto = f.setField("Guardar el producto buscado", "producto_interes", "{{message}}");
const etiquetaVenta = f.tag("Etiquetar: interesado en compra", "Interesado en compra");
const avisoVenta = f.message("Avisar que un asesor escribirá", {
  text: "Gracias, tomé nota de lo que buscas. Un asesor te escribirá en breve para ayudarte con tu pedido.",
});

// Postventa
const esPedido = f.replyContains("¿Consulta por su pedido?", "pedido");
const clasificaPostventa = f.classify("Clasificar como Postventa", { caseType: "Postventa" });
const avisoPostventa = f.message("Atender consulta de pedido", {
  text: "Con gusto te ayudamos con tu pedido. Si tienes el número de pedido, envíalo por aquí. Un asesor revisará tu caso y te responderá en breve.",
});

// Consulta
const clasificaConsulta = f.classify("Clasificar como Consulta", { caseType: "Consulta" });
const avisoConsulta = f.message("Pedir la consulta", {
  text: "Claro, cuéntanos tu consulta y un asesor te responderá en breve.",
});

const reparte = f.distribute("Repartir a un asesor");

f.chain(trigger, saludo, espera, esVenta);
f.yes(esVenta, clasificaVenta);
f.chain(clasificaVenta, preguntaProducto, esperaProducto, guardaProducto, etiquetaVenta, avisoVenta, reparte);
f.no(esVenta, esPedido);
f.yes(esPedido, clasificaPostventa);
f.chain(clasificaPostventa, avisoPostventa, reparte);
f.no(esPedido, clasificaConsulta);
f.chain(clasificaConsulta, avisoConsulta, reparte);

export const ecommerceBienvenida: FlowTemplate = {
  id: "ecommerce-bienvenida",
  name: "Bienvenida y clasificación",
  description:
    "Saluda en el primer mensaje y ofrece tres opciones. Según lo que elija el cliente clasifica la gestión (Venta, Postventa o Consulta); en una venta pregunta qué producto busca y lo guarda. Al final reparte la gestión a un asesor.",
  business: "ecommerce",
  category: "Bienvenida",
  adjust: [
    "Cambia el saludo y los textos por el tono de tu tienda.",
    "Necesita los tipos de gestión Venta, Postventa y Consulta (los carga la plantilla de negocio E-commerce).",
    "Si publicas también \"Bienvenida simple\", desactiva una de las dos: ambas se activan con el primer mensaje.",
  ],
  customFields: [{ slug: "producto_interes", name: "Producto de interés" }],
  graph: f.build(),
};
