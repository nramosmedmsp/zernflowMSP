// Registro de acciones sensibles desde rutas y acciones que aún no tienen un
// cliente de servicio a mano (SEG-05). Crea el cliente aquí dentro: si no se
// puede (por ejemplo, falta una variable de entorno) o el registro falla, solo
// se anota en el log y la operación principal sigue, igual que logActivity.

import { createServiceClient } from "@/lib/supabase/server";
import { logAudit, type AuditInput } from "@/lib/audit";

export async function auditAction(input: AuditInput): Promise<void> {
  try {
    await logAudit(await createServiceClient(), input);
  } catch (err) {
    console.error("[audit] no se pudo registrar la acción", input.action, err);
  }
}
