import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { serverError } from "@/lib/server-error";

export async function GET() {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard.ctx;
  const membership = { workspace_id: guard.ctx.workspaceId };

  const { data: flows, error } = await supabase
    .from("flows")
    .select("id, name, description, status, version, published_at, created_at, updated_at")
    .eq("workspace_id", membership.workspace_id)
    .order("updated_at", { ascending: false });

  if (error) return serverError("flows/list", error, "No se pudieron cargar los flujos. Inténtalo de nuevo.");

  return NextResponse.json(flows);
}

export async function POST(request: NextRequest) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard.ctx;
  const membership = { workspace_id: guard.ctx.workspaceId };

  const body = await request.json();

  const { data: flow, error } = await supabase
    .from("flows")
    .insert({
      workspace_id: membership.workspace_id,
      name: body.name || "Untitled Flow",
      description: body.description || null,
      nodes: body.nodes || [],
      edges: body.edges || [],
    })
    .select("id, name, status")
    .single();

  if (error) return serverError("flows/create", error, "No se pudo crear el flujo. Inténtalo de nuevo.");

  return NextResponse.json(flow, { status: 201 });
}
