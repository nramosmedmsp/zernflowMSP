// Marca configurable por variables de entorno públicas (NEXT_PUBLIC_*), de modo
// que el mismo código sirva para distintos despliegues sin tocar componentes.
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CRM";
export const APP_LOGO_URL = process.env.NEXT_PUBLIC_APP_LOGO_URL || "/logo.png";
export const APP_DESCRIPTION =
  process.env.NEXT_PUBLIC_APP_DESCRIPTION || "Gestión de conversaciones y clientes";
