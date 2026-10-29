// Publicar y restaurar flujos: revisión previa, versión, y sincronía de los
// disparadores con lo que el bot lee (tabla `triggers`). Lo comparten la ruta
// de publicar y la de restaurar una versión.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { BUILDER_TRIGGER_TYPES, buildDesiredTriggers } from "@/lib/flow-triggers";
import {
  findKeywordCollisions,
  triggerKeywords,
  validateFlowGraph,
  type FlowEdgeLike,
  type FlowIssue,
  type FlowNodeLike,
  type OtherFlowKeywords,
} from "@/lib/flow-engine/validate";

type Db = SupabaseClient<Database>;

const KEYWORD_TRIGGER_TYPES = ["keyword", "comment_keyword"] as const;

function asNodes(value: unknown): FlowNodeLike[] {
  return Array.isArray(value) ? (value as FlowNodeLike[]) : [];
}

function asEdges(value: unknown): FlowEdgeLike[] {
  return Array.isArray(value) ? (value as FlowEdgeLike[]) : [];
}

/**
 * Deja la tabla `triggers` igual a lo que dice el lienzo: borra las filas
 * del constructor (sin canal) y vuelve a crearlas. Las de Crecimiento (con
 * canal) no se tocan.
 */
export async function syncFlowTriggers(db: Db, flowId: string, nodes: unknown): Promise<void> {
  const desired = buildDesiredTriggers(asNodes(nodes) as unknown as Array<Record<string, unknown>>, flowId);

  await db
    .from("triggers")
    .delete()
    .eq("flow_id", flowId)
    .is("channel_id", null)
    .in("type", [...BUILDER_TRIGGER_TYPES]);

  if (desired.length > 0) {
    const { error } = await db.from("triggers").insert(desired);
    if (error) console.error("[publish] Failed to sync triggers from flow nodes:", error);
  }

  await db.from("triggers").update({ is_active: true }).eq("flow_id", flowId);
}

/** Palabras clave de los demás flujos publicados del espacio, por tipo de disparador. */
async function otherPublishedKeywords(
  db: Db,
  workspaceId: string,
  flowId: string,
): Promise<Record<(typeof KEYWORD_TRIGGER_TYPES)[number], OtherFlowKeywords[]>> {
  const result = { keyword: [] as OtherFlowKeywords[], comment_keyword: [] as OtherFlowKeywords[] };
  const { data: flows } = await db
    .from("flows")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .neq("id", flowId);
  if (!flows || flows.length === 0) return result;

  const { data: rows } = await db
    .from("triggers")
    .select("flow_id, type, config, is_active")
    .in("flow_id", flows.map((f) => f.id))
    .in("type", [...KEYWORD_TRIGGER_TYPES]);

  const nameOf = new Map(flows.map((f) => [f.id, f.name]));
  for (const row of rows ?? []) {
    if (row.is_active === false) continue;
    const type = row.type as (typeof KEYWORD_TRIGGER_TYPES)[number];
    const keywords = triggerKeywords({ config: row.config, keywords: (row.config as { keywords?: unknown } | null)?.keywords });
    if (keywords.length === 0) continue;
    result[type].push({ flowId: row.flow_id, flowName: nameOf.get(row.flow_id) ?? "otro flujo", keywords });
  }
  return result;
}

/** Palabras clave propias, por tipo de disparador, según el lienzo. */
function ownKeywordsByType(nodes: FlowNodeLike[]): Record<(typeof KEYWORD_TRIGGER_TYPES)[number], string[]> {
  const out = { keyword: [] as string[], comment_keyword: [] as string[] };
  for (const n of nodes) {
    if (n.type !== "trigger") continue;
    const type = ((n.data as { triggerType?: string } | undefined)?.triggerType ?? "keyword") as string;
    if (type === "keyword" || type === "comment_keyword") out[type].push(...triggerKeywords(n.data));
  }
  return out;
}

/** Errores y avisos de publicar este flujo tal como está guardado. */
export async function reviewFlowForPublish(
  db: Db,
  flow: { id: string; workspace_id: string; nodes: unknown; edges: unknown },
): Promise<FlowIssue[]> {
  const nodes = asNodes(flow.nodes);
  const issues = validateFlowGraph(nodes, asEdges(flow.edges), { flowId: flow.id });

  const own = ownKeywordsByType(nodes);
  if (own.keyword.length > 0 || own.comment_keyword.length > 0) {
    const others = await otherPublishedKeywords(db, flow.workspace_id, flow.id);
    for (const type of KEYWORD_TRIGGER_TYPES) {
      issues.push(...findKeywordCollisions(own[type], others[type]));
    }
  }
  return issues;
}

/**
 * Crea la versión siguiente con el contenido actual del flujo, lo marca como
 * publicado y sincroniza sus disparadores. Devuelve el número de versión.
 */
export async function publishFlowVersion(
  db: Db,
  flow: {
    id: string;
    version: number;
    name: string;
    nodes: Json;
    edges: Json;
    viewport: Json | null;
  },
  userId: string,
): Promise<{ version: number } | { error: string }> {
  // La primera publicación es la v1 (el flujo nuevo ya trae version = 1 sin versiones guardadas).
  const { count: saved } = await db.from("flow_versions").select("id", { count: "exact", head: true }).eq("flow_id", flow.id);
  const version = (saved ?? 0) === 0 && flow.version <= 1 ? 1 : flow.version + 1;
  const { error: updateError } = await db
    .from("flows")
    .update({ status: "published", published_at: new Date().toISOString(), version })
    .eq("id", flow.id);
  if (updateError) return { error: updateError.message };

  await db.from("flow_versions").insert({
    flow_id: flow.id,
    version,
    nodes: flow.nodes,
    edges: flow.edges,
    viewport: flow.viewport,
    name: flow.name,
    published_by: userId,
  });

  await syncFlowTriggers(db, flow.id, flow.nodes);
  return { version };
}
