/** Nombre de archivo al exportar un flujo: sin tildes ni símbolos ("Catálogo y precios" -> "catalogo-y-precios.flow.json"). */
export function flowFileName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "flujo"}.flow.json`;
}
