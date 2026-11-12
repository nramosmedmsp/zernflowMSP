"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { releaseMemberWork } from "@/lib/cases/member-removal";
import { logActivity, type Db } from "@/lib/cases/io";
import { logAudit } from "@/lib/audit";
import { isRoleDowngrade, revokeUserSessions } from "@/lib/session-revoke";
import { rpcAuthUserExists } from "@/lib/supabase/extra-rpc";
import { findAuthUserByEmail, generateAccessLink } from "@/lib/supabase/admin-users";
import type { WorkspaceRole } from "@/lib/types/database";
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
  editMemberError,
  isGrantableRole,
  canEditMembers,
  sameEmailAddress,
  EDIT_MEMBER_DENIED_MESSAGE,
  LAST_OWNER_MESSAGE,
  OWNER_GRANT_DENIED_MESSAGE,
  OTHER_WORKSPACE_PROMOTION_MESSAGE,
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
    /** Persona que vuelve al espacio: el mensaje lo dice explícitamente. */
    readded?: boolean;
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
    if (params.readded) {
      return {
        sent: true,
        message: activation
          ? `Se volvió a agregar a ${params.name} y se le envió un correo a ${params.to} para que active su cuenta y cree su contraseña.`
          : `Se volvió a agregar a ${params.name} y se le envió un enlace para restablecer su contraseña.`,
      };
    }
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
    message: `${params.readded ? `Se volvió a agregar a ${params.name}, pero no se pudo enviarle el correo: ` : "No se pudo enviar el correo: "}${result.error} Corrígelo en Configuración → Correo y vuelve a intentarlo${params.status === "pending" ? ", o copia el enlace" : ", o pide a un Dueño que genere el enlace"}.`,
  };
}

