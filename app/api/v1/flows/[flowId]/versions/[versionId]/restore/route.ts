import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { publishFlowVersion } from "@/lib/flow-publish";

/**
 * Restaurar una versión copia sus nodos, conexiones y vista al flujo SIN
 * cambiar su estado: un flujo publicado sigue publicado (y el bot usa la
 * versión restaurada de inmediato, que queda como una versión nueva del
 * historial); un borrador sigue siendo borrador. Antes lo pasaba a borrador y
 * el bot dejaba de responder sin avisar.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ flowId: string; versionId: string }> }
) {
  const { flowId, versionId } = await params;
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, user, workspaceId } = guard.ctx;

  const { data: flow } = await supabase
    .from("flows")
    .select("id, name, status, version")
    .eq("id", flowId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!flow) return NextResponse.json({ error: "No se encontró el flujo" }, { status: 404 });

  const { data: version, error: vErr } = await supabase
    .from("flow_versions")
    .select("nodes, edges, viewport")
    .eq("id", versionId)
    .eq("flow_id", flowId)
    .single();

  if (vErr || !version)
    return NextResponse.json({ error: "No se encontró la versión" }, { status: 404 });

  const { data: rows, error } = await supabase
    .from("flows")
    .update({
      nodes: version.nodes,
      edges: version.edges,
      viewport: version.viewport,
      updated_at: new Date().toISOString(),
    })
    .eq("id", flowId)
    .eq("workspace_id", workspaceId)
    .select("id");

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0)
    return NextResponse.json({ error: "No se pudo restaurar la versión." }, { status: 404 });

  if (flow.status !== "published") {
    return NextResponse.json({ ok: true, status: flow.status, version: flow.version });
  }

  const published = await publishFlowVersion(
    supabase,
    { id: flow.id, name: flow.name, version: flow.version, nodes: version.nodes, edges: version.edges, viewport: version.viewport },
    user.id,
  );
  if ("error" in published)
    return NextResponse.json({ error: published.error }, { status: 500 });

  return NextResponse.json({ ok: true, status: "published", version: published.version });
}
