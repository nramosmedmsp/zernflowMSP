// Normalización de teléfonos de la importación (pura). Salida: "+<dígitos>".

export type ImportPhoneResult = { ok: true; value: string | null } | { ok: false; error: string };

export const DEFAULT_COUNTRY_CODE = "51";

/**
 * - Vacío: sin teléfono.
 * - 9 dígitos que empiezan en 9: celular de Perú, se le pone +51.
 * - Con "+" o "00" al inicio: ya trae código de país (8 a 15 dígitos).
 * - 11 a 15 dígitos sin "+": se entiende que ya trae el código de país.
 * - Cualquier otro caso es inválido.
 * Acepta espacios, guiones, puntos y paréntesis, y el ".0" final que deja Excel.
 */
export function normalizeImportPhone(input: string | null | undefined): ImportPhoneResult {
  const raw = (input ?? "").trim();
  if (raw === "") return { ok: true, value: null };
  if (/^\d+([.,]\d+)?[eE][+-]?\d+$/.test(raw)) {
    return { ok: false, error: "El teléfono está en notación científica (formato de Excel); dale formato de texto a la columna." };
  }
  if (!/^[+\d\s().\-]+$/.test(raw)) {
    return { ok: false, error: "El teléfono solo puede tener números, espacios, guiones y un + al inicio." };
  }
  const cleaned = raw.replace(/\.0+$/, "");
  const compact = cleaned.replace(/[\s().\-]/g, "");
  const plus = compact.startsWith("+");
  let digits = compact.replace(/\D/g, "");
  const zeros = !plus && digits.startsWith("00");
  if (zeros) digits = digits.slice(2);
  const explicit = plus || zeros;

  if (explicit) {
    if (digits.length < 8 || digits.length > 15) {
      return { ok: false, error: "El teléfono con código de país debe tener entre 8 y 15 dígitos." };
    }
    return { ok: true, value: `+${digits}` };
  }
  if (digits.length === 9 && digits.startsWith("9")) return { ok: true, value: `+${DEFAULT_COUNTRY_CODE}${digits}` };
  if (digits.length >= 11 && digits.length <= 15) return { ok: true, value: `+${digits}` };
  return {
    ok: false,
    error: "El teléfono no es válido: usa 9 dígitos que empiecen en 9 o agrega el código de país (+51...).",
  };
}

/** Solo dígitos (formato de `platform_sender_id` de WhatsApp en Zernio). */
export function senderIdFromPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}
