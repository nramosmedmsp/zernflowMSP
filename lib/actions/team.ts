"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { releaseMemberWork } from "@/lib/cases/member-removal";
import { logActivity, type Db } from "@/lib/cases/io";
import { rpcAuthUserExists } from "@/lib/supabase/extra-rpc";
import { findAuthUserByEmail, generateAccessLink } from "@/lib/supabase/admin-users";
import { sendAppMail } from "@/lib/mail/send";
import { isMailConfigured } from "@/lib/mail/settings";
import { inviteEmail, resetPasswordEmail } from "@/lib/mail/templates";
import {
  APP_URL_MISSING_MESSAGE,
  EXISTING_ACCOUNT_PRIVILEGED_MESSAGE,
  EXISTING_ACCOUNT_LOOKUP_MESSAGE,
  crossWorkspaceAuthorityError,
  type RoleMembership,
  MAIL_NOT_CONFIGURED_MESSAGE,
  accessLinkTypeFor,
  appBaseUrl,
  canManageTeam,
  copyAccessLinkError,
  displayName,
  isAssignableRole,
  memberStatus,
  memberViewFromUser,
  normalizeEmail,
  normalizeFullName,
  removeMemberError,
  sendAccessEmailError,
  type AccessLinkType,
  type MemberStatus,
  type TeamMemberView,
} from "@/lib/team-rules";

// Todas las escrituras se hacen con el cliente de servicio después de validar
// en el servidor que quien llama es Dueño o Administrador del espacio actual.
// Así no hace falta ampliar las políticas RLS de workspace_members ni de
// workspace_invites (que siguen siendo solo para el Dueño).

const WORKSPACE_CHANGED =
  "El espacio de trabajo cambió. Recarga la página e inténtalo de nuevo.";
const NOT_ALLOWED = "Solo el Dueño o un Administrador pueden administrar el equipo.";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/** Resultado de intentar enviar un enlace de acceso por correo. */
export type AccessDelivery =
  | { sent: true; message: string }
  | { sent: false; notConfigured: boolean; message: string };

export type CreateTeamUserResult =
  | { error: string }
  | { ok: true; outcome: "created" | "readded"; member: TeamMemberView; delivery: AccessDelivery };

async function managerContext(workspaceId: string) {
  const ctx = await getWorkspace();
  if (ctx.workspace.id !== workspaceId) return { ok: false, error: WORKSPACE_CHANGED } as const;
  if (!canManageTeam(ctx.role)) return { ok: false, error: NOT_ALLOWED } as const;
  const service = await createServiceClient();
  return { ok: true, ctx, service } as const;
}

async function getMembership(service: ServiceClient, workspaceId: string, userId: string) {
  const { data } = await service
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

async function deliverAccessLink(
  service: ServiceClient,
  params: {
    to: string;
    name: string;
    url: string;
    status: MemberStatus;
    inviterName: string;
    workspaceName: string;
  },
): Promise<AccessDelivery> {
  const activation = params.status === "pending";
  const content = activation
    ? inviteEmail({
        name: params.name,
        url: params.url,
        inviterName: params.inviterName,
        workspaceName: params.workspaceName,
      })
    : resetPasswordEmail({ name: params.name, url: params.url });

  const result = await sendAppMail(service, params.to, content);
  if (result.ok) {
    return {
      sent: true,
      message: activation
        ? `Le enviamos un correo a ${params.to} para que active su cuenta y cree su contraseña.`
        : `Le enviamos a ${params.to} un enlace para restablecer su contraseña.`,
    };
  }
  if (result.notConfigured) {
    return { sent: false, notConfigured: true, message: notConfiguredMessage(params.status) };
  }
  return {
    sent: false,
    notConfigured: false,
    message: `No se pudo enviar el correo: ${result.error} Corrígelo en Configuración → Correo y vuelve a intentarlo${params.status === "pending" ? ", o copia el enlace" : ", o pide al Dueño que genere el enlace"}.`,
  };
}

function notConfiguredMessage(status: MemberStatus): string {
  return status === "pending"
    ? MAIL_NOT_CONFIGURED_MESSAGE
    : "El correo aún no está configurado. Configúralo en Configuración → Correo. Si necesitas el enlace de una cuenta activa, pide al Dueño que lo genere.";
}

function inviterNameOf(user: { email?: string | null; user_metadata?: Record<string, unknown> }) {
  return displayName({ id: "", email: user.email, user_metadata: user.user_metadata });
}

/** Roles de una persona en todos los espacios en que es miembro. */
async function membershipsOf(service: ServiceClient, userId: string): Promise<RoleMembership[]> {
  const { data } = await service
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId);
  return (data ?? []).map((m) => ({ workspaceId: m.workspace_id, role: m.role }));
}

