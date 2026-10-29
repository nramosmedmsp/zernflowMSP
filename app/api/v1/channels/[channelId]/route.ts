import { NextRequest, NextResponse } from "next/server";
import { createZernioClient } from "@/lib/zernio-client";
import { requireApiAdmin } from "@/lib/api-auth";
import { getLateApiKey } from "@/lib/workspace-secrets";
import { isDemoChannel } from "@/lib/demo";

/**
 * DELETE /api/v1/channels/[channelId]
 *
 * Permanently deletes a channel: disconnects the account on Zernio first
 * (otherwise /api/v1/channels/sync would re-create it from listAccounts),
 * then deletes the local row (cascades conversations, contact links, etc.).
 * Solo Dueño o Administrador.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { channelId } = await params;
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard.ctx;
  const workspace = { id: guard.ctx.workspaceId };

  const { data: channel } = await supabase
    .from("channels")
    .select("id, late_account_id")
    .eq("id", channelId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!channel)
    return NextResponse.json({ error: "No se encontró el canal" }, { status: 404 });

  // Un canal de prueba (lib/demo.ts) no existe en Zernio: solo se borra la fila local.
  const lateApiKey = isDemoChannel(channel) ? null : await getLateApiKey(workspace.id);
  if (lateApiKey) {
    const zernio = createZernioClient(lateApiKey);
    try {
      const res = await zernio.accounts.deleteAccount({
        path: { accountId: channel.late_account_id },
      });
      // A 404 means the account is already gone from Zernio; that's fine.
      if (res.error && res.response?.status !== 404) {
        return NextResponse.json(
          { error: `No se pudo desconectar en Zernio: ${JSON.stringify(res.error)}` },
          { status: 502 }
        );
      }
    } catch (error) {
      console.error("Failed to disconnect Zernio account:", error);
      return NextResponse.json(
        { error: `No se pudo desconectar en Zernio: ${error instanceof Error ? error.message : String(error)}` },
        { status: 502 }
      );
    }
  }

  const { error } = await supabase
    .from("channels")
    .delete()
    .eq("id", channelId)
    .eq("workspace_id", workspace.id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/v1/channels/[channelId]  { is_active: boolean }
 *
 * Enciende o apaga un canal. Responde 404 si no cambió ninguna fila (el canal
 * no existe en este espacio o la base no dejó el cambio): así la pantalla no
 * muestra un éxito falso. Solo Dueño o Administrador.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { channelId } = await params;
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, workspaceId } = guard.ctx;

  const body = (await request.json().catch(() => null)) as { is_active?: unknown } | null;
  if (typeof body?.is_active !== "boolean")
    return NextResponse.json({ error: "Indica si el canal debe estar activo o no." }, { status: 400 });

  const { data, error } = await supabase
    .from("channels")
    .update({ is_active: body.is_active })
    .eq("id", channelId)
    .eq("workspace_id", workspaceId)
    .select("id, is_active");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return NextResponse.json({ error: "No se encontró el canal o no tienes permiso para cambiarlo." }, { status: 404 });

  return NextResponse.json(data[0]);
}
