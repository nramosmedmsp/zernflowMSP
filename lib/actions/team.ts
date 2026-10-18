"use server";

import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { setWorkspaceCookie } from "@/lib/workspace-cookie";
import {
  isInviteUsable,
  sameEmail,
  validateNewPassword,
} from "@/lib/auth-helpers";

export async function inviteTeamMember(
  workspaceId: string,
  email: string,
  role: string
) {
  const { workspace, user, supabase } = await getWorkspace();

  if (workspace.id !== workspaceId) {
    return { error: "El espacio de trabajo cambió. Recarga la página e inténtalo de nuevo." };
  }

  // Validate caller is owner
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (membership?.role !== "owner") {
    return { error: "Solo el dueño del espacio de trabajo puede invitar miembros." };
  }

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    return { error: "Escribe un correo válido." };
  }

  const validRoles = ["member", "admin"];
  if (!validRoles.includes(role)) {
    return { error: "Rol no válido. Elige Miembro o Administrador." };
  }

  // Una invitación vigente para el mismo correo basta; las vencidas no bloquean.
  const { data: existingInvites } = await supabase
    .from("workspace_invites")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("email", trimmedEmail)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .limit(1);

  if (existingInvites && existingInvites.length > 0) {
    return {
      error:
        "Ya hay una invitación pendiente para este correo. Copia su enlace en la lista de invitaciones pendientes.",
    };
  }

  const { data: invite, error: insertError } = await supabase
    .from("workspace_invites")
    .insert({
      workspace_id: workspaceId,
      email: trimmedEmail,
      role,
      invited_by: user.id,
      status: "pending",
    })
    .select("*")
    .single();

  if (insertError) {
    console.error("[inviteTeamMember]", insertError.message);
    return { error: "No se pudo crear la invitación. Inténtalo de nuevo." };
  }

  return { ok: true, invite };
}

export async function removeTeamMember(
  workspaceId: string,
  userId: string
) {
  const { workspace, user, supabase } = await getWorkspace();

  if (workspace.id !== workspaceId) {
    return { error: "El espacio de trabajo cambió. Recarga la página e inténtalo de nuevo." };
  }

  // Validate caller is owner
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (membership?.role !== "owner") {
    return { error: "Solo el dueño del espacio de trabajo puede quitar miembros." };
  }

  // Can't remove yourself
  if (userId === user.id) {
    return { error: "No puedes quitarte a ti mismo del espacio de trabajo." };
  }

  const { error: deleteError } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (deleteError) {
    console.error("[removeTeamMember]", deleteError.message);
    return { error: "No se pudo quitar al miembro. Inténtalo de nuevo." };
  }

  return { ok: true };
}

export async function acceptInvite(inviteId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Inicia sesión para aceptar la invitación." };

  // Use service client to bypass RLS (the user is not a workspace member yet)
  const serviceClient = await createServiceClient();

  // Fetch the invite
  const { data: invite, error: fetchError } = await serviceClient
    .from("workspace_invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (fetchError || !invite) {
    return { error: "No encontramos esta invitación." };
  }

  if (invite.status !== "pending") {
    return { error: "Esta invitación ya no es válida." };
  }

  if (!isInviteUsable(invite)) {
    return { error: "Esta invitación venció. Pide un enlace nuevo." };
  }

  // Verify the invite email matches the current user's email
  if (!sameEmail(invite.email, user.email)) {
    return { error: "Esta invitación es para otro correo." };
  }

  // Check if user is already a member
  const { data: existingMembership } = await serviceClient
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existingMembership) {
    // Insert into workspace_members (service client bypasses owner-only RLS)
    const { error: insertError } = await serviceClient
      .from("workspace_members")
      .insert({
        workspace_id: invite.workspace_id,
        user_id: user.id,
        role: invite.role,
      });

    if (insertError) {
      console.error("[acceptInvite]", insertError.message);
      return { error: "No se pudo aceptar la invitación. Inténtalo de nuevo." };
    }
  }

  // Update invite status to accepted
  await serviceClient
    .from("workspace_invites")
    .update({ status: "accepted" })
    .eq("id", inviteId)
    .eq("status", "pending");

  // Entrar directamente al espacio al que lo invitaron.
  await setWorkspaceCookie(invite.workspace_id);

  return {
    ok: true,
    workspaceId: invite.workspace_id,
    alreadyMember: !!existingMembership,
  };
}

