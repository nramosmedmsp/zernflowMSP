"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Crown,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  Send,
  Shield,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  copyAccessLink,
  createTeamUser,
  removeTeamMember,
  revokeInvite,
  sendAccessEmail,
} from "@/lib/actions/team";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { roleLabel } from "@/lib/auth-helpers";
import {
  COPY_LINK_WARNING,
  MAIL_NOT_CONFIGURED_MESSAGE,
  MEMBER_STATUS_LABELS,
  canManageTeam,
  canManageMailSettings,
  copyAccessLinkError,
  removeMemberError,
  sendAccessEmailError,
  type TeamMemberView,
} from "@/lib/team-rules";

interface LegacyInvite {
  id: string;
  email: string;
  role: string;
  created_at: string | null;
  expires_at: string | null;
}

type Notice = { kind: "ok" | "warn" | "error"; text: string; offerCopy?: boolean };

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

const noticeStyles: Record<Notice["kind"], string> = {
  ok: "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200",
  warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
};

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

const smallButtonClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-muted disabled:opacity-50";

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

function NoticeBox({ notice }: { notice: Notice }) {
  return (
    <p className={cn("rounded-lg border px-3 py-2 text-xs", noticeStyles[notice.kind])}>
      {notice.text}
    </p>
  );
}

/**
 * Botón que genera un enlace de acceso nuevo (cada clic invalida el anterior),
 * lo copia y lo deja visible con la advertencia de compartirlo en privado.
 */
