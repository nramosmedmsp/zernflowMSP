"use client";

import { useState, useSyncExternalStore } from "react";
import {
  Users,
  Mail,
  Crown,
  Shield,
  User,
  Trash2,
  X,
  Clock,
  Plus,
  Loader2,
  ArrowLeft,
  Copy,
  Check,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  inviteTeamMember,
  removeTeamMember,
  revokeInvite,
} from "@/lib/actions/team";
import Link from "next/link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDate } from "@/lib/format";
import { inviteUrl, roleLabel } from "@/lib/auth-helpers";

interface MemberDetail {
  userId: string;
  role: string;
  joinedAt: string;
  email: string;
  name: string;
}

interface PendingInvite {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  invited_by: string;
  status: string;
  created_at: string;
  expires_at: string;
}

const roleIcons: Record<string, React.ReactNode> = {
  owner: <Crown className="h-3 w-3" />,
  admin: <Shield className="h-3 w-3" />,
  member: <User className="h-3 w-3" />,
};

const roleStyles: Record<string, string> = {
  owner: "bg-amber-100 text-amber-700",
  admin: "bg-blue-100 text-blue-700",
  member: "bg-gray-100 text-gray-600",
};

const noopSubscribe = () => () => {};

/** Origen de la página; vacío durante el render del servidor. */
function useOrigin() {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => ""
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Navegadores sin permiso de portapapeles (o http): copia clásica.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyLinkButton({
  url,
  compact = false,
}: {
  url: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    if (!url) return;
    const ok = await copyText(url);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 2000);
  }

  const label =
    state === "copied" ? "Copiado" : state === "failed" ? "No se pudo copiar" : "Copiar enlace";

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!url}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border font-medium transition-colors hover:bg-muted disabled:opacity-50",
        compact ? "px-2 py-1 text-[11px]" : "px-3 py-2 text-xs"
      )}
      title="Copiar enlace de invitación"
    >
      {state === "copied" ? (
        <Check className="h-3.5 w-3.5 text-green-600" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}

export function TeamView({
  workspaceId,
  workspaceName,
  currentUserId,
  currentUserRole,
  members: initialMembers,
  pendingInvites: initialInvites,
}: {
  workspaceId: string;
  workspaceName: string;
  currentUserId: string;
  currentUserRole: string;
  members: MemberDetail[];
  pendingInvites: PendingInvite[];
}) {
  const isOwner = currentUserRole === "owner";
  const origin = useOrigin();

  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<PendingInvite | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Remove member
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; name: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || inviting) return;

    setInviting(true);
    setInviteError(null);
    setCreatedInvite(null);

    const result = await inviteTeamMember(workspaceId, inviteEmail, inviteRole);

    if (result.error) {
      setInviteError(result.error);
    } else if (result.invite) {
      const invite = result.invite as PendingInvite;
      setInvites((prev) => [invite, ...prev]);
      setInviteEmail("");
      setInviteRole("member");
      setCreatedInvite(invite);
    }

    setInviting(false);
  }

  async function handleRemove(userId: string) {
    setRemovingId(userId);
    setActionError(null);

    const result = await removeTeamMember(workspaceId, userId);

    if (result.error) {
      setActionError(result.error);
    } else {
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    }

    setRemovingId(null);
  }

  async function handleRevoke(inviteId: string) {
    setRevokingId(inviteId);
    setActionError(null);

    const result = await revokeInvite(inviteId);

    if (result.error) {
      setActionError(result.error);
    } else {
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
      setCreatedInvite((prev) => (prev?.id === inviteId ? null : prev));
    }

    setRevokingId(null);
  }

  const createdInviteUrl = createdInvite && origin ? inviteUrl(origin, createdInvite.id) : "";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Volver a Configuración"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Equipo</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Administra los miembros e invitaciones de {workspaceName}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
          {actionError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {actionError}
            </p>
          )}

          {/* Members list */}
          <section>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">
                Miembros ({members.length})
              </h2>
            </div>

            <div className="mt-4 space-y-2">
              {members.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {member.name}
                        </p>
                        {member.userId === currentUserId && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            (tú)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {member.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        roleStyles[member.role] ?? roleStyles.member
                      )}
                    >
                      {roleIcons[member.role] ?? roleIcons.member}
                      {roleLabel(member.role)}
                    </span>

                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      Desde el {formatDate(member.joinedAt)}
                    </span>

                    {isOwner && member.userId !== currentUserId && (
                      <button
                        onClick={() =>
                          setConfirmRemove({ userId: member.userId, name: member.name })
                        }
                        disabled={removingId === member.userId}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        title="Quitar miembro"
                      >
                        {removingId === member.userId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Invite section (owners only) */}
          {isOwner && (
            <>
              <hr className="border-border" />

              <section>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Invitar a un miembro</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Se genera un enlace personal para ese correo. Vence en 7 días.
                </p>

                <form onSubmit={handleInvite} className="mt-4 flex flex-wrap gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => {
                      setInviteEmail(e.target.value);
                      setInviteError(null);
                    }}
                    placeholder="correo@ejemplo.com"
                    required
                    className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="member">{roleLabel("member")}</option>
                    <option value="admin">{roleLabel("admin")}</option>
                  </select>
                  <button
                    type="submit"
                    disabled={!inviteEmail.trim() || inviting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {inviting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    {inviting ? "Creando..." : "Crear invitación"}
                  </button>
                </form>

                {inviteError && (
                  <p className="mt-2 text-xs text-destructive">{inviteError}</p>
                )}

                {createdInvite && (
                  <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/40">
                    <div className="flex items-center gap-2 text-sm font-medium text-green-800 dark:text-green-200">
                      <Link2 className="h-4 w-4" />
                      Invitación creada para {createdInvite.email}
                    </div>
                    <p className="mt-1 text-xs text-green-700 dark:text-green-300">
                      Comparte este enlace con la persona invitada. Vence en 7 días.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={createdInviteUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
                        aria-label="Enlace de invitación"
                      />
                      <CopyLinkButton url={createdInviteUrl} />
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          {/* Pending invites */}
          {invites.length > 0 && (
            <>
              <hr className="border-border" />

              <section>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">
                    Invitaciones pendientes ({invites.length})
                  </h2>
                </div>

                <div className="mt-4 space-y-2">
                  {invites.map((invite) => {
                    const isExpired =
                      new Date(invite.expires_at) < new Date();
                    return (
                      <div
                        key={invite.id}
                        className={cn(
                          "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4",
                          isExpired && "opacity-60"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {invite.email}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                                  roleStyles[invite.role] ?? roleStyles.member
                                )}
                              >
                                {roleIcons[invite.role] ?? roleIcons.member}
                                {roleLabel(invite.role)}
                              </span>
                              {isExpired ? (
                                <span className="text-[10px] text-destructive">
                                  Venció el {formatDate(invite.expires_at)}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">
                                  Vence el {formatDate(invite.expires_at)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {isOwner && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            {!isExpired && (
                              <CopyLinkButton
                                url={origin ? inviteUrl(origin, invite.id) : ""}
                                compact
                              />
                            )}
                            <button
                              onClick={() => setConfirmRevoke(invite.id)}
                              disabled={revokingId === invite.id}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                              title="Revocar invitación"
                            >
                              {revokingId === invite.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <X className="h-3.5 w-3.5" />
                              )}
                              Revocar
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!confirmRemove}
        title="Quitar miembro"
        message={`¿Seguro que quieres quitar a ${confirmRemove?.name ?? "este miembro"} del espacio de trabajo?`}
        confirmLabel="Quitar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          if (confirmRemove) handleRemove(confirmRemove.userId);
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
      <ConfirmDialog
        open={!!confirmRevoke}
        title="Revocar invitación"
        message="¿Seguro que quieres revocar esta invitación? El enlace dejará de funcionar."
        confirmLabel="Revocar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          if (confirmRevoke) handleRevoke(confirmRevoke);
          setConfirmRevoke(null);
        }}
        onCancel={() => setConfirmRevoke(null)}
      />
    </div>
  );
}
