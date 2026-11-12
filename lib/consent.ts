// Consentimiento de publicidad de un contacto (PRIV-01). Puro: lo usan las
// acciones del servidor, las difusiones, las secuencias, el envío de plantillas
// y las pantallas. No depende de React ni de la base.
//
// Estados (columna contacts.marketing_status):
//   unknown    "Sin registrar": nadie anotó que aceptó. Se le atiende, pero no se le envía publicidad.
//   accepted   "Aceptó": hay constancia (fecha, origen y quién la anotó).
//   opted_out  "De baja": pidió no recibir publicidad (o se borraron sus datos).
//
// Convivencia con contacts.is_subscribed (la mantiene un trigger en la base,
// migración 00044): is_subscribed = (marketing_status <> 'opted_out'). El código
// que solo mira is_subscribed sigue funcionando; la publicidad nueva exige
// además marketing_status = 'accepted'.

import type { TemplateKind } from "@/lib/template-category";

export type MarketingStatus = "unknown" | "accepted" | "opted_out";
export type MarketingSource = "manual" | "keyword" | "import" | "flow" | "legacy" | "erased";

export const MARKETING_STATUSES: readonly MarketingStatus[] = ["unknown", "accepted", "opted_out"];

/** Lo que guarda el contacto sobre su consentimiento (columnas marketing_* de contacts). */
export interface ConsentFields {
  marketing_status?: string | null;
  marketing_status_at?: string | null;
  marketing_source?: string | null;
  marketing_set_by?: string | null;
  marketing_note?: string | null;
}

export const NOTE_MAX = 500;
/** Texto de la declaración al importar; se guarda en la nota para saber qué se afirmó. */
export const IMPORT_DECLARATION_VERSION = "importación v1";

/** Estado válido o "unknown" (lo más prudente) si el dato falta o está dañado. */
export function normalizeMarketingStatus(raw: unknown): MarketingStatus {
  return typeof raw === "string" && (MARKETING_STATUSES as readonly string[]).includes(raw)
    ? (raw as MarketingStatus)
    : "unknown";
}

export const MARKETING_STATUS_LABELS: Record<MarketingStatus, string> = {
  unknown: "Sin registrar",
  accepted: "Aceptó publicidad",
  opted_out: "De baja de publicidad",
};

export function marketingStatusLabel(raw: unknown): string {
  return MARKETING_STATUS_LABELS[normalizeMarketingStatus(raw)];
}

const SOURCE_LABELS: Record<MarketingSource, string> = {
  manual: "anotado por un asesor",
  keyword: "palabra clave del cliente",
  import: "importación de contactos",
  flow: "flujo automático",
  legacy: "baja anterior al registro de consentimiento",
  erased: "datos eliminados",
};

export function marketingSourceLabel(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  return SOURCE_LABELS[raw as MarketingSource] ?? raw;
}

// ── Acciones de un asesor ──────────────────────────────────────────────────

export type ConsentAction = "accept" | "opt_out" | "reactivate";

/** Qué botones se ofrecen según el estado actual. */
export function availableConsentActions(status: unknown): ConsentAction[] {
  switch (normalizeMarketingStatus(status)) {
    case "unknown":
      return ["accept", "opt_out"];
    case "accepted":
      return ["opt_out"];
    case "opted_out":
      return ["reactivate"];
  }
}

export const CONSENT_ACTION_LABELS: Record<ConsentAction, string> = {
  accept: "Registrar consentimiento",
  opt_out: "Dar de baja de publicidad",
  reactivate: "Reactivar",
};

const TARGET: Record<ConsentAction, MarketingStatus> = {
  accept: "accepted",
  opt_out: "opted_out",
  reactivate: "accepted",
};

export type ConsentNoteResult = { ok: true; note: string | null } | { ok: false; error: string };

/** Reactivar a quien se dio de baja exige anotar la evidencia (qué dijo el cliente y cuándo). */
export function validateConsentNote(action: ConsentAction, raw: unknown): ConsentNoteResult {
  const note = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (note.length > NOTE_MAX) return { ok: false, error: `La nota puede tener hasta ${NOTE_MAX} caracteres.` };
  if (action === "reactivate" && note.length < 5) {
    return {
      ok: false,
      error: "Para reactivar a alguien que se dio de baja, anota cómo y cuándo volvió a aceptar (al menos unas palabras).",
    };
  }
  return { ok: true, note: note || null };
}

