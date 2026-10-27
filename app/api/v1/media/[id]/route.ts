import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/media-store";

const VIEW_SECONDS = 300;

/**
 * GET /api/v1/media/{id}[?download=1]
 *
 * Abre un archivo de un chat. La RLS de message_media decide si la persona ve
 * ese chat; recién entonces se redirige a un enlace firmado de 5 minutos.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: row } = await supabase
    .from("message_media")
    .select("storage_path, file_name, status")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "No se encontró el archivo" }, { status: 404 });
  if (row.status !== "stored" || !row.storage_path) {
    return NextResponse.json({ error: "El archivo ya no está disponible (se guarda 2 meses)." }, { status: 410 });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  const url = await signedUrl(await createServiceClient(), row.storage_path, VIEW_SECONDS, download ? (row.file_name ?? "archivo") : null);
  if (!url) return NextResponse.json({ error: "No se pudo abrir el archivo" }, { status: 502 });
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
