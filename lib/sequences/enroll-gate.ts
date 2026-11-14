// Quién y qué se puede inscribir a mano en una secuencia. Puro (sin servidor ni
// React): lo usan la acción enrollContact (que decide de verdad) y los diálogos
// «Inscribir contacto» / «Inscribir en secuencia» (que solo muestran la misma
// decisión con su motivo). El permiso de publicidad sale de marketingDecision.

import { marketingDecision, normalizeMarketingStatus, type MarketingStatus } from "@/lib/consent";
import { ERASED_READONLY_MESSAGE, isContactErased } from "@/lib/contact-erased";

export const SEQUENCE_NOT_ACTIVE_MESSAGE = "Activa la secuencia para inscribir contactos";
export const SEQUENCE_NO_STEPS_MESSAGE = "Agrega pasos a la secuencia para inscribir contactos";
export const ENROLL_NO_CONSENT_MESSAGE =
  "Este contacto aún no aceptó recibir publicidad. Registra su consentimiento en su ficha antes de inscribirlo en la secuencia.";
export const ENROLL_OPTED_OUT_MESSAGE = "Este contacto se dio de baja de la publicidad y no puede recibir la secuencia.";
export const ENROLL_NO_CHANNEL_MESSAGE = "Este contacto no tiene ningún canal para enviarle la secuencia.";
export const ENROLL_ERASED_MESSAGE = ERASED_READONLY_MESSAGE;
export const ENROLL_CHANNEL_NOT_CONTACT_MESSAGE = "Ese canal no pertenece a este contacto.";

export type SequenceEnrollGate = { ok: true } | { ok: false; reason: "not_active" | "no_steps"; message: string };

/** La secuencia debe estar activa y tener pasos. */
export function sequenceEnrollGate(seq: { status: string | null | undefined; stepCount: number }): SequenceEnrollGate {
  if (seq.status !== "active") return { ok: false, reason: "not_active", message: SEQUENCE_NOT_ACTIVE_MESSAGE };
  if (seq.stepCount <= 0) return { ok: false, reason: "no_steps", message: SEQUENCE_NO_STEPS_MESSAGE };
  return { ok: true };
}

export type ContactEnrollBlock = "erased" | "opted_out" | "unknown" | "no_channel";
export type ContactEnrollGate = { ok: true } | { ok: false; reason: ContactEnrollBlock; message: string };

export interface EnrollableContact {
  marketing_status?: string | null;
  is_subscribed?: boolean | null;
  erased_at?: string | null;
}

/**
 * ¿Se puede inscribir a este contacto? Solo quien aceptó publicidad ("Aceptó");
 * un cliente eliminado o de baja no. `channelCount` (si se conoce) también exige
 * al menos un canal donde enviarle.
 */
export function contactEnrollGate(
  contact: EnrollableContact | null | undefined,
  opts: { channelCount?: number } = {},
): ContactEnrollGate {
  if (isContactErased(contact)) return { ok: false, reason: "erased", message: ENROLL_ERASED_MESSAGE };
  if (contact?.is_subscribed === false) return { ok: false, reason: "opted_out", message: ENROLL_OPTED_OUT_MESSAGE };
  const consent = marketingDecision(contact);
  if (!consent.ok) {
    return consent.reason === "opted_out"
      ? { ok: false, reason: "opted_out", message: ENROLL_OPTED_OUT_MESSAGE }
      : { ok: false, reason: "unknown", message: ENROLL_NO_CONSENT_MESSAGE };
  }
  if (opts.channelCount !== undefined && opts.channelCount <= 0) {
    return { ok: false, reason: "no_channel", message: ENROLL_NO_CHANNEL_MESSAGE };
  }
  return { ok: true };
}

/** Estado de publicidad para mostrar como chip (un cliente eliminado se trata como de baja en el chip). */
export function enrollConsentStatus(contact: EnrollableContact | null | undefined): MarketingStatus {
  if (contact?.is_subscribed === false) return "opted_out";
  return normalizeMarketingStatus(contact?.marketing_status);
}

/** Si el contacto tiene un solo canal, ese es el elegido; si no, ninguno hasta que la persona elija. */
export function defaultChannelId(channels: readonly { id: string }[]): string {
  return channels.length === 1 ? channels[0].id : "";
}
