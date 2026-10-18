import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";
import {
  ensureWebhookRegistered,
  getOrCreateWorkspaceWebhookSecret,
} from "@/lib/zernio-webhook";
import { backfillInboxConversations } from "@/lib/inbox-sync";
import { isSupportedPlatform } from "@/lib/platforms";
import { WORKSPACE_CHANGED_MESSAGE, requireApiAdmin } from "@/lib/api-auth";
import { OWNER_ONLY_SECRETS_MESSAGE, canManageSecrets } from "@/lib/permissions";
import { saveWorkspaceSecrets } from "@/lib/workspace-secrets";

/**
 * POST /api/v1/channels/test-key
 *
 * Tests a Zernio API key, saves it to the workspace, and auto-syncs channels.
 * Probar: Dueño o Administrador. Guardar (con workspaceId): solo el Dueño.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const body = await request.json();
  const { apiKey, workspaceId } = body;

  if (!apiKey || typeof apiKey !== "string") {
    return NextResponse.json(
      { error: "La clave de API es obligatoria" },
      { status: 400 }
    );
  }

  if (workspaceId) {
    if (workspaceId !== guard.ctx.workspaceId) {
      return NextResponse.json({ error: WORKSPACE_CHANGED_MESSAGE }, { status: 409 });
    }
    if (!canManageSecrets(guard.ctx.role)) {
      return NextResponse.json({ error: OWNER_ONLY_SECRETS_MESSAGE }, { status: 403 });
    }
  }

  // Validate the key by listing accounts
  let accounts: Array<{ _id?: string; platform?: string; username?: string; displayName?: string; profilePicture?: string }>;
  try {
    const zernio = createZernioClient(apiKey.trim());
    const res = await zernio.accounts.listAccounts();
    accounts = (res.data?.accounts ?? []) as typeof accounts;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Clave de API no válida o error de conexión";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // If workspaceId provided, save the key and sync channels
  if (workspaceId) {
    const { supabase } = guard.ctx;
    // workspace_secrets solo se escribe con el cliente de servicio (rol ya validado).
    const service = await createServiceClient();

    // Save the API key
    const { error: saveErr } = await saveWorkspaceSecrets(
      workspaceId,
      { lateApiKey: apiKey.trim() },
      service
    );

    if (saveErr) {
      return NextResponse.json(
        { error: `La clave es válida, pero no se pudo guardar: ${saveErr}` },
        { status: 500 }
      );
    }

    // Register (or refresh) this deployment's webhook in Zernio so inbound
    // messages/comments reach the Inbox. Best-effort: a failure here must not
    // block saving the key or syncing channels.
    try {
      const secret = await getOrCreateWorkspaceWebhookSecret(service, workspaceId);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const zernio = createZernioClient(apiKey.trim());
      await ensureWebhookRegistered(zernio, {
        appUrl,
        secret,
        events: ["message.received", "comment.received"],
      });
    } catch (err) {
      console.error("[test-key] webhook auto-registration failed:", err);
    }

    // Auto-sync channels
    const { data: existingChannels } = await supabase
      .from("channels")
      .select("*")
      .eq("workspace_id", workspaceId);

    const existingByLateId = new Map(
      (existingChannels ?? []).map((c) => [c.late_account_id, c])
    );

    for (const account of accounts) {
      if (!account._id) continue;
      if (existingByLateId.has(account._id)) continue;
      if (!isSupportedPlatform(account.platform)) continue;

      const { error: insertErr } = await supabase.from("channels").insert({
        workspace_id: workspaceId,
        platform: account.platform,
        late_account_id: account._id,
        username: account.username || null,
        display_name: account.displayName || account.username || null,
        profile_picture: account.profilePicture || null,
        is_active: true,
      });
      if (insertErr) {
        console.error("[test-key] channel insert failed:", insertErr);
      }
    }

    // Backfill conversations that predate webhook registration so a
    // first-time API-key setup fills the Inbox immediately (best-effort).
    try {
      const { data: activeChannels } = await supabase
        .from("channels")
        .select("id, late_account_id, platform")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true);

      await backfillInboxConversations({
        supabase,
        zernio: createZernioClient(apiKey.trim()),
        workspaceId,
        channels: activeChannels ?? [],
      });
    } catch (err) {
      console.error("[test-key] inbox backfill failed:", err);
    }
  }

  return NextResponse.json({ accounts });
}
