// Carga el catálogo que necesita `findBrokenNodes` (con lo archivado incluido).
// Sirve tanto con el cliente del servidor como con el del navegador: las
// políticas de la base limitan las filas al espacio activo.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { CatalogItem, FlowCatalog } from "./broken-nodes";

type Row = { id: string; name: string; archived_at: string | null };

function toRecord(rows: readonly Row[] | null): Record<string, CatalogItem> {
  const out: Record<string, CatalogItem> = {};
  for (const r of rows ?? []) out[r.id] = { name: r.name, archived: r.archived_at !== null };
  return out;
}

export async function loadFlowCatalog(supabase: SupabaseClient<Database>): Promise<FlowCatalog | null> {
  const [caseTypes, stages, teams, contactTypes] = await Promise.all([
    supabase.from("case_types").select("id, name, archived_at"),
    supabase.from("case_stages").select("id, name, archived_at"),
    supabase.from("teams").select("id, name, archived_at"),
    supabase.from("contact_types").select("id, name, archived_at"),
  ]);
  // Si algo falló no se puede juzgar: sin catálogo, todo parecería borrado.
  if (caseTypes.error || stages.error || teams.error || contactTypes.error) return null;
  return {
    caseTypes: toRecord(caseTypes.data),
    stages: toRecord(stages.data),
    teams: toRecord(teams.data),
    contactTypes: toRecord(contactTypes.data),
  };
}
