import type { Metadata } from "next";
import { BrandLogo } from "@/lib/brand-logo";
import { APP_NAME } from "@/lib/brand";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = {
  title: "Sin espacio de trabajo",
};

export default function SinEspacioPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandLogo size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Sin espacio de trabajo</h1>
          <p className="mt-1 text-sm text-muted-foreground">{APP_NAME}</p>
        </div>

        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
          Tu cuenta no pertenece a ningún espacio de trabajo. Pide a un administrador que te
          agregue desde Configuración → Equipo.
        </p>

        <SignOutButton />
      </div>
    </div>
  );
}