function AccessLinkButton({
  workspaceId,
  userId,
  label,
  warning,
}: {
  workspaceId: string;
  userId: string;
  label: string;
  warning: string;
}) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const toast = useToast();

  async function handleGenerate() {
    if (loading) return;
    setLoading(true);
    setCopied(null);
    try {
      const result = await copyAccessLink(workspaceId, userId);
      if ("error" in result) {
        toast.error(result.error);
        setUrl(null);
      } else {
        setUrl(result.url);
        const ok = await copyText(result.url);
        setCopied(ok);
        if (ok) toast.success("Enlace copiado");
      }
    } catch {
      toast.error("No se pudo generar el enlace. Inténtalo de nuevo.");
      setUrl(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyAgain() {
    if (!url) return;
    const ok = await copyText(url);
    setCopied(ok);
    if (ok) toast.success("Enlace copiado");
    else toast.error("No se pudo copiar. Cópialo a mano.");
  }

  return (
    <div className="w-full space-y-2">
      <button type="button" onClick={handleGenerate} disabled={loading} className={smallButtonClass}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
        {loading ? "Generando…" : label}
      </button>

      {url && (
        <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-[11px]"
              aria-label="Enlace de acceso"
            />
            <button type="button" onClick={handleCopyAgain} className={smallButtonClass}>
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copiado" : copied === false ? "Cópialo a mano" : "Copiar"}
            </button>
          </div>
          <p className="text-[11px] text-amber-900 dark:text-amber-200">{warning}</p>
        </div>
      )}
    </div>
  );
}

const RECOVERY_LINK_WARNING =
  "Compártelo solo por un canal privado; quien lo abra podrá entrar a la cuenta. Vence en 24 horas.";

export function TeamView({
  workspaceId,
  workspaceName,
  currentUserId,
  currentUserRole,
  members: initialMembers,
  legacyInvites: initialLegacyInvites,
  mailConfigured,
}: {
  workspaceId: string;
  workspaceName: string;
  currentUserId: string;
  currentUserRole: string;
  members: TeamMemberView[];
  legacyInvites: LegacyInvite[];
  mailConfigured: boolean;
}) {
  const isManager = canManageTeam(currentUserRole);
  const toast = useToast();

  const [members, setMembers] = useState(initialMembers);
  const [legacyInvites, setLegacyInvites] = useState(initialLegacyInvites);

  // Crear usuario
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ userId: string; notice: Notice } | null>(null);

  // Acciones por fila
  const [busy, setBusy] = useState<Record<string, string | undefined>>({});
  const [rowNotices, setRowNotices] = useState<Record<string, Notice | undefined>>({});
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; name: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  function setRowBusy(id: string, action: string | undefined) {
    setBusy((prev) => ({ ...prev, [id]: action }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreated(null);

    try {
      const result = await createTeamUser(workspaceId, { fullName, email, role });

      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(result.outcome === "readded" ? "Persona agregada de nuevo al espacio" : "Usuario creado");
        setMembers((prev) => [...prev, result.member]);
        setFullName("");
        setEmail("");
        setRole("member");
        if (result.delivery.sent) {
          setCreated({
            userId: result.member.userId,
            notice: { kind: "ok", text: result.delivery.message },
          });
        } else {
          setCreated({
            userId: result.member.userId,
            notice: { kind: "warn", text: result.delivery.message, offerCopy: true },
          });
        }
      }
    } catch {
      toast.error("No se pudo crear el usuario. Inténtalo de nuevo.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSendAccess(member: TeamMemberView) {
    setRowBusy(member.userId, "send");
    setRowNotices((prev) => ({ ...prev, [member.userId]: undefined }));

    try {
      const result = await sendAccessEmail(workspaceId, member.userId);
      let notice: Notice | undefined;
      if ("error" in result) {
        toast.error(result.error);
      } else if (result.delivery.sent) {
        notice = { kind: "ok", text: result.delivery.message };
        toast.success("Correo enviado");
      } else {
        notice = { kind: "warn", text: result.delivery.message, offerCopy: true };
      }
      setRowNotices((prev) => ({ ...prev, [member.userId]: notice }));
    } catch {
      toast.error("No se pudo enviar el correo. Inténtalo de nuevo.");
    } finally {
      setRowBusy(member.userId, undefined);
    }
  }

  async function handleRemove(userId: string) {
    setRowBusy(userId, "remove");
    try {
      const result = await removeTeamMember(workspaceId, userId);
      if (result.error) {
        toast.error(result.error);
      } else {
        setMembers((prev) => prev.filter((m) => m.userId !== userId));
        setCreated((prev) => (prev?.userId === userId ? null : prev));
        toast.success("Miembro quitado");
      }
    } catch {
      toast.error("No se pudo quitar al miembro. Inténtalo de nuevo.");
    } finally {
      setRowBusy(userId, undefined);
    }
  }

  async function handleRevoke(inviteId: string) {
    setRowBusy(inviteId, "revoke");
    try {
      const result = await revokeInvite(workspaceId, inviteId);
      if (result.error) {
        toast.error(result.error);
      } else {
        setLegacyInvites((prev) => prev.filter((i) => i.id !== inviteId));
        toast.success("Invitación eliminada");
      }
    } catch {
      toast.error("No se pudo eliminar la invitación. Inténtalo de nuevo.");
    } finally {
      setRowBusy(inviteId, undefined);
    }
  }

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
              Administra los miembros de {workspaceName}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
          {/* Crear usuario (Dueño y Administradores) */}
          {isManager && (
            <section>
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Crear usuario</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {mailConfigured
                  ? "Le llegará un correo para activar su cuenta y crear su contraseña."
                  : "El correo aún no está configurado: podrás copiar el enlace de activación y compartirlo por un canal privado."}
              </p>

              <form onSubmit={handleCreate} noValidate className="mt-4 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                    }}
                    placeholder="Nombre y apellido"
                    required
                    maxLength={100}
                    autoComplete="off"
                    className={cn(inputClass, "min-w-0 flex-1 basis-48")}
                    aria-label="Nombre"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                    }}
                    placeholder="correo@ejemplo.com"
                    required
                    autoComplete="off"
                    className={cn(inputClass, "min-w-0 flex-1 basis-48")}
                    aria-label="Correo"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className={inputClass}
                    aria-label="Rol"
                  >
                    <option value="member">{roleLabel("member")}</option>
                    <option value="admin">{roleLabel("admin")}</option>
                  </select>
                  <button
                    type="submit"
                    disabled={!fullName.trim() || !email.trim() || creating}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    {creating ? "Creando…" : "Crear usuario"}
                  </button>
                </div>
              </form>

              {created && (
                <div className="mt-4 space-y-2">
                  <NoticeBox notice={created.notice} />
                  {created.notice.offerCopy && (
                    <AccessLinkButton
                      workspaceId={workspaceId}
                      userId={created.userId}
                      label="Copiar enlace de activación"
                      warning={COPY_LINK_WARNING}
                    />
                  )}
                </div>
              )}
            </section>
          )}

          {isManager && <hr className="border-border" />}

          {/* Miembros */}
          <section>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Miembros ({members.length})</h2>
            </div>

            <div className="mt-4 space-y-2">
              {members.map((member) => {
                const isSelf = member.userId === currentUserId;
                const pending = member.status === "pending";
                const actor = {
                  actorId: currentUserId,
                  actorRole: currentUserRole,
                  targetId: member.userId,
                  targetRole: member.role,
                };
                const canSend = isManager && sendAccessEmailError(actor) === null;
                const copyError = isManager
                  ? copyAccessLinkError({ ...actor, targetActive: !pending })
                  : null;
                const canCopy = isManager && copyError === null;
                // Solo la regla de "cuenta activa" bloquea con motivo visible;
                // para uno mismo o el Dueño el botón simplemente no aparece.
                const copyBlockedByActive =
                  isManager &&
                  copyError !== null &&
                  copyAccessLinkError({ ...actor, targetActive: false }) === null;
                const canRemove = isManager && removeMemberError(actor) === null;
                const notice = rowNotices[member.userId];
                const rowBusy = busy[member.userId];

                // Activos: con correo, se envía el enlace; sin correo, se copia.
                const showSendButton = canSend && (pending || mailConfigured);
                const showCopyButton =
                  canCopy && (pending || !mailConfigured || !!notice?.offerCopy);
                const showBlockedCopyButton =
                  copyBlockedByActive && (!mailConfigured || !!notice?.offerCopy);

                return (
                  <div
                    key={member.userId}
                    className="space-y-3 rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">{member.name}</p>
                            {isSelf && (
                              <span className="shrink-0 text-[10px] text-muted-foreground">(tú)</span>
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            roleStyles[member.role] ?? roleStyles.member
                          )}
                        >
                          {roleIcons[member.role] ?? roleIcons.member}
                          {roleLabel(member.role)}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            pending
                              ? "bg-amber-100 text-amber-800"
                              : "bg-green-100 text-green-800"
                          )}
                        >
                          {pending && <Clock className="h-3 w-3" />}
                          {MEMBER_STATUS_LABELS[member.status]}
                        </span>
                        <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                          {pending ? "Creado el" : "Desde el"} {formatDate(member.joinedAt)}
                        </span>

                        {canRemove && (
                          <button
                            onClick={() => setConfirmRemove({ userId: member.userId, name: member.name })}
                            disabled={!!rowBusy}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            title="Quitar miembro"
                          >
                            {rowBusy === "remove" ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {(showSendButton || showCopyButton || showBlockedCopyButton) && (
                      <div className="flex flex-wrap items-start gap-2 border-t border-border pt-3">
                        {showSendButton && (
                          <button
                            type="button"
                            onClick={() => handleSendAccess(member)}
                            disabled={!!rowBusy}
                            className={smallButtonClass}
                          >
                            {rowBusy === "send" ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : pending ? (
                              <Send className="h-3.5 w-3.5" />
                            ) : (
                              <KeyRound className="h-3.5 w-3.5" />
                            )}
                            {pending ? "Reenviar invitación" : "Enviar enlace para restablecer contraseña"}
                          </button>
                        )}
                        {showCopyButton && (
                          <AccessLinkButton
                            workspaceId={workspaceId}
                            userId={member.userId}
                            label={
                              pending
                                ? "Copiar enlace de activación"
                                : "Copiar enlace para restablecer contraseña"
                            }
                            warning={pending ? COPY_LINK_WARNING : RECOVERY_LINK_WARNING}
                          />
                        )}
                        {showBlockedCopyButton && (
                          <button
                            type="button"
                            disabled
                            title={copyError ?? undefined}
                            className={smallButtonClass}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copiar enlace para restablecer contraseña
                          </button>
                        )}
                        {notice && (
                          <div className="w-full">
                            <NoticeBox notice={notice} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {isManager && !mailConfigured && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {canManageMailSettings(currentUserRole)
                    ? MAIL_NOT_CONFIGURED_MESSAGE
                    : "El correo aún no está configurado. Pide al Dueño que lo configure."}{" "}
                  {canManageMailSettings(currentUserRole) && (
                    <Link href="/dashboard/settings/correo" className="font-medium text-foreground hover:underline">
                      Ir a Correo
                    </Link>
                  )}
                </span>
              </p>
            )}
          </section>

          {/* Invitaciones del sistema anterior */}
          {isManager && legacyInvites.length > 0 && (
            <>
              <hr className="border-border" />

              <section>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">
                    Invitaciones antiguas sin usar ({legacyInvites.length})
                  </h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Son del sistema anterior de enlaces y ya no sirven para entrar. Elimínalas; si esa
                  persona necesita acceso, créala arriba como usuario.
                </p>

                <div className="mt-4 space-y-2">
                  {legacyInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{invite.email}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {roleLabel(invite.role)}
                          {invite.created_at && ` · creada el ${formatDate(invite.created_at)}`}
                        </p>
                      </div>
                      <button
                        onClick={() => setConfirmRevoke(invite.id)}
                        disabled={!!busy[invite.id]}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        title="Eliminar invitación"
                      >
                        {busy[invite.id] ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                        Eliminar
                      </button>
                    </div>
                  ))}
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
        title="Eliminar invitación"
        message="¿Seguro que quieres eliminar esta invitación antigua?"
        confirmLabel="Eliminar"
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
