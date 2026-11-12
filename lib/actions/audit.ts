"use server";

// Registro de exportaciones y descargas de datos que se arman en el navegador
// (SEG-05). El CSV de Métricas se genera con datos ya cargados en pantalla, así
// que el servidor no ve la descarga: el botón avisa aquí y se deja la fila en
// `activity` (quién, qué archivo, cuándo). La descarga del código fuente ya se
// registra en su propia ruta.

import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

/** Solo nombres de archivo sencillos: lo que llega del navegador no es de fiar. */
const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

/** Cantidad de filas del archivo, solo si llega como entero razonable (lo del navegador no es de fiar). */
function cleanRows(rows: unknown): number | null {
  return typeof rows === "number" && Number.isInteger(rows) && rows >= 0 && rows <= 10_000_000 ? rows : null;
}

export async function recordDataExport(fileName: string, rows?: number): Promise<void> {
  try {
    if (typeof fileName !== "string" || !FILE_NAME.test(fileName)) return;
    const count = cleanRows(rows);
    const { workspace, user } = await getWorkspace();
    await logAudit(await createServiceClient(), {
      workspaceId: workspace.id,
      actorId: user.id,
      action: "data_exported",
      entity: "export",
      toValue: fileName,
      meta: { file: fileName, format: "csv", source: "metrics", ...(count !== null ? { rows: count } : {}) },
    });
  } catch (err) {
    // El registro nunca debe impedir la descarga.
    console.error("[audit] no se pudo registrar la exportación", err);
  }
}
