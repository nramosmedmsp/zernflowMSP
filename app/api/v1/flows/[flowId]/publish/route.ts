import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { publishFlowVersion, reviewFlowForPublish } from "@/lib/flow-publish";
import { hasErrors } from "@/lib/flow-engine/validate";

/**
 * POST /api/v1/flows/[flowId]/publish  { confirm?: boolean }
 *
 * Antes de publicar revisa el flujo guardado:
 * - con errores (sin disparador, mensajes vacíos, nodos incompletos): 422 y la
 *   lista; no se publica;
 * - solo con avisos (nodos sueltos, variables desconocidas, palabras clave que
 *   ya usa otro flujo publicado): 409 con la lista, hasta que se repita la
 *   llamada con `confirm: true`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  const { flowId } = await params;
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, user, workspaceId } = guard.ctx;

  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  const confirmed = body?.confirm === true;

  const { data: flow, error } = await supabase
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .eq("workspace_id", workspaceId)
    .single();

  if (error || !flow)
    return NextResponse.json(
      { error: error?.message || "No se encontró el flujo" },
      { status: 404 }
    );

  const issues = await reviewFlowForPublish(supabase, flow);
  if (hasErrors(issues)) {
    return NextResponse.json(
      { error: "El flujo tiene problemas que impiden publicarlo.", issues },
      { status: 422 }
    );
  }
  if (issues.length > 0 && !confirmed) {
    return NextResponse.json(
      { error: "Revisa los avisos antes de publicar.", needsConfirmation: true, issues },
      { status: 409 }
    );
  }

  const published = await publishFlowVersion(supabase, flow, user.id);
  if ("error" in published)
    return NextResponse.json({ error: published.error }, { status: 500 });

  return NextResponse.json({ ...flow, status: "published", version: published.version });
}