function notConfiguredMessage(status: MemberStatus): string {
  return status === "pending"
    ? MAIL_NOT_CONFIGURED_MESSAGE
    : "El correo aún no está configurado. Configúralo en Configuración → Correo. Si necesitas el enlace de una cuenta activa, pide a un Dueño que lo genere.";
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

/** Cuántos Dueños tiene hoy el espacio. */
async function ownerCountOf(service: ServiceClient, workspaceId: string): Promise<number> {
  const { data } = await service
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner");
  return (data ?? []).length;
}

/** El trigger de la base (00039) rechaza dejar un espacio sin Dueño. */
function isLastOwnerDbError(error: { message?: string } | null | undefined): boolean {
  return !!error?.message?.includes("last_owner_required");
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

  if (input.role === "owner" && ctx.role !== "owner") return { error: OWNER_GRANT_DENIED_MESSAGE };
  if (!isGrantableRole(input.role, ctx.role)) {
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

    const member = memberViewFromUser(existingUser, { userId: existingUser.id, role, joinedAt });
    // Quien vuelve siempre recibe un enlace para crear una contraseña nueva
    // (recuperación). Solo si su correo nunca se confirmó, Supabase no permite
    // recuperación y se le manda la activación.
    const confirmed = !!existingUser.email_confirmed_at;
    const status: MemberStatus = confirmed ? "active" : "pending";
    const readdedName = displayName(existingUser);
    let delivery: AccessDelivery;
    if (!(await isMailConfigured(service))) {
      delivery = {
        sent: false,
        notConfigured: true,
        message: `Se volvió a agregar a ${readdedName}, pero el correo aún no está configurado, así que no se le envió el enlace para restablecer su contraseña. Configúralo en Configuración → Correo y envíaselo desde su fila.`,
      };
    } else {
      const link = await generateAccessLink(service, {
        email,
        type: accessLinkTypeFor(confirmed),
        baseUrl,
        fullName: readdedName,
      });
      delivery = link.ok
        ? await deliverAccessLink(service, {
            to: email,
            name: readdedName,
            url: link.url,
            status,
            inviterName: inviterNameOf(ctx.user),
            workspaceName: ctx.workspace.name,
            readded: true,
          })
        : { sent: false, notConfigured: false, message: link.error };
    }

    await logActivity(service as unknown as Db, {
      workspace_id: workspaceId,
      type: "config_changed",
      actor_id: ctx.user.id,
      to_value: role,
      meta: {
        action: "member_readded",
        entity: "team",
        user_id: existingUser.id,
        email,
        role,
        reset_link_sent: delivery.sent,
      },
    });
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

  // SEG-05: alta de un usuario nuevo, con su rol (nunca el enlace de acceso).
  await logAudit(service, {
    workspaceId,
    actorId: ctx.user.id,
    action: "member_created",
    entity: "team",
    toValue: role,
    meta: { user_id: link.user.id, email, role },
  });

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
    currentWorkspaceId: workspaceId,
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
  // SEG-05: se generó un enlace de acceso nuevo (invalida el anterior). Sin la URL.
  await logAudit(service, {
    workspaceId,
    actorId: ctx.user.id,
    action: "access_email_sent",
    entity: "team",
    meta: { user_id: userId, target_role: membership.role, link_type: link.type, email_sent: delivery.sent },
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
    currentWorkspaceId: workspaceId,
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

  // SEG-05: quien genera el enlace para copiarlo queda registrado (sin la URL).
  await logAudit(service, {
    workspaceId,
    actorId: ctx.user.id,
    action: "access_link_copied",
    entity: "team",
    meta: { user_id: userId, target_role: membership.role, link_type: link.type },
  });

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
    ownerCount: await ownerCountOf(service, workspaceId),
  });
  if (denied) return { error: denied };

  // Registro de cambios: el nombre y el correo se leen ANTES de borrar, para que la pantalla
  // pueda decir a quién se quitó aunque la cuenta ya no exista después.
  let removedName: string | null = null;
  let removedEmail: string | null = null;
  try {
    const {
      data: { user: removedUser },
    } = await service.auth.admin.getUserById(userId);
    if (removedUser) {
      removedName = displayName(removedUser);
      removedEmail = removedUser.email ?? null;
    }
  } catch {
    // sin nombre: la pantalla usará la frase general
  }

  const { error: deleteError } = await service
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (deleteError) {
    // Otro Dueño pudo salir justo antes: la base no deja el espacio sin Dueño.
    if (isLastOwnerDbError(deleteError)) return { error: LAST_OWNER_MESSAGE };
    console.error("[removeTeamMember]", deleteError.message);
    return { error: "No se pudo quitar al miembro. Inténtalo de nuevo." };
  }

  // SEG-09: se cierran sus sesiones abiertas (ver lib/session-revoke.ts).
  const sessionsRevoked = await revokeUserSessions(service, userId);

  await logActivity(service as unknown as Db, {
    workspace_id: workspaceId,
    type: "config_changed",
    actor_id: ctx.user.id,
    from_value: membership.role,
    meta: {
      action: "member_removed",
      entity: "team",
      user_id: userId,
      role: membership.role,
      sessions_revoked: sessionsRevoked,
      ...(removedName ? { name: removedName } : {}),
      ...(removedEmail ? { email: removedEmail } : {}),
    },
  });

  // R2-2: su trabajo no se queda colgado de una persona que ya no está.
  try {
    await releaseMemberWork(service, { workspaceId, userId, actorId: ctx.user.id });
  } catch (err) {
    console.error("[removeTeamMember] reparto del trabajo", err);
  }

  return { ok: true };
}

export type UpdateTeamMemberResult =
  | { error: string }
  | {
      ok: true;
      member: TeamMemberView;
      emailChanged: boolean;
      /** Solo si cambió el correo: qué pasó con el enlace de acceso al correo nuevo. */
      delivery: AccessDelivery | null;
    };

/**
 * Edita nombre, correo y rol de una persona del espacio. Solo un Dueño. Al
 * cambiar el correo se actualiza la cuenta de acceso (Auth) y se envía el
 * enlace de acceso al correo nuevo con el mismo mecanismo que "Enviar acceso";
 * sin correo de la app configurado se devuelve el aviso para copiar el enlace.
 * Cada cambio queda en la actividad con quién lo hizo.
 */
export async function updateTeamMember(
  workspaceId: string,
  userId: string,
  input: { fullName: string; email: string; role: string },
): Promise<UpdateTeamMemberResult> {
  const auth = await managerContext(workspaceId);
  if (!auth.ok) return { error: auth.error };
  const { ctx, service } = auth;
  if (!canEditMembers(ctx.role)) return { error: EDIT_MEMBER_DENIED_MESSAGE };

  const membership = await getMembership(service, workspaceId, userId);
  if (!membership) return { error: "Esta persona ya no es miembro del espacio de trabajo." };

  const nameCheck = normalizeFullName(input.fullName);
  if (nameCheck.error !== null) return { error: nameCheck.error };
  const fullName = nameCheck.name;

  const email = normalizeEmail(input.email);
  if (!email) return { error: "Escribe un correo válido." };

  const roleDenied = editMemberError({
    actorId: ctx.user.id,
    actorRole: ctx.role,
    targetId: userId,
    targetRole: membership.role,
    newRole: input.role,
    ownerCount: await ownerCountOf(service, workspaceId),
  });
  if (roleDenied) return { error: roleDenied };
  const newRole = input.role as WorkspaceRole;
  const roleChanged = newRole !== membership.role;

  const {
    data: { user: target },
  } = await service.auth.admin.getUserById(userId);
  if (!target?.email) return { error: "No encontramos la cuenta de esta persona." };

  // Cambiar el correo o el nombre afecta a todos los espacios de la persona:
  // en los otros espacios, quien edita debe tener autoridad sobre ella. Y, como
  // al agregarla, no se ascienda a Administrador o Dueño a quien pertenece a
  // otro espacio.
  const otherMemberships = (await membershipsOf(service, userId)).filter(
    (m) => m.workspaceId !== workspaceId,
  );
  if (otherMemberships.length > 0) {
    const authority = crossWorkspaceAuthorityError({
      actorMemberships: await membershipsOf(service, ctx.user.id),
      targetMemberships: otherMemberships,
    });
    if (authority) return { error: authority };
    const order = ["member", "admin", "owner"];
    if (order.indexOf(newRole) > order.indexOf(membership.role)) {
      return { error: OTHER_WORKSPACE_PROMOTION_MESSAGE };
    }
  }

  const emailChanged = !sameEmailAddress(target.email, email);
  const nameChanged = fullName !== displayName(target);

  if (emailChanged) {
    const { exists, error: existsError } = await rpcAuthUserExists(service, email);
    if (existsError) {
      console.error("[updateTeamMember] auth_user_exists", existsError);
      return { error: "No se pudo comprobar el correo. Inténtalo de nuevo." };
    }
    if (exists) return { error: "Ya existe una cuenta con ese correo." };
  }

  const baseUrl = emailChanged ? appBaseUrl(process.env.NEXT_PUBLIC_APP_URL) : null;
  if (emailChanged && !baseUrl) return { error: APP_URL_MISSING_MESSAGE };

  if (roleChanged) {
    const { error: roleError } = await service
      .from("workspace_members")
      .update({ role: newRole })
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    if (roleError) {
      if (isLastOwnerDbError(roleError)) return { error: LAST_OWNER_MESSAGE };
      console.error("[updateTeamMember] role", roleError.message);
      return { error: "No se pudo cambiar el rol. Inténtalo de nuevo." };
    }
  }

  let updatedUser = target;
  if (emailChanged || nameChanged) {
    const { data, error: authError } = await service.auth.admin.updateUserById(userId, {
      ...(emailChanged ? { email, email_confirm: !!target.email_confirmed_at } : {}),
      user_metadata: { ...(target.user_metadata ?? {}), full_name: fullName },
    });
    if (authError || !data?.user) {
      console.error("[updateTeamMember] auth", authError?.message);
      if (roleChanged) {
        // Deshace el rol para no dejar la edición a medias.
        await service
          .from("workspace_members")
          .update({ role: membership.role })
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId);
      }
      const taken = /already|registered|exists/i.test(authError?.message ?? "");
      return {
        error: taken
          ? "Ya existe una cuenta con ese correo."
          : "No se pudo actualizar la cuenta. Inténtalo de nuevo.",
      };
    }
    updatedUser = data.user;
  }

  // SEG-09: cambiar el correo o bajar el rol cierra las sesiones abiertas de la persona.
  const mustRevoke = emailChanged || (roleChanged && isRoleDowngrade(membership.role, newRole));
  const sessionsRevoked = mustRevoke ? await revokeUserSessions(service, userId) : undefined;

  const base = { workspace_id: workspaceId, type: "config_changed" as const, actor_id: ctx.user.id };
  const logs = [];
  if (nameChanged) {
    logs.push({
      ...base,
      from_value: displayName(target),
      to_value: fullName,
      meta: { action: "member_renamed", entity: "team", user_id: userId },
    });
  }
  if (emailChanged) {
    logs.push({
      ...base,
      from_value: target.email,
      to_value: email,
      meta: { action: "member_email_changed", entity: "team", user_id: userId, sessions_revoked: sessionsRevoked ?? false },
    });
  }
  if (roleChanged) {
    logs.push({
      ...base,
      from_value: membership.role,
      to_value: newRole,
      meta: {
        action: "member_role_changed",
        entity: "team",
        user_id: userId,
        ...(sessionsRevoked !== undefined ? { sessions_revoked: sessionsRevoked } : {}),
      },
    });
  }
  if (logs.length > 0) await logActivity(service as unknown as Db, logs);

  let delivery: AccessDelivery | null = null;
  if (emailChanged && baseUrl) {
    const status = memberStatus(updatedUser.last_sign_in_at);
    if (!(await isMailConfigured(service))) {
      delivery = { sent: false, notConfigured: true, message: notConfiguredMessage(status) };
    } else {
      const link = await generateAccessLink(service, {
        email,
        type: accessLinkTypeFor(!!updatedUser.email_confirmed_at),
        baseUrl,
        fullName,
      });
      delivery = link.ok
        ? await deliverAccessLink(service, {
            to: email,
            name: fullName,
            url: link.url,
            status,
            inviterName: inviterNameOf(ctx.user),
            workspaceName: ctx.workspace.name,
          })
        : { sent: false, notConfigured: false, message: link.error };
    }
  }

  const member = memberViewFromUser(updatedUser, {
    userId,
    role: newRole,
    joinedAt: membership.created_at,
  });
  return { ok: true, member, emailChanged, delivery };
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
