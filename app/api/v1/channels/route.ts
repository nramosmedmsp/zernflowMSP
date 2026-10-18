import { NextResponse } from "next/server";
import { requireApiMember } from "@/lib/api-auth";

// Columnas públicas del canal: channels.webhook_secret (secreto heredado por
// canal) no se envía al navegador.
const CHANNEL_COLUMNS =
  "id, workspace_id, platform, late_account_id, username, display_name, profile_picture, webhook_id, is_active, last_comment_cursor, comment_rules, created_at, updated_at";

export async function GET() {
  const guard = await requireApiMember();
  if (!guard.ok) return guard.response;
  const { supabase, workspaceId } = guard.ctx;

  const { data: channels, error } = await supabase
    .from("channels")
    .select(CHANNEL_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(channels);
}
