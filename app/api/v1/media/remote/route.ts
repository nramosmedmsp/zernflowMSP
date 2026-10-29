import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getLateApiKey } from "@/lib/workspace-secrets";
import { inboundFetchPlan, needsProxy } from "@/lib/chat-media";
import { canRetryMedia, signedUrl, storeInboundMedia } from "@/lib/media-store";

// Solo estos archivos llevan la clave de Zernio: nunca otra ruta de su API.
const ZERNIO_MEDIA_PATH = /^\/api\/v1\/whatsapp\/media\/[A-Za-z0-9._-]+$/;
const TELEGRAM_FILE_PATH = /^\/file\//;

/**
 * GET /api/v1/media/remote?c={chat}&m={mensaje}&i={índice}&u={enlace}[&download=1]
 *
 * Archivo recibido que todavía no tiene copia (por ejemplo, de antes de esta
 * función). Comprueba que la persona ve el chat, lo descarga una vez, guarda
 * la copia (2 meses) y redirige a ella. WhatsApp pide la clave de Zernio y
 * borra los archivos a los pocos días; Telegram esconde un token en el enlace.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const q = request.nextUrl.searchParams;
  const conversationId = q.get("c");
  const messageId = q.get("m");
  const index = Number(q.get("i") ?? "0");
  const url = q.get("u");
  if (!conversationId || !messageId || !url || !Number.isInteger(index) || index < 0 || index > 4) {
    return NextResponse.json({ error: "Faltan datos del archivo" }, { status: 400 });
  }

  const plan = inboundFetchPlan(url);
  const path = new URL(url, "https://x").pathname;
  if (!plan.ok || !needsProxy(url) || (plan.withApiKey ? !ZERNIO_MEDIA_PATH.test(path) : !TELEGRAM_FILE_PATH.test(path))) {
    return NextResponse.json({ error: "Enlace no permitido" }, { status: 400 });
  }

  // La RLS decide si ve el chat.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, workspace_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return NextResponse.json({ error: "No se encontró la conversación" }, { status: 404 });

  const service = await createServiceClient();
  const existing = async () =>
    (
      await service
        .from("message_media")
        .select("storage_path, file_name, status, fetch_attempts")
        .eq("conversation_id", conversation.id)
        .eq("platform_message_id", messageId)
        .eq("attachment_index", index)
        .maybeSingle()
    ).data;

  let row = await existing();
  // M-13: un archivo que falló una vez (lentitud, Zernio aún no lo tenía) se
  // vuelve a intentar al abrirlo, hasta MAX_MEDIA_ATTEMPTS veces.
  const retry = !!row && canRetryMedia(row);
  if (!row || retry) {
    const apiKey = plan.withApiKey ? await getLateApiKey(conversation.workspace_id) : null;
    await storeInboundMedia(service, {
      workspaceId: conversation.workspace_id,
      conversationId: conversation.id,
      platformMessageId: messageId,
      attachments: [{ url }],
      apiKey,
      firstIndex: index,
      retryAttempt: retry ? (row?.fetch_attempts ?? 1) + 1 : undefined,
    });
    row = await existing();
  }
  if (!row || row.status !== "stored" || !row.storage_path) {
    return NextResponse.json({ error: "No se pudo traer el archivo. Puede que ya no esté disponible." }, { status: 502 });
  }
  const download = q.get("download") === "1";
  const signed = await signedUrl(service, row.storage_path, 300, download ? (row.file_name ?? "archivo") : null);
  if (!signed) return NextResponse.json({ error: "No se pudo abrir el archivo" }, { status: 502 });
  const res = NextResponse.redirect(signed, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
