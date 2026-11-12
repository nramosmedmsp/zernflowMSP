import { NextRequest } from "next/server";
import { handleBroadcastControl } from "@/lib/broadcasts/control-http";

/** POST /api/v1/broadcasts/:broadcastId/pause (Dueño o Administrador). */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ broadcastId: string }> }) {
  const { broadcastId } = await params;
  return handleBroadcastControl("pause", broadcastId);
}