export interface ConsentChange {
  /** Columnas de contacts que cambian. */
  patch: {
    marketing_status: MarketingStatus;
    marketing_status_at: string;
    marketing_source: MarketingSource;
    marketing_set_by: string | null;
    marketing_note: string | null;
    is_subscribed: boolean;
  };
  /** Fila de historial (activity). */
  activity: { type: "contact_subscribed" | "contact_unsubscribed"; from: MarketingStatus; to: MarketingStatus };
}

/**
 * Cambio de consentimiento que se guarda en el contacto. `by` es quien lo anota
 * (null = el propio cliente por palabra clave o el sistema).
 */
export function buildConsentChange(input: {
  from: unknown;
  action: ConsentAction;
  source: MarketingSource;
  by: string | null;
  note: string | null;
  at: string;
}): ConsentChange {
  const to = TARGET[input.action];
  const from = normalizeMarketingStatus(input.from);
  return {
    patch: {
      marketing_status: to,
      marketing_status_at: input.at,
      marketing_source: input.source,
      marketing_set_by: input.by,
      marketing_note: input.note,
      is_subscribed: to !== "opted_out",
    },
    activity: { type: to === "opted_out" ? "contact_unsubscribed" : "contact_subscribed", from, to },
  };
}

// ── ¿Se le puede enviar publicidad? ────────────────────────────────────────

export type MarketingBlock = "unknown" | "opted_out";

export type MarketingDecision = { ok: true } | { ok: false; reason: MarketingBlock; message: string };

export const OPTED_OUT_MESSAGE =
  "Este cliente se dio de baja de la publicidad. Solo puedes enviarle plantillas de servicio (pedido, pago, entrega).";
export const NO_CONSENT_MESSAGE =
  "Este cliente aún no aceptó recibir publicidad. Registra su consentimiento en el panel del contacto o usa una plantilla de servicio.";

/**
 * Estado de publicidad que cuenta para enviar: un contacto con datos borrados
 * o dado de baja (is_subscribed = false) es "De baja" aunque marketing_status
 * diga otra cosa. Lo usan el servidor y las pantallas.
 */
export function effectiveMarketingStatus(
  contact: (ConsentFields & { is_subscribed?: boolean | null; erased_at?: string | null }) | null | undefined,
): MarketingStatus {
  if (contact?.erased_at || contact?.is_subscribed === false) return "opted_out";
  return normalizeMarketingStatus(contact?.marketing_status);
}

/** Publicidad (difusiones, secuencias, plantillas de publicidad): solo a quien aceptó. */
export function marketingDecision(contact: ConsentFields | null | undefined): MarketingDecision {
  const status = normalizeMarketingStatus(contact?.marketing_status);
  if (status === "accepted") return { ok: true };
  if (status === "opted_out") return { ok: false, reason: "opted_out", message: OPTED_OUT_MESSAGE };
  return { ok: false, reason: "unknown", message: NO_CONSENT_MESSAGE };
}

export const UNKNOWN_CATEGORY_NOTICE =
  "No pudimos saber si esta plantilla es de servicio o de publicidad, así que la tratamos como publicidad (lo más seguro). ";

export type TemplateDecision =
  | { allowed: true }
  | { allowed: false; reason: MarketingBlock; kind: TemplateKind; message: string };

/**
 * Decisión 2 del dueño: una plantilla de servicio se puede enviar a cualquiera
 * (también a quien se dio de baja); una de publicidad, o de categoría
 * desconocida, solo a quien aceptó publicidad.
 */
export function templateSendDecision(contact: ConsentFields | null | undefined, kind: TemplateKind): TemplateDecision {
  if (kind === "service") return { allowed: true };
  const decision = marketingDecision(contact);
  if (decision.ok) return { allowed: true };
  return {
    allowed: false,
    reason: decision.reason,
    kind,
    message: (kind === "unknown" ? UNKNOWN_CATEGORY_NOTICE : "") + decision.message,
  };
}
