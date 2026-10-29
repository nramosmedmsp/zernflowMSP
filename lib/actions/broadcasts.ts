"use server";

// Difusiones: solo Dueño o Administrador (la política de la base también lo exige).
// Crear y enviar siguen en la pantalla y en /api/v1/broadcasts; aquí van las
// operaciones sobre un borrador.

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import { incompleteFilterProblem, type SegmentFilter } from "@/lib/broadcasts/segment";
import type { Json } from "@/lib/types/database";

const GENERIC_ERROR = "No se pudo completar la operación. Inténtalo de nuevo.";
const NOT_FOUND = "No se encontró la difusión";
const ONLY_DRAFTS = "Solo se puede cambiar una difusión que todavía no se envió.";

/** Elimina un borrador (o una difusión programada que aún no salió). */
export async function deleteBroadcast(broadcastId: string): Promise<{ ok: true } | { error: string }> {
  const { workspace, supabase, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  const { data: deleted, error } = await supabase
    .from("broadcasts")
    .delete()
    .eq("id", broadcastId)
    .eq("workspace_id", workspace.id)
    .in("status", ["draft", "scheduled"])
    .select("id");
  if (error) {
    console.error("[broadcasts] delete", error.message);
    return { error: GENERIC_ERROR };
  }
  if (!deleted || deleted.length === 0) {
    const { data: exists } = await supabase
      .from("broadcasts")
      .select("id")
      .eq("id", broadcastId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    return { error: exists ? "Solo se puede eliminar una difusión que todavía no se envió." : NOT_FOUND };
  }

  revalidatePath("/dashboard/broadcasts");
  return { ok: true };
}

/** Cambia (o quita, con `null`) el filtro de segmento de un borrador. No guarda reglas incompletas. */
export async function updateBroadcastFilter(
  broadcastId: string,
  filter: SegmentFilter | null,
): Promise<{ ok: true; segment_filter: Json | null } | { error: string }> {
  const { workspace, supabase, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  const problem = incompleteFilterProblem(filter);
  if (problem) return { error: problem };

  const value = filter && filter.groups?.length ? (filter as unknown as Json) : null;
  const { data: updated, error } = await supabase
    .from("broadcasts")
    .update({ segment_filter: value })
    .eq("id", broadcastId)
    .eq("workspace_id", workspace.id)
    .in("status", ["draft", "scheduled"])
    .select("id");
  if (error) {
    console.error("[broadcasts] update filter", error.message);
    return { error: GENERIC_ERROR };
  }
  if (!updated || updated.length === 0) return { error: ONLY_DRAFTS };

  revalidatePath("/dashboard/broadcasts");
  return { ok: true, segment_filter: value };
}
