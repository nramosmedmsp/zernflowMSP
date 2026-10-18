// Plantilla CSV descargable de la importación.

import { toCsv } from "./csv";

export const TEMPLATE_FILE_NAME = "plantilla-contactos.csv";

export function buildTemplateCsv(customSlugs: string[] = []): string {
  const header = ["nombre", "telefono", "correo", "tipo", "sede", "responsable", "fecha_clave", "etiquetas", ...customSlugs];
  const extra = customSlugs.map(() => "");
  return toCsv([
    header,
    ["Ana Torres", "987654321", "ana@ejemplo.com", "Socio", "Sede Centro", "asesor@tuempresa.com", "15/03/2026", "Verano|Referido", ...extra],
    ["Luis Pérez", "+57 300 123 4567", "", "Prospecto", "", "", "2026-04-02", "", ...extra],
  ]);
}
