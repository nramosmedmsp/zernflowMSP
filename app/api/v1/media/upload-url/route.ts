import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { conversationMediaPath, validateOutgoingAttachment } from "@/lib/chat-media";
import { createUploadUrl } from "@/lib/media-store";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

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
  const upload = await createUploadUrl(await createServiceClient(), path);
  if (!upload) return NextResponse.json({ error: "No se pudo preparar la subida. Inténtalo de nuevo." }, { status: 500 });
  return NextResponse.json(upload);
}
