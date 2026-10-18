import { NextRequest, NextResponse } from "next/server";
import { createZernioClient } from "@/lib/zernio-client";
import { PLATFORMS, isSupportedPlatform } from "@/lib/platforms";
import { requireApiAdmin } from "@/lib/api-auth";
import { getLateApiKey } from "@/lib/workspace-secrets";

/**
 * POST /api/v1/channels/connect
 *
 * Returns Zernio's OAuth/connect URL for the given platform.
 * Zernio handles the entire connection flow (OAuth, page selection, etc.)
 * and redirects back to our callback URL when done.
 * Solo Dueño o Administrador.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  // La clave se lee en el servidor con el cliente de servicio; nunca llega al navegador.
  const lateApiKey = await getLateApiKey(guard.ctx.workspaceId);
  if (!lateApiKey) {
    return NextResponse.json(
      { error: "La clave de API de Zernio no está configurada. Ve primero a Configuración." },
      { status: 400 }
    );
  }

  const { platform } = await request.json();

  if (!isSupportedPlatform(platform)) {
    return NextResponse.json(
      { error: `Plataforma no compatible. Debe ser una de: ${PLATFORMS.join(", ")}` },
      { status: 400 }
    );
  }

  const zernio = createZernioClient(lateApiKey);

  try {
    // Get profile ID (required by Zernio's connect endpoint)
    const profilesRes = await zernio.profiles.listProfiles();
    const profiles = profilesRes.data?.profiles ?? [];
    if (profiles.length === 0) {
      return NextResponse.json(
        { error: "No se encontraron perfiles de Zernio. Crea uno primero en tu panel de Zernio." },
        { status: 400 }
      );
    }

    const profileId = profiles[0]._id!;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const callbackUrl = `${appUrl}/dashboard/channels/callback`;

    // Zernio handles everything: OAuth, page selection, Bluesky credentials, Telegram code
    const res = await zernio.connect.getConnectUrl({
      path: { platform },
      query: { profileId, redirect_url: callbackUrl },
    });

    if (!res.data?.authUrl) {
      return NextResponse.json({ error: "No se pudo obtener la URL de conexión" }, { status: 500 });
    }

    return NextResponse.json({ authUrl: res.data.authUrl });
  } catch (error) {
    console.error("Failed to get connect URL:", error);
    return NextResponse.json(
      { error: `Falló la conexión: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
