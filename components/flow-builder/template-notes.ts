// Avisos de una plantilla recién instalada: la pantalla de plantillas los guarda
// en la sesión del navegador y el editor del flujo los muestra una vez.

export interface TemplateNotes {
  templateName: string;
  warnings: Array<{ level: "warning" | "info"; nodeLabel?: string; message: string }>;
  adjust: string[];
}

const KEY_PREFIX = "flow-template-notes:";

export function saveTemplateNotes(flowId: string, notes: TemplateNotes): void {
  try {
    window.sessionStorage.setItem(KEY_PREFIX + flowId, JSON.stringify(notes));
  } catch {
    // Sin almacenamiento disponible: el flujo se abre igual, sin avisos.
  }
}

export function readTemplateNotes(flowId: string): TemplateNotes | null {
  try {
    const raw = window.sessionStorage.getItem(KEY_PREFIX + flowId);
    return raw ? (JSON.parse(raw) as TemplateNotes) : null;
  } catch {
    return null;
  }
}

export function clearTemplateNotes(flowId: string): void {
  try {
    window.sessionStorage.removeItem(KEY_PREFIX + flowId);
  } catch {
    // Nada que limpiar.
  }
}