/**
 * Crea un usuario nuevo para el espacio actual: crea la cuenta con un enlace de
 * activación y lo envía con el correo de la app (si está configurado). Si el
 * correo ya tiene cuenta (por ejemplo, alguien a quien se quitó del espacio), el
 * Dueño o Administrador la vuelve a agregar directamente con el rol elegido,
 * siempre que no sea Dueño ni Administrador de otro espacio y quien la agrega
 * tenga autoridad sobre ella en cada espacio al que pertenezca.
 */
export async function createTeamUser(
  workspaceId: string,
  input: { fullName: string; email: string; role: string },
): Promise<CreateTeamUserResult> {
  const auth = await managerContext(workspaceId);
  if (!auth.ok) return { error: auth.error };
  const { ctx, service } = auth;

  const nameCheck = normalizeFullName(input.fullName);
  if (nameCheck.error !== null) return { error: nameCheck.error };
  const fullName = nameCheck.name;

  const email = normalizeEmail(input.email);
  if (!email) return { error: "Escribe un correo válido." };

  if (!isAssignableRole(input.role)) {
    return { error: "Rol no válido. Elige Miembro o Administrador." };
  }
  const role = input.role;

  const baseUrl = appBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (!baseUrl) return { error: APP_URL_MISSING_MESSAGE };

  const { exists, error: existsError } = await rpcAuthUserExists(service, email);
  if (existsError) {
    console.error("[createTeamUser] auth_user_exists", existsError);
    return { error: "No se pudo comprobar el correo. Inténtalo de nuevo." };
  }

  if (exists) {
    const existingUser = await findAuthUserByEmail(service, email);
    if (!existingUser) return { error: EXISTING_ACCOUNT_LOOKUP_MESSAGE };
    if (await getMembership(service, workspaceId, existingUser.id)) {
      return { error: "Esta persona ya es miembro del espacio de trabajo." };
    }

    // Si pertenece a otros espacios, quien la agrega debe tener autoridad sobre
    // ella en todos (nunca se une en silencio a alguien que administra otro
    // espacio) y no puede ser Dueño ni Administrador en ninguno.
    const otherMemberships = await membershipsOf(service, existingUser.id);
    if (otherMemberships.length > 0) {
      const authority = crossWorkspaceAuthorityError({
        actorMemberships: await membershipsOf(service, ctx.user.id),
        targetMemberships: otherMemberships,
      });
      if (authority) return { error: authority };
      if (otherMemberships.some((m) => canManageTeam(m.role))) {
        return { error: EXISTING_ACCOUNT_PRIVILEGED_MESSAGE };
      }
    }

    const joinedAt = new Date().toISOString();
    const { error: addError } = await service
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: existingUser.id, role });
    if (addError) {
      console.error("[createTeamUser] re-add membership", addError.message);
      return { error: "No se pudo agregar a la persona. Inténtalo de nuevo." };
    }

    await logActivity(service as unknown as Db, {
      workspace_id: workspaceId,
      type: "config_changed",
      actor_id: ctx.user.id,
      to_value: role,
      meta: { action: "member_readded", entity: "team", user_id: existingUser.id, email, role },
    });

    const member = memberViewFromUser(existingUser, { userId: existingUser.id, role, joinedAt });
    const status = memberStatus(existingUser.last_sign_in_at);
    let delivery: AccessDelivery;
    if (!(await isMailConfigured(service))) {
      delivery = { sent: false, notConfigured: true, message: notConfiguredMessage(status) };
    } else {
      const link = await generateAccessLink(service, {
        email,
        type: accessLinkTypeFor(!!existingUser.email_confirmed_at),
        baseUrl,
        fullName: displayName(existingUser),
      });
      delivery = link.ok
        ? await deliverAccessLink(service, {
            to: email,
            name: displayName(existingUser),
            url: link.url,
            status,
            inviterName: inviterNameOf(ctx.user),
            workspaceName: ctx.workspace.name,
          })
        : { sent: false, notConfigured: false, message: link.error };
    }
    return { ok: true, outcome: "readded", member, delivery };
  }

  // Invitación pendiente: el trigger handle_new_user (00017) la ve y no crea un
  // espacio propio para la persona ni rechaza el alta.
  const { data: invite, error: inviteError } = await service
    .from("workspace_invites")
    .insert({
      workspace_id: workspaceId,
      email,
      role,
      invited_by: ctx.user.id,
      status: "pending",
    })
    .select("id")
    .single();

  if (inviteError || !invite) {
    console.error("[createTeamUser] invite", inviteError?.message);
    return { error: "No se pudo crear el usuario. Inténtalo de nuevo." };
  }

  const deleteInvite = () => service.from("workspace_invites").delete().eq("id", invite.id);
  const markAccepted = () =>
    service
      .from("workspace_invites")
      .update({ status: "accepted" })
      .eq("workspace_id", workspaceId)
      .eq("email", email)
      .eq("status", "pending");

  const joinedAt = new Date().toISOString();

  const link = await generateAccessLink(service, { email, type: "invite", baseUrl, fullName });
  if (!link.ok) {
    await deleteInvite();
    return { error: link.error };
  }

  const { error: memberError } = await service
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: link.user.id, role });
  if (memberError) {
    console.error("[createTeamUser] membership", memberError.message);
    // Sin membresía la cuenta quedaría huérfana: se deshace todo.
    await service.auth.admin.deleteUser(link.user.id);
    await deleteInvite();
    return { error: "No se pudo crear el usuario. Inténtalo de nuevo." };
  }
  await markAccepted();

  const member = memberViewFromUser(link.user, { userId: link.user.id, role, joinedAt });
  const delivery = await deliverAccessLink(service, {
    to: email,
    name: fullName,
    url: link.url,
    status: "pending",
    inviterName: inviterNameOf(ctx.user),
    workspaceName: ctx.workspace.name,
  });

  return { ok: true, outcome: "created", member, delivery };
}

