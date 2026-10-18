// Canales de prueba (sin migración): un canal es de prueba si su
// `late_account_id` empieza con "demo-". Sus mensajes viven solo en la tabla
// local `messages` y nunca se envían a Zernio. Lo usan las rutas de mensajes y
// plantillas, el motor de gestiones, los flujos, las difusiones y la bandeja
// (etiqueta "Prueba"). Lógica pura, sin servidor ni React.

import { fillPlaceholders, summarizeTemplate, type TemplateSummary } from "@/lib/whatsapp-templates";

export const DEMO_ACCOUNT_PREFIX = "demo-";

/** Etiqueta que se muestra junto a canales y conversaciones de prueba. */
export const DEMO_LABEL = "Prueba";

/** Acepta el canal (con `late_account_id`) o el propio ID de cuenta. */
export function isDemoChannel(
  channelOrAccountId: { late_account_id?: string | null } | string | null | undefined,
): boolean {
  const accountId =
    typeof channelOrAccountId === "string" ? channelOrAccountId : channelOrAccountId?.late_account_id;
  return typeof accountId === "string" && accountId.startsWith(DEMO_ACCOUNT_PREFIX);
}

// ── Plantillas de prueba ──────────────────────────────────────────────────

/** Plantillas aprobadas que ofrece un canal de prueba (formato de Zernio/Meta). */
const RAW_DEMO_TEMPLATES = [
  {
    id: "demo-template-recordatorio-recompra",
    name: "recordatorio_recompra",
    language: "es",
    category: "MARKETING",
    status: "APPROVED",
    components: [
      {
        type: "BODY",
        text: "Hola {{1}}, ya casi se te acaba tu suplemento. ¿Quieres que te separemos tu pedido de recompra con tu precio de cliente?",
      },
    ],
  },
  {
    id: "demo-template-seguimiento-pedido",
    name: "seguimiento_pedido",
    language: "es",
    category: "UTILITY",
    status: "APPROVED",
    components: [
      {
        type: "BODY",
        text: "Hola {{1}}, tu pedido {{2}} ya salió de nuestro almacén. Te avisamos apenas llegue a tu dirección.",
      },
    ],
  },
] as const;

export function demoTemplates(): TemplateSummary[] {
  return RAW_DEMO_TEMPLATES.map((t) => summarizeTemplate(t));
}

/**
 * Texto de una plantilla con sus variables ya reemplazadas, para guardarlo
 * como mensaje. Si la plantilla no es una de las de prueba, solo su nombre
 * (más los valores, para que se vea qué se habría enviado).
 */
export function demoTemplateText(templateName: string, params: readonly string[]): string {
  const template = demoTemplates().find((t) => t.name === templateName);
  if (template?.body) return fillPlaceholders(template.body, params);
  const values = params.length > 0 ? ` (${params.join(", ")})` : "";
  return `Plantilla: ${templateName}${values}`;
}
