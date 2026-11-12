"use server";

// Borrar los datos de un cliente (PRIV-06, derecho de cancelación). Solo Dueño o
// Administrador, con confirmación escrita, sin deshacer. El trabajo pesado vive en
// lib/contact-erase.ts (una transacción en la base + borrado de archivos con
// reintento). Aquí solo se comprueban permisos, la confirmación y "Ver como".

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { GENERIC_ERROR } from "@/lib/cases/io";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import { isViewAsLocked, markReadOnlyHit, VIEW_AS_LOCKED_MESSAGE } from "@/lib/view-as/lock";
import {
  eraseContactData,
  erasureConfirmationMatches,
  retryErasureFiles,
  type ErasureSummary,
} from "@/lib/contact-erase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PrivacyActionResult<T extends object = object> = ({ ok: true } & T) | { error: string };

export const FILES_PENDING_MESSAGE =
  "Los datos del cliente ya se eliminaron, pero algunos archivos no se pudieron borrar todavía. Usa «Reintentar borrar archivos» en la ficha del cliente.";

async function adminContext(): Promise<
  { userId: string; workspaceId: string } | { error: string }
> {
  if (await isViewAsLocked()) {
    await markReadOnlyHit();
    return { error: VIEW_AS_LOCKED_MESSAGE };
  }
  const { user, workspace, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };
  return { userId: user.id, workspaceId: workspace.id };
}

/**
 * Elimina los datos personales del cliente. `confirmation` es lo que la persona
 * tecleó: el nombre del cliente (o "ELIMINAR" si no tiene un nombre útil).
 */
export async function eraseContact(
  contactId: string,
  confirmation: string,
): Promise<PrivacyActionResult<{ summary: ErasureSummary; filesPending: number; alreadyErased: boolean; warning: string | null }>> {
  if (typeof contactId !== "string" || !UUID_RE.test(contactId)) return { error: "Datos no válidos." };
  const ctx = await adminContext();
  if ("error" in ctx) return ctx;

  const db = await createServiceClient();
  const { data: contact } = await db
    .from("contacts")
    .select("id, display_name, erased_at")
    .eq("id", contactId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!contact) return { error: "No se encontró el contacto." };
  if (contact.erased_at) return { error: "Los datos de este cliente ya fueron eliminados." };
  if (!erasureConfirmationMatches(confirmation, contact.display_name)) {
    return { error: "Lo que escribiste no coincide. Escribe exactamente la palabra que se indica para confirmar." };
  }

  const outcome = await eraseContactData(db, { workspaceId: ctx.workspaceId, contactId, actorId: ctx.userId });
  if (!outcome.ok) return { error: outcome.code === "not_found" ? "No se encontró el contacto." : GENERIC_ERROR };

  revalidatePath("/dashboard/contacts");
  revalidatePath(`/dashboard/contacts/${contactId}`);
  revalidatePath("/dashboard/inbox");
  if (outcome.alreadyErased) {
    return {
      ok: true,
      alreadyErased: true,
      filesPending: 0,
      warning: null,
      summary: { conversations: 0, messages: 0, files: 0, notes: 0, casesKept: 0, claimsKept: 0 },
    };
  }
  return {
    ok: true,
    alreadyErased: false,
    summary: outcome.summary,
    filesPending: outcome.filesPending,
    warning: outcome.filesPending > 0 ? FILES_PENDING_MESSAGE : null,
  };
}

/** Vuelve a intentar borrar los archivos que quedaron pendientes de un borrado. */
export async function retryEraseFiles(erasureId: string): Promise<PrivacyActionResult<{ filesPending: number }>> {
  if (typeof erasureId !== "string" || !UUID_RE.test(erasureId)) return { error: "Datos no válidos." };
  const ctx = await adminContext();
  if ("error" in ctx) return ctx;
  const db = await createServiceClient();
  const outcome = await retryErasureFiles(db, { workspaceId: ctx.workspaceId, erasureId, actorId: ctx.userId });
  if (!outcome.ok) return { error: outcome.code === "not_found" ? "No se encontró el borrado." : GENERIC_ERROR };
  revalidatePath("/dashboard/contacts");
  return { ok: true, filesPending: outcome.filesPending };
}
