// Instalación de una plantilla de flujo en un espacio (solo el servidor).
// Lee tipos de gestión, etapas y equipos del espacio, resuelve los nombres de
// la plantilla a ids y guarda el flujo como BORRADOR: nunca lo publica (los
// disparadores se crean al publicar desde el editor).

import type { Db } from "@/lib/cases/io";
import type { Json } from "@/lib/types/database";
import { resolveFlowTemplate } from "./resolve";
import type { CatalogCategory, CatalogStage, FlowTemplate, FlowTemplateNotice, TemplateCatalog } from "./types";

export interface InstalledFlowTemplate {
  flowId: string;
  name: string;
  notices: FlowTemplateNotice[];
  adjust: string[];
}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`No se pudo leer ${what}: ${result.error.message}`);
  return result.data ?? ([] as unknown as T);
}

/** Tipos de gestión (con etapas), equipos y tipos de contacto activos del espacio. */
export async function loadTemplateCatalog(db: Db, workspaceId: string): Promise<TemplateCatalog> {
  const [caseTypes, teams, contactTypes] = await Promise.all([
    db.from("case_types").select("id, name").eq("workspace_id", workspaceId).is("archived_at", null),
    db.from("teams").select("id, name").eq("workspace_id", workspaceId).is("archived_at", null),
    db.from("contact_types").select("id, name").eq("workspace_id", workspaceId).is("archived_at", null),
  ]);
  const types = must(caseTypes, "los tipos de gestión");
  const stageRows = types.length
    ? must(
        await db
          .from("case_stages")
          .select("id, case_type_id, name, kind")
          .in("case_type_id", types.map((t) => t.id))
          .is("archived_at", null)
          .order("position", { ascending: true }),
        "las etapas",
      )
    : [];
  const categoryRows = types.length
    ? must(
        await db
          .from("case_categories")
          .select("id, case_type_id, name")
          .in("case_type_id", types.map((t) => t.id))
          .is("archived_at", null)
          .order("position", { ascending: true }),
        "las categorías",
      )
    : [];
  const categoriesByType = new Map<string, CatalogCategory[]>();
  for (const c of categoryRows) {
    const list = categoriesByType.get(c.case_type_id) ?? [];
    list.push({ id: c.id, name: c.name });
    categoriesByType.set(c.case_type_id, list);
  }
  const stagesByType = new Map<string, CatalogStage[]>();
  for (const s of stageRows) {
    const list = stagesByType.get(s.case_type_id) ?? [];
    list.push({ id: s.id, name: s.name, kind: s.kind });
    stagesByType.set(s.case_type_id, list);
  }
  return {
    caseTypes: types.map((t) => ({
      id: t.id,
      name: t.name,
      stages: stagesByType.get(t.id) ?? [],
      categories: categoriesByType.get(t.id) ?? [],
    })),
    teams: must(teams, "los equipos"),
    contactTypes: must(contactTypes, "los tipos de contacto"),
  };
}

/** Crea los campos personalizados que la plantilla usa y que no existen; devuelve los nombres creados. */
async function ensureCustomFields(db: Db, workspaceId: string, template: FlowTemplate): Promise<string[]> {
  const wanted = template.customFields ?? [];
  if (wanted.length === 0) return [];
  const existing = must(
    await db.from("custom_field_definitions").select("slug").eq("workspace_id", workspaceId),
    "los campos personalizados",
  );
  const have = new Set(existing.map((f) => f.slug));
  const missing = wanted.filter((f) => !have.has(f.slug));
  if (missing.length === 0) return [];
  const { error } = await db
    .from("custom_field_definitions")
    .insert(missing.map((f) => ({ workspace_id: workspaceId, name: f.name, slug: f.slug, type: "text" })));
  if (error) throw new Error(`No se pudieron crear los campos personalizados: ${error.message}`);
  return missing.map((f) => f.name);
}

/** Instala la plantilla como flujo borrador del espacio. Quien llama valida que sea administrador. */
export async function installFlowTemplate(
  db: Db,
  workspaceId: string,
  template: FlowTemplate,
): Promise<InstalledFlowTemplate> {
  const catalog = await loadTemplateCatalog(db, workspaceId);
  const resolved = resolveFlowTemplate(template, catalog);
  const notices = [...resolved.notices];

  const created = await ensureCustomFields(db, workspaceId, template);
  if (created.length > 0) {
    notices.push({
      level: "info",
      message: `Se crearon los campos personalizados que usa el flujo: ${created.join(", ")}.`,
    });
  }

  const { data: flow, error } = await db
    .from("flows")
    .insert({
      workspace_id: workspaceId,
      name: template.name,
      description: template.description,
      status: "draft",
      nodes: resolved.nodes as unknown as Json,
      edges: resolved.edges as unknown as Json,
    })
    .select("id")
    .single();
  if (error || !flow) throw new Error(`No se pudo crear el flujo: ${error?.message ?? "sin respuesta"}`);

  return { flowId: flow.id, name: template.name, notices, adjust: template.adjust };
}
