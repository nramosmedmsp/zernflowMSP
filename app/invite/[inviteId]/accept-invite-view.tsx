"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users, Crown, Shield, User, Loader2, LogOut } from "lucide-react";
import { acceptInvite, signUpWithInvite, type InviteSignUpState } from "@/lib/actions/team";
import { createClient } from "@/lib/supabase/client";
import { BrandLogo } from "@/lib/brand-logo";
import { MIN_PASSWORD_LENGTH, roleLabel } from "@/lib/auth-helpers";
import { formatDate } from "@/lib/format";

export type InviteMode = "accept" | "mismatch" | "login" | "signup";

const roleIcons: Record<string, React.ReactNode> = {
  owner: <Crown className="h-3.5 w-3.5" />,
  admin: <Shield className="h-3.5 w-3.5" />,
  member: <User className="h-3.5 w-3.5" />,
};

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const primaryButtonClass =
  "flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";

export function AcceptInviteView({
  mode,
  inviteId,
  workspaceName,
  inviterName,
  role,
  email,
  expiresAt,
  currentUserEmail,
}: {
  mode: InviteMode;
  inviteId: string;
  workspaceName: string;
  inviterName: string;
  role: string;
  email: string;
  expiresAt: string;
  currentUserEmail: string | null;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandLogo size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Te invitaron</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {inviterName} te invitó a unirte a
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <h2 className="mt-3 text-lg font-semibold">{workspaceName}</h2>
          <div className="mt-2 flex items-center justify-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
              {roleIcons[role] ?? roleIcons.member}
              {roleLabel(role)}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Invitación para {email}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Vence el {formatDate(expiresAt)}
          </p>
        </div>

        {mode === "accept" && <AcceptSection inviteId={inviteId} />}
        {mode === "mismatch" && (
          <MismatchSection currentUserEmail={currentUserEmail} email={email} />
        )}
        {mode === "login" && <LoginSection inviteId={inviteId} />}
        {mode === "signup" && <SignUpSection inviteId={inviteId} email={email} />}
      </div>
    </div>
  );
}

function AcceptSection({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    if (accepting) return;
    setAccepting(true);
    setError(null);

    const result = await acceptInvite(inviteId);

    if (result.error) {
      setError(result.error);
      setAccepting(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <button onClick={handleAccept} disabled={accepting} className={primaryButtonClass}>
        {accepting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Aceptando...
          </>
        ) : (
          "Aceptar invitación"
        )}
      </button>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}

function MismatchSection({
  currentUserEmail,
  email,
}: {
  currentUserEmail: string | null;
  email: string;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    // Al recargar, la misma página ofrece iniciar sesión o crear la cuenta correcta.
    router.refresh();
    setSigningOut(false);
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center dark:border-amber-900 dark:bg-amber-950/40">
      <p className="text-sm text-amber-800 dark:text-amber-200">
        Iniciaste sesión como <span className="font-medium">{currentUserEmail}</span>, pero
        esta invitación es para <span className="font-medium">{email}</span>.
      </p>
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
        Cierra sesión y vuelve a abrir el enlace con el correo invitado.
      </p>
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:bg-transparent dark:text-amber-200"
      >
        {signingOut ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LogOut className="h-4 w-4" />
        )}
        Cerrar sesión
      </button>
    </div>
  );
}

function LoginSection({ inviteId }: { inviteId: string }) {
  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-muted-foreground">
        Ya tienes una cuenta con este correo. Inicia sesión para aceptar la invitación.
      </p>
      <Link
        href={`/login?next=${encodeURIComponent(`/invite/${inviteId}`)}`}
        className={primaryButtonClass}
      >
        Iniciar sesión para aceptar
      </Link>
    </div>
  );
}

const initialSignUpState: InviteSignUpState = { error: null };

function SignUpSection({ inviteId, email }: { inviteId: string; email: string }) {
  const [state, formAction, pending] = useActionState(signUpWithInvite, initialSignUpState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Crea tu cuenta</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Con esta cuenta entrarás al espacio de trabajo.
        </p>
      </div>

      <input type="hidden" name="inviteId" value={inviteId} />

      <div>
        <label htmlFor="invite-email" className="mb-1.5 block text-sm font-medium">
          Correo
        </label>
        <input
          id="invite-email"
          type="email"
          value={email}
          readOnly
          disabled
          className={`${inputClass} cursor-not-allowed bg-muted text-muted-foreground`}
        />
      </div>

      <div>
        <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium">
          Nombre
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          required
          maxLength={100}
          autoComplete="name"
          className={inputClass}
          placeholder="Tu nombre y apellido"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          className={inputClass}
          placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
        />
      </div>

      <div>
        <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium">
          Confirma tu contraseña
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          className={inputClass}
          placeholder="Repite la contraseña"
        />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creando tu cuenta...
          </>
        ) : (
          "Crear cuenta y entrar"
        )}
      </button>
    </form>
  );
}
