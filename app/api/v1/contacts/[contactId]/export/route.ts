import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isViewAsLocked, markReadOnlyHit } from "@/lib/view-as/lock";
import { VIEW_AS_READ_ONLY_MESSAGE } from "@/lib/view-as/guard";
import { logActivity } from "@/lib/cases/io";
import { exportFileName, renderContactExportHtml } from "@/lib/contact-export";
import { loadContactExport } from "@/lib/contact-export-load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Leer los mensajes de Zernio de varias conversaciones puede tardar.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/contacts/:contactId/export
 *
 * Copia imprimible de "todo lo que tenemos de este cliente" (derecho de
 * acceso): una página web con sus datos, conversaciones, gestiones y notas. Solo
 * Dueño o Administrador (se comprueba aquí, en el servidor). Deja un registro
 * en el historial del contacto, así que no corre en "Ver como" (solo lectura).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  if (!UUID_RE.test(contactId)) return NextResponse.json({ error: "Datos no válidos." }, { status: 400 });

  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;
  const { workspaceId, user } = guard.ctx;

  if (await isViewAsLocked()) {
    await markReadOnlyHit();
    return NextResponse.json({ error: VIEW_AS_READ_ONLY_MESSAGE }, { status: 403 });
  }

  try {
    const service = await createServiceClient();
    const data = await loadContactExport(service, { workspaceId, contactId, actorId: user.id });
    if (!data) return NextResponse.json({ error: "No se encontró el contacto." }, { status: 404 });

    // Sin datos personales en el registro: solo quién y cuándo.
    await logActivity(service, {
      workspace_id: workspaceId,
      type: "contact_data_exported",
      contact_id: contactId,
      actor_id: user.id,
      meta: { format: "html" },
    });

    return new NextResponse(renderContactExportHtml(data), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${exportFileName(data.contact.name)}"`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    console.error("[contacts/export]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo generar la copia de los datos. Inténtalo de nuevo." }, { status: 500 });
  }
}
