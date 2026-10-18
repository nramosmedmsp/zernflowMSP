import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { parseBroadcastContent } from "@/lib/broadcasts/content";
import type { Json } from "@/lib/types/database";

export async function GET() {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard.ctx;
  const membership = { workspace_id: guard.ctx.workspaceId };

  const { data: broadcasts, error } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("workspace_id", membership.workspace_id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(broadcasts);
}

export async function POST(request: NextRequest) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { supabase } = guard.ctx;
  const membership = { workspace_id: guard.ctx.workspaceId };

  const body = await request.json();
  // Texto o plantilla de WhatsApp; un borrador puede crearse sin contenido todavía.
  const content = parseBroadcastContent(body.messageContent);

  const { data: broadcast, error } = await supabase
    .from("broadcasts")
    .insert({
      workspace_id: membership.workspace_id,
      name: body.name || "Untitled Broadcast",
      message_content: (content ?? {}) as unknown as Json,
      segment_filter: body.segmentFilter || null,
      scheduled_for: body.scheduledFor || null,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(broadcast, { status: 201 });
}
