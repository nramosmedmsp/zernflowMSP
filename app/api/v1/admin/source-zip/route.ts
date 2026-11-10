import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServiceClient } from "@/lib/supabase/server";
import { getRealSession } from "@/lib/view-as/state";
import { isViewAsLocked } from "@/lib/view-as/lock";
import { VIEW_AS_READ_ONLY_MESSAGE } from "@/lib/view-as/guard";
import { getWorkspace } from "@/lib/workspace";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import { logActivity, type Db } from "@/lib/cases/io";

// Descarga del código fuente (solo Dueño o Administrador). El ZIP lo genera
// scripts/build-source-zip.mjs en `npm run build`; next.config.ts lo incluye en
// esta función. En `next dev` se arma al vuelo con el mismo generador.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ZIP_PATH = ".source-zip/codigo-crm.zip";

async function loadZip(): Promise<Uint8Array | null> {
  try {
    return await readFile(join(process.cwd(), ZIP_PATH));
  } catch {
    if (process.env.NODE_ENV !== "development") return null;
  }
  const { buildSourceZip } = await import("@/scripts/source-zip.mjs");
  return buildSourceZip(process.cwd()).data;
}

export async function GET() {
  const real = await getRealSession();
  if (!real) {
    return NextResponse.json({ error: "Inicia sesión para continuar." }, { status: 401 });
  }
  // La descarga deja un registro (escribe): no corre mientras hay una vista de "Ver como".
  if (await isViewAsLocked()) {
    return NextResponse.json({ error: VIEW_AS_READ_ONLY_MESSAGE }, { status: 403 });
  }

  const { workspace, role, user } = await getWorkspace();
  if (!isAdminRole(role)) {
    return NextResponse.json({ error: ADMIN_ONLY_MESSAGE }, { status: 403 });
  }

  const zip = await loadZip();
  if (!zip) {
    return NextResponse.json(
      { error: "El archivo del código no está disponible en esta versión. Vuelve a desplegar la app." },
      { status: 404 },
    );
  }

  console.info(`[source-zip] descarga por ${user.id} (espacio ${workspace.id})`);
  try {
    await logActivity((await createServiceClient()) as Db, {
      workspace_id: workspace.id,
      type: "config_changed",
      actor_id: user.id,
      meta: { action: "source_downloaded", entity: "source_code" },
    });
  } catch (error) {
    console.error("[source-zip] no se pudo registrar la descarga", error);
  }

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="codigo-crm-muscle-shop-${date}.zip"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
}
