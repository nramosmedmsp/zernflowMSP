"use server";

import { createClient } from "@/lib/supabase/server";
import { rpcCreateWorkspace } from "@/lib/supabase/extra-rpc";
import { setWorkspaceCookie } from "@/lib/workspace-cookie";

export async function switchWorkspace(workspaceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Tu sesión expiró. Vuelve a iniciar sesión." };

  // Validate user has access to this workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", workspaceId)
    .single();

  if (!membership) return { error: "No tienes acceso a este espacio de trabajo." };

  await setWorkspaceCookie(workspaceId);

  return { ok: true };
}

export async function createWorkspace(name: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Tu sesión expiró. Vuelve a iniciar sesión." };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Escribe un nombre para el espacio de trabajo." };
  if (trimmed.length > 100) {
    return { error: "El nombre no puede tener más de 100 caracteres." };
  }

  // La función de la base (00017) crea el espacio, genera un slug único y
  // agrega al usuario como dueño en una sola transacción, sin depender de
  // políticas INSERT en `workspaces` ni en `workspace_members`.
  const { id, error } = await rpcCreateWorkspace(supabase, trimmed);

  if (error || !id) {
    console.error("[createWorkspace]", error);
    return { error: "No se pudo crear el espacio de trabajo. Inténtalo de nuevo." };
  }

  await setWorkspaceCookie(id);

  return { ok: true, workspaceId: id };
}