/**
 * Envía por correo el enlace de acceso de un miembro: activación si nunca
 * entró, o restablecer contraseña si ya está activo.
 */
export async function sendAccessEmail(
  workspaceId: string,
  userId: string,
): Promise<{ error: string } | { ok: true; delivery: AccessDelivery }> {
  const auth = await managerContext(workspaceId);
  if (!auth.ok) return { error: auth.error };
  const { ctx, service } = auth;

  const membership = await getMembership(service, workspaceId, userId);
  if (!membership) return { error: "Esta persona ya no es miembro del espacio de trabajo." };

  const denied = sendAccessEmailError({ actorId: ctx.user.id, actorRole: ctx.role, targetId: userId });
  if (denied) return { error: denied };

  const authority = crossWorkspaceAuthorityError({
    actorMemberships: await membershipsOf(service, ctx.user.id),
    targetMemberships: await membershipsOf(service, userId),
  });
  if (authority) return { error: authority };

  const {
    data: { user: target },
  } = await service.auth.admin.getUserById(userId);
  if (!target?.email) return { error: "No encontramos el correo de esta persona." };

  const status = memberStatus(target.last_sign_in_at);

  // Sin correo configurado no se genera el enlace: así no se invalida uno que
  // ya se haya copiado y compartido.
  if (!(await isMailConfigured(service))) {
    return {
      ok: true,
      delivery: { sent: false, notConfigured: true, message: notConfiguredMessage(status) },
    };
  }

  const baseUrl = appBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (!baseUrl) return { error: APP_URL_MISSING_MESSAGE };

  const link = await generateAccessLink(service, {
    email: target.email,
    type: accessLinkTypeFor(!!target.email_confirmed_at),
    baseUrl,
    fullName: displayName(target),
  });
  if (!link.ok) return { error: link.error };

  const delivery = await deliverAccessLink(service, {
    to: target.email,
    name: displayName(target),
    url: link.url,
    status,
    inviterName: inviterNameOf(ctx.user),
    workspaceName: ctx.workspace.name,
  });
  return { ok: true, delivery };
}

