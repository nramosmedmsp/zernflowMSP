// Reglas puras de la ficha de contacto: teléfono, origen y textos. Sin E/S,
// para usarlas en el cliente y en las acciones del servidor y probarlas con
// vitest.

export const MAX_PHONE_LENGTH = 30;
export const DEFAULT_KEY_DATE_LABEL = "Fecha clave";

export type PhoneResult = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Valida y limpia un teléfono: opcional "+", dígitos, espacios, guiones,
 * puntos y paréntesis; entre 6 y 15 dígitos. Vacío = quitar el teléfono.
 */
export function normalizePhone(input: unknown): PhoneResult {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, error: "El teléfono no es válido." };
  const text = input.trim().replace(/\s+/g, " ");
  if (text === "") return { ok: true, value: null };
  if (text.length > MAX_PHONE_LENGTH || !/^\+?[0-9 ()\-.]+$/.test(text)) {
    return { ok: false, error: "El teléfono solo puede tener números, espacios, guiones y un + al inicio." };
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) {
    return { ok: false, error: "El teléfono debe tener entre 6 y 15 dígitos." };
  }
  return { ok: true, value: text };
}

const SOURCE_KEY_LABELS: Record<string, string> = {
  channel: "Canal",
  platform: "Plataforma",
  campaign: "Campaña",
  utm_source: "Fuente",
  utm_medium: "Medio",
  utm_campaign: "Campaña",
  ad: "Anuncio",
  referral: "Referido por",
  label: "Origen",
  note: "Nota",
  import: "Importación",
};

/** "Canal: whatsapp · Campaña: Verano" a partir de `contacts.source`; "" si está vacío. */
export function describeSource(source: unknown): string {
  if (typeof source === "string") return source.trim();
  if (!source || typeof source !== "object" || Array.isArray(source)) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    const text = String(value).trim();
    if (!text) continue;
    parts.push(`${SOURCE_KEY_LABELS[key] ?? key.replace(/_/g, " ")}: ${text}`);
  }
  return parts.join(" · ");
}

/** Etiqueta de la fecha clave según `workspaces.settings.key_date_label`. */
export function keyDateLabel(settings: unknown): string {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const label = (settings as Record<string, unknown>).key_date_label;
    if (typeof label === "string" && label.trim() !== "") return label.trim();
  }
  return DEFAULT_KEY_DATE_LABEL;
}

export function contactInitial(name: string | null | undefined): string {
  return name?.trim()?.[0]?.toUpperCase() ?? "?";
}
