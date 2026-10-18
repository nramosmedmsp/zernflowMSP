import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  const { flowId } = await params;
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, workspaceId } = guard.ctx;

  // El flujo tiene que ser del espacio activo.
  const { data: flow } = await supabase
    .from("flows")
    .select("id")
    .eq("id", flowId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!flow)
    return NextResponse.json({ error: "No se encontró el flujo" }, { status: 404 });

  const { data: versions, error } = await supabase
    .from("flow_versions")
    .select("id, version, name, published_by, created_at")
    .eq("flow_id", flowId)
    .order("version", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(versions || []);
}
