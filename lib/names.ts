// Nombres de contacto: reglas puras compartidas por plantillas, difusiones y
// respuestas guardadas.

/**
 * Primer nombre del contacto, solo si parece un nombre (no un teléfono, un
 * correo ni un usuario con números). "" si no.
 */
export function firstName(contactName: string | null | undefined): string {
  const name = (contactName ?? "").trim();
  if (!name || name.includes("@") || /\d/.test(name)) return "";
  const first = name.split(/\s+/)[0] ?? "";
  const letters = first.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return "";
  return first;
}
