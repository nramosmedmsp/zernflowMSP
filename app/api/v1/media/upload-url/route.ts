import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { conversationMediaPath, validateOutgoingAttachment } from "@/lib/chat-media";
import { createUploadUrl } from "@/lib/media-store";
import { getEffectiveAuthUser } from "@/lib/view-as/state";
import { enforceRateLimit, rateLimitedResponse } from "@/lib/rate-limit-http";
import { PENDING_UPLOADS_MESSAGE, registerUpload } from "@/lib/upload-tracking";
import { RATE_RULES } from "@/lib/rate-limit";

/**
 * POST /api/v1/media/upload-url { conversationId, mime, size }
 *
 * Enlace de subida firmado para adjuntar una foto o un PDF a un chat. El
 * navegador sube el archivo directo al bucket (sin pasar por Vercel, que corta
 * a ~4,5 MB) y luego lo envía con POST /api/v1/messages, que vuelve a revisar
 * el archivo guardado.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getEffectiveAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  // SEG-01: tope de enlaces de subida por usuario.
  const limited = await enforceRateLimit(RATE_RULES.uploadUrl, user.id);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const { conversationId, mime, size } = body as { conversationId?: unknown; mime?: unknown; size?: unknown };
  if (typeof conversationId !== "string" || typeof mime !== "string" || typeof size !== "number") {
    return NextResponse.json({ error: "Faltan los datos del archivo" }, { status: 400 });
  }

  // Con el cliente del usuario: la RLS decide si ve este chat.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, workspace_id, platform")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return NextResponse.json({ error: "No se encontró la conversación" }, { status: 404 });

  // El navegador achica las fotos antes de pedir el enlace: aquí ya deben caber.
  const check = validateOutgoingAttachment(conversation.platform, { mime, size });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  if (check.compress) return NextResponse.json({ error: "La foto pesa demasiado para este canal." }, { status: 400 });

  const path = conversationMediaPath(conversation.workspace_id, conversation.id, "out", mime);
  const service = await createServiceClient();
  // SEG-10: tope de subidas sin enviar por usuario; la subida queda anotada para la limpieza diaria.
  const registered = await registerUpload(service, { workspaceId: conversation.workspace_id, userId: user.id, path, source: "chat" });
  if (!registered.ok) return rateLimitedResponse(3600, PENDING_UPLOADS_MESSAGE);
  const upload = await createUploadUrl(service, path);
  if (!upload) return NextResponse.json({ error: "No se pudo preparar la subida. Inténtalo de nuevo." }, { status: 500 });
  return NextResponse.json(upload);
}