/**
 * Genera un enlace de acceso nuevo para copiarlo (cuando no hay correo o falla
 * el envío). Cada llamada invalida el enlace anterior de esa persona.
 */
export async function copyAccessLink(
  workspaceId: string,
  userId: string,
): Promise<{ error: string } | { ok: true; url: string; type: AccessLinkType }> {
  const auth = await managerContext(workspaceId);
  if (!auth.ok) return { error: auth.error };
  const { ctx, service } = auth;

  const membership = await getMembership(service, workspaceId, userId);
  if (!membership) return { error: "Esta persona ya no es miembro del espacio de trabajo." };

  // El estado del objetivo (activo o pendiente) decide si se puede copiar el
  // enlace, así que se consulta antes de validar el permiso.
  const {
    data: { user: target },
  } = await service.auth.admin.getUserById(userId);
  if (!target) return { error: "No encontramos la cuenta de esta persona." };

  const targetMemberships = await membershipsOf(service, userId);
  const denied = copyAccessLinkError({
    actorId: ctx.user.id,
    actorRole: ctx.role,
    targetId: userId,
    targetRole: membership.role,
    targetActive: memberStatus(target.last_sign_in_at) === "active",
    targetMemberships,
  });
  if (denied) return { error: denied };

  const authority = crossWorkspaceAuthorityError({
    actorMemberships: await membershipsOf(service, ctx.user.id),
    targetMemberships,
  });
  if (authority) return { error: authority };

  const baseUrl = appBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (!baseUrl) return { error: APP_URL_MISSING_MESSAGE };

  if (!target.email) return { error: "No encontramos el correo de esta persona." };

  const link = await generateAccessLink(service, {
    email: target.email,
    type: accessLinkTypeFor(!!target.email_confirmed_at),
    baseUrl,
    fullName: displayName(target),
  });
  if (!link.ok) return { error: link.error };

  return { ok: true, url: link.url, type: link.type };
}

export async function removeTeamMember(workspaceId: string, userId: string) {
  const auth = await managerContext(workspaceId);
  if (!auth.ok) return { error: auth.error };
  const { ctx, service } = auth;

  const membership = await getMembership(service, workspaceId, userId);
  if (!membership) return { ok: true };

  const denied = removeMemberError({
    actorId: ctx.user.id,
    actorRole: ctx.role,
    targetId: userId,
    targetRole: membership.role,
  });
  if (denied) return { error: denied };

  const { error: deleteError } = await service
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (deleteError) {
    console.error("[removeTeamMember]", deleteError.message);
    return { error: "No se pudo quitar al miembro. Inténtalo de nuevo." };
  }

  // R2-2: su trabajo no se queda colgado de una persona que ya no está.
  try {
    await releaseMemberWork(service, { workspaceId, userId, actorId: ctx.user.id });
  } catch (err) {
    console.error("[removeTeamMember] reparto del trabajo", err);
  }

  return { ok: true };
}

/** Elimina una invitación pendiente del sistema anterior de enlaces. */
export async function revokeInvite(workspaceId: string, inviteId: string) {
  const auth = await managerContext(workspaceId);
  if (!auth.ok) return { error: auth.error };

  const { error: deleteError } = await auth.service
    .from("workspace_invites")
    .delete()
    .eq("id", inviteId)
    .eq("workspace_id", workspaceId);

  if (deleteError) {
    console.error("[revokeInvite]", deleteError.message);
    return { error: "No se pudo eliminar la invitación. Inténtalo de nuevo." };
  }

  return { ok: true };
}
