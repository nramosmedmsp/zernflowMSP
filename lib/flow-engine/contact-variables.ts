// Variables del contacto para los flujos: {{nombre}}, {{fecha_clave}} y
// {{empresa}}, los mismos nombres que usan las respuestas guardadas y las
// difusiones (con una sola llave). Se cargan al empezar o retomar un flujo.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { formatKeyDate } from "@/lib/cases/auto-template-params";
import { suggestFirstParam } from "@/lib/whatsapp-templates";
import type { FlowExecutionContext } from "./types";

/** Variables que el motor llena con los datos del contacto (se ofrecen en el editor). */
export const CONTACT_FLOW_VARIABLES = ["nombre", "fecha_clave", "empresa"] as const;

export function contactVariableValues(
  contact: { display_name: string | null; key_date: string | null } | null,
  workspaceName: string | null | undefined,
): Record<(typeof CONTACT_FLOW_VARIABLES)[number], string> {
  return {
    // Primer nombre si parece de persona; un teléfono o correo no se usa como saludo.
    nombre: suggestFirstParam(contact?.display_name) ?? "",
    fecha_clave: formatKeyDate(contact?.key_date),
    empresa: workspaceName?.trim() ?? "",
  };
}

/**
 * Agrega al contexto las variables del contacto que el flujo todavía no
 * definió (una solicitud HTTP o un nodo puede haber guardado la suya).
 */
export async function seedContactVariables(
  db: SupabaseClient<Database>,
  context: FlowExecutionContext,
): Promise<void> {
  context.variables ??= {};
  if (CONTACT_FLOW_VARIABLES.every((name) => context.variables![name] !== undefined)) return;
  try {
    const [{ data: contact }, { data: workspace }] = await Promise.all([
      db.from("contacts").select("display_name, key_date").eq("id", context.contactId).maybeSingle(),
      db.from("workspaces").select("name").eq("id", context.workspaceId).maybeSingle(),
    ]);
    const values = contactVariableValues(contact ?? null, workspace?.name);
    for (const name of CONTACT_FLOW_VARIABLES) context.variables[name] ??= values[name];
  } catch (err) {
    // Sin los datos del contacto el flujo sigue: las variables salen vacías.
    console.error("[flows] no se pudieron cargar las variables del contacto:", err);
  }
}
