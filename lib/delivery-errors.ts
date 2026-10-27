// Motivos de los mensajes que la plataforma no entregó (deliveryError de
// Zernio), en español. Meta manda el título en inglés; los códigos más comunes
// de WhatsApp tienen texto propio y el resto muestra el detalle original.

export interface DeliveryErrorLike {
  code?: number | null;
  title?: string | null;
  message?: string | null;
}

const WHATSAPP_CODES: Record<number, string> = {
  131047: "pasaron más de 24 horas desde el último mensaje del cliente",
  131026: "el número no tiene WhatsApp o no puede recibir el mensaje",
  131049: "WhatsApp no lo entregó para no saturar al cliente con mensajes",
  131050: "el cliente pidió no recibir mensajes de marketing",
  131051: "WhatsApp no admite este tipo de mensaje",
  131052: "no se pudo descargar el archivo del mensaje",
  131053: "no se pudo subir el archivo del mensaje",
  131056: "se enviaron demasiados mensajes seguidos a este cliente; espera un momento",
  130472: "WhatsApp no lo entregó al cliente (prueba de Meta)",
};

/** Texto del motivo, sin "No se entregó" (lo agrega quien lo muestra). */
export function deliveryErrorText(err: DeliveryErrorLike | null | undefined): string | null {
  if (!err) return null;
  if (typeof err.code === "number" && WHATSAPP_CODES[err.code]) return WHATSAPP_CODES[err.code];
  const detail = (err.title || err.message || "").trim();
  return detail || null;
}