export type InviteSignUpState = { error: string | null };

/**
 * Crea la cuenta de una persona invitada sin depender del correo: la cuenta se
 * crea ya confirmada con el cliente de servicio, se agrega la membresía, se
 * marca la invitación como aceptada y se inicia sesión con la contraseña para
 * dejar las cookies de sesión.
 */
export async function signUpWithInvite(
  _prev: InviteSignUpState,
  formData: FormData
): Promise<InviteSignUpState> {
  const inviteId = String(formData.get("inviteId") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmPassword") ?? "");

  if (!inviteId) return { error: "Falta el enlace de invitación." };
  if (!fullName) return { error: "Escribe tu nombre." };
  if (fullName.length > 100) {
    return { error: "El nombre no puede tener más de 100 caracteres." };
  }

  const passwordError = validateNewPassword(password, confirmation);
  if (passwordError) return { error: passwordError };

  const serviceClient = await createServiceClient();

  const { data: invite } = await serviceClient
    .from("workspace_invites")
    .select("*")
    .eq("id", inviteId)
    .maybeSingle();

  if (!invite) return { error: "No encontramos esta invitación." };
  if (invite.status !== "pending") {
    return { error: "Esta invitación ya se usó o fue revocada." };
  }
  if (!isInviteUsable(invite)) {
    return { error: "Esta invitación venció. Pide a un administrador un enlace nuevo." };
  }

  const email = invite.email.trim().toLowerCase();

  // El trigger handle_new_user (00017) ve la invitación pendiente y no crea
  // un espacio propio para esta persona.
  const { data: created, error: createError } =
    await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

  if (createError || !created?.user) {
    const msg = createError?.message?.toLowerCase() ?? "";
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return {
        error: "Ya existe una cuenta con este correo. Inicia sesión para aceptar la invitación.",
      };
    }
    if (msg.includes("password")) {
      return { error: "La contraseña no cumple los requisitos. Prueba con una más larga." };
    }
    console.error("[signUpWithInvite] createUser", createError?.message);
    return { error: "No se pudo crear tu cuenta. Inténtalo de nuevo en unos minutos." };
  }

  const userId = created.user.id;

  const { error: memberError } = await serviceClient
    .from("workspace_members")
    .insert({
      workspace_id: invite.workspace_id,
      user_id: userId,
      role: invite.role,
    });

  if (memberError) {
    console.error("[signUpWithInvite] membership", memberError.message);
    // Sin membresía la cuenta quedaría huérfana: se deshace para poder reintentar.
    await serviceClient.auth.admin.deleteUser(userId);
    return { error: "No se pudo completar tu ingreso al espacio. Inténtalo de nuevo." };
  }

  await serviceClient
    .from("workspace_invites")
    .update({ status: "accepted" })
    .eq("id", invite.id)
    .eq("status", "pending");

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    console.error("[signUpWithInvite] signIn", signInError.message);
    // La cuenta y la membresía ya existen: basta con iniciar sesión a mano.
    redirect("/login?created=1");
  }

  await setWorkspaceCookie(invite.workspace_id);
  redirect("/dashboard");
}

export async function revokeInvite(inviteId: string) {
  const { user, supabase } = await getWorkspace();

  // Fetch the invite to get workspace_id
  const { data: invite, error: fetchError } = await supabase
    .from("workspace_invites")
    .select("workspace_id")
    .eq("id", inviteId)
    .single();

  if (fetchError || !invite) {
    return { error: "No encontramos esta invitación." };
  }

  // Validate caller is owner
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", user.id)
    .single();

  if (membership?.role !== "owner") {
    return { error: "Solo el dueño del espacio de trabajo puede revocar invitaciones." };
  }

  const { error: deleteError } = await supabase
    .from("workspace_invites")
    .delete()
    .eq("id", inviteId);

  if (deleteError) {
    console.error("[revokeInvite]", deleteError.message);
    return { error: "No se pudo revocar la invitación. Inténtalo de nuevo." };
  }

  return { ok: true };
}
