"use server";

// «Cargar más» del Registro de cambios. La comprobación de rol se hace aquí, en el
// servidor, con el rol efectivo (en «Ver como» manda la persona vista): quien no es
// Dueño ni Administrador recibe el mismo aviso que en las demás pantallas restringidas.

import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import {
  AUDIT_NOT_ALLOWED_MESSAGE,
  canReadAuditLog,
  loadAuditPage,
  parseAuditCursor,
  parseAuditFilters,
  type AuditPage,
} from "@/lib/audit-log";

export async function loadMoreAuditLog(
  filters: { persona?: string; tipo?: string; periodo?: string },
  cursor: string,
): Promise<AuditPage | { error: string }> {
  try {
    const { workspace, role, supabase } = await getWorkspace();
    if (!canReadAuditLog(role)) return { error: AUDIT_NOT_ALLOWED_MESSAGE };
    if (!parseAuditCursor(cursor)) return { error: "No se pudo cargar el registro. Inténtalo de nuevo." };
    return await loadAuditPage(supabase, await createServiceClient(), {
      workspaceId: workspace.id,
      filters: parseAuditFilters(filters),
      cursor,
    });
  } catch (err) {
    console.error("[audit-log] cargar más", err);
    return { error: "No se pudo cargar el registro. Inténtalo de nuevo." };
  }
}
