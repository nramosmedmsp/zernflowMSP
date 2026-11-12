// Antes de enviar una plantilla a mano (POST /api/v1/templates/send): ¿el cliente
// puede recibirla? Una plantilla de servicio sale a cualquiera; una de publicidad
// (o de categoría desconocida) solo a quien aceptó publicidad (SEG-08 / PRIV-05).
// Servidor, con el cliente de servicio.

import type { Db } from "@/lib/cases/io";
import { normalizeMarketingStatus, templateSendDecision } from "@/lib/consent";
import type { TemplateKind } from "@/lib/template-category";

export type TemplateGateBlock = {
  status: number;
  body: { error: string; code: "consent_required" | "opted_out" | "consent_unavailable"; templateKind: TemplateKind };
};

export async function templateConsentBlock(
  db: Db,
  params: { workspaceId: string; contactId: string; kind: TemplateKind },
): Promise<TemplateGateBlock | null> {
  // Una plantilla de servicio no necesita mirar el consentimiento.
  if (params.kind === "service") return null;
  const { data: contact, error } = await db
    .from("contacts")
    .select("marketing_status, is_subscribed, erased_at")
    .eq("id", params.contactId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[templates/send] consentimiento:", error.message);
    return {
      status: 503,
      body: {
        error: "No se pudo comprobar si el cliente aceptó publicidad. Inténtalo de nuevo en unos segundos.",
        code: "consent_unavailable",
        templateKind: params.kind,
      },
    };
  }
  const status = contact?.erased_at || contact?.is_subscribed === false ? "opted_out" : normalizeMarketingStatus(contact?.marketing_status);
  const decision = templateSendDecision({ marketing_status: status }, params.kind);
  if (decision.allowed) return null;
  return {
    status: 403,
    body: {
      error: decision.message,
      code: decision.reason === "opted_out" ? "opted_out" : "consent_required",
      templateKind: params.kind,
    },
  };
}
