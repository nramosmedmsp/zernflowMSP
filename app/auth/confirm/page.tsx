import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/lib/brand-logo";
import { APP_NAME } from "@/lib/brand";
import { parseEmailOtpType } from "@/lib/auth-helpers";

export const metadata: Metadata = {
  title: "Confirmar enlace",
  robots: { index: false, follow: false },
};

// Esta página NO verifica nada. El token de los enlaces es de un solo uso y las
// vistas previas de WhatsApp y los filtros de correo abren los enlaces antes que
// la persona: si el GET lo gastara, el enlace llegaría vencido. El token solo se
// valida cuando la persona pulsa «Continuar» (POST a /auth/confirm/verificar).
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{
    token_hash?: string | string[];
    type?: string | string[];
    next?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const tokenHash = first(params.token_hash);
  const type = parseEmailOtpType(first(params.type));
  const next = first(params.next) ?? "";

  const title =
    type === "invite" || type === "signup"
      ? "Activa tu cuenta"
      : type === "recovery"
        ? "Restablece tu contraseña"
        : "Continúa para entrar";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandLogo size={48} className="mx-auto mb-3" />
          {tokenHash && type ? (
            <>
              <h1 className="text-2xl font-bold">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{APP_NAME}</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold">{APP_NAME}</h1>
              <p className="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                El enlace no es válido. Pide uno nuevo a un administrador.
              </p>
            </>
          )}
        </div>

        {tokenHash && type ? (
          <form method="post" action="/auth/confirm/verificar" className="space-y-4">
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Continuar
            </button>
          </form>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="text-primary hover:underline">
              Ir a iniciar sesión
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
