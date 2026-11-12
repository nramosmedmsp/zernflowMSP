// Tipo de una plantilla de WhatsApp (servicio o publicidad), sin servidor ni
// React: lo usan el servidor (lib/template-category.ts) y las pantallas.
// Las palabras que lee la persona son siempre "Publicidad" y "Servicio"; los
// valores técnicos (MARKETING, UTILITY, AUTHENTICATION) no se tocan.

import { effectiveMarketingStatus, templateSendDecision, type ConsentFields } from "@/lib/consent";

export type TemplateKind = "service" | "marketing" | "unknown";

/** "service" (UTILITY, AUTHENTICATION), "marketing" (MARKETING) o "unknown" (cualquier otra cosa). */
export function templateKindFromCategory(category: unknown): TemplateKind {
  const value = typeof category === "string" ? category.trim().toUpperCase() : "";
  if (value === "UTILITY" || value === "AUTHENTICATION") return "service";
  if (value === "MARKETING") return "marketing";
  return "unknown";
}

/** Una plantilla cuenta como publicidad salvo que se sepa que es de servicio. */
export function isPublicityKind(kind: TemplateKind): boolean {
  return kind !== "service";
}

/** Etiqueta única para toda la interfaz. */
export const TEMPLATE_KIND_LABELS = { service: "Servicio", publicity: "Publicidad" } as const;

export function templateKindLabel(kind: TemplateKind): string {
  return isPublicityKind(kind) ? TEMPLATE_KIND_LABELS.publicity : TEMPLATE_KIND_LABELS.service;
}

export interface TemplateGateView {
  label: string;
  /** La plantilla es de publicidad (o de categoría desconocida). */
  publicity: boolean;
  /** true si el cliente no puede recibirla: candado y envío deshabilitado. */
  locked: boolean;
  /** Por qué está bloqueada (misma frase que da el servidor); null si se puede enviar. */
  message: string | null;
  reason: "unknown" | "opted_out" | null;
}

/** Cómo se ve una plantilla para un contacto, con la misma decisión que usa el servidor. */
export function templateGateView(
  contact: (ConsentFields & { is_subscribed?: boolean | null; erased_at?: string | null }) | null | undefined,
  category: unknown,
): TemplateGateView {
  const kind = templateKindFromCategory(category);
  const status = effectiveMarketingStatus(contact);
  const decision = templateSendDecision({ marketing_status: status }, kind);
  return {
    label: templateKindLabel(kind),
    publicity: isPublicityKind(kind),
    locked: !decision.allowed,
    message: decision.allowed ? null : decision.message,
    reason: decision.allowed ? null : decision.reason,
  };
}
