// Confirmación escrita para borrar los datos de un cliente. Puro: lo usan la
// pantalla (para habilitar el botón) y la acción del servidor (que vuelve a
// comprobarlo, porque el navegador no es de fiar).

/** Palabra que hay que teclear: el nombre del cliente o, si no tiene nombre útil, "ELIMINAR". */
export function erasureConfirmationWord(displayName: string | null | undefined): string {
  const name = (displayName ?? "").trim().replace(/\s+/g, " ");
  return name.length >= 2 ? name : "ELIMINAR";
}

function normalizeTyped(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** ¿Lo que se tecleó coincide con la palabra de confirmación? (sin mayúsculas ni tildes) */
export function erasureConfirmationMatches(typed: unknown, displayName: string | null | undefined): boolean {
  if (typeof typed !== "string") return false;
  return normalizeTyped(typed) === normalizeTyped(erasureConfirmationWord(displayName));
}
