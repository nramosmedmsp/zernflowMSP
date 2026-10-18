import type { Metadata } from "next";
import Link from "next/link";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { rpcAuthUserExists } from "@/lib/supabase/extra-rpc";
import { isInviteUsable, sameEmail } from "@/lib/auth-helpers";
import { BrandLogo } from "@/lib/brand-logo";
import { AcceptInviteView, type InviteMode } from "./accept-invite-view";

export const metadata: Metadata = {
  title: "Invitación",
  robots: { index: false, follow: false },
};

// Siempre se evalúa en cada visita: depende de la sesión y del estado de la invitación.
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function InviteMessage({
  title,
  message,
  href,
  cta,
}: {
  title: string;
  message: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <BrandLogo size={48} className="mx-auto mb-3" />
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link
          href={href}
          className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ inviteId: string }>;
}) {
  const { inviteId } = await params;
  const supabase = await createClient();
  const serviceClient = await createServiceClient();

  // Página pública: la invitación se lee con el cliente de servicio.
  const { data: invite } = UUID_RE.test(inviteId)
    ? await serviceClient
        .from("workspace_invites")
        .select("*")
        .eq("id", inviteId)
        .maybeSingle()
    : { data: null };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!invite) {
    return (
      <InviteMessage
        title="Invitación no encontrada"
        message="El enlace no es válido o la invitación fue revocada. Pide a un administrador que te comparta uno nuevo."
        href={user ? "/dashboard" : "/login"}
        cta={user ? "Ir al panel" : "Ir a iniciar sesión"}
      />
    );
  }

  if (invite.status !== "pending") {
    return (
      <InviteMessage
        title="Invitación ya usada"
        message="Esta invitación ya fue aceptada. Si es tuya, inicia sesión para entrar."
        href={user ? "/dashboard" : "/login"}
        cta={user ? "Ir al panel" : "Iniciar sesión"}
      />
    );
  }

  if (!isInviteUsable(invite)) {
    return (
      <InviteMessage
        title="Invitación vencida"
        message="Esta invitación venció. Pide a un administrador que te comparta un enlace nuevo."
        href={user ? "/dashboard" : "/login"}
        cta={user ? "Ir al panel" : "Ir a iniciar sesión"}
      />
    );
  }

  const { data: workspace } = await serviceClient
    .from("workspaces")
    .select("name")
    .eq("id", invite.workspace_id)
    .single();

  const {
    data: { user: inviter },
  } = await serviceClient.auth.admin.getUserById(invite.invited_by);

  const inviterName: string =
    inviter?.user_metadata?.full_name ??
    inviter?.user_metadata?.name ??
    inviter?.email ??
    "Un administrador";

  let mode: InviteMode;
  if (user) {
    mode = sameEmail(user.email, invite.email) ? "accept" : "mismatch";
  } else {
    const { exists, error } = await rpcAuthUserExists(serviceClient, invite.email);
    if (error) console.error("[invite] auth_user_exists", error);
    // Ante un error, mejor mandar a iniciar sesión que ofrecer crear una cuenta duplicada.
    mode = exists || error ? "login" : "signup";
  }

  return (
    <AcceptInviteView
      mode={mode}
      inviteId={invite.id}
      workspaceName={workspace?.name ?? "un espacio de trabajo"}
      inviterName={inviterName}
      role={invite.role}
      email={invite.email}
      expiresAt={invite.expires_at}
      currentUserEmail={user?.email ?? null}
    />
  );
}
