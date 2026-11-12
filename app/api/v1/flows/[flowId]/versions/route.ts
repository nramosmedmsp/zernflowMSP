import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { serverError } from "@/lib/server-error";

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

  if (error) return serverError("flows/versions", error, "No se pudo cargar el historial del flujo. Inténtalo de nuevo.");

  return NextResponse.json(versions || []);
}
