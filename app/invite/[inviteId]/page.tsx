import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/lib/brand-logo";

export const metadata: Metadata = {
  title: "Invitación",
  robots: { index: false, follow: false },
};

// Los enlaces /invite/<id> del sistema anterior ya no crean cuentas: ahora un
// administrador crea el usuario y el enlace de activación llega por correo.
export default function InvitePage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <BrandLogo size={48} className="mx-auto mb-3" />
        <h1 className="text-2xl font-bold">Las invitaciones llegan por correo</h1>
        <p className="text-sm text-muted-foreground">
          Este enlace ya no se usa. Ahora un administrador crea tu usuario y te llega un correo para
          activar tu cuenta y crear tu contraseña. Si ya la activaste, inicia sesión.
        </p>
        <Link
          href="/login"
          className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Ir a iniciar sesión
        </Link>
      </div>
    </div>
  );
}
