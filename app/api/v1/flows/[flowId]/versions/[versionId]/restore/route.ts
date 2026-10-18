import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ flowId: string; versionId: string }> }
) {
  const { flowId, versionId } = await params;
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard.ctx;
  const membership = { workspace_id: guard.ctx.workspaceId };

  // Get the version
  const { data: version, error: vErr } = await supabase
    .from("flow_versions")
    .select("nodes, edges, viewport")
    .eq("id", versionId)
    .eq("flow_id", flowId)
    .single();

  if (vErr || !version)
    return NextResponse.json({ error: "No se encontró la versión" }, { status: 404 });

  // Restore: copy nodes/edges/viewport back, set status to draft
  const { error } = await supabase
    .from("flows")
    .update({
      nodes: version.nodes,
      edges: version.edges,
      viewport: version.viewport,
      status: "draft",
      updated_at: new Date().toISOString(),
    })
    .eq("id", flowId)
    .eq("workspace_id", membership.workspace_id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
