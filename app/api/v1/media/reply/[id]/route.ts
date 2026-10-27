import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/media-store";

/**
 * GET /api/v1/media/reply/{replyId}
 *
 * Abre el archivo de una respuesta guardada. La RLS de saved_replies decide si
 * la persona la ve (empresa, equipo o personal).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: reply } = await supabase.from("saved_replies").select("attachment_url").eq("id", id).maybeSingle();
  if (!reply?.attachment_url) return NextResponse.json({ error: "No se encontró el archivo" }, { status: 404 });

  const url = await signedUrl(await createServiceClient(), reply.attachment_url, 300);
  if (!url) return NextResponse.json({ error: "No se pudo abrir el archivo" }, { status: 502 });
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
