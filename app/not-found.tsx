import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/lib/brand-logo";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Página no encontrada",
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandLogo size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Página no encontrada</h1>
          <p className="mt-1 text-sm text-muted-foreground">{APP_NAME}</p>
        </div>

        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
          La página que buscas no existe o ya no está disponible. Revisa la dirección o vuelve al panel.
        </p>

        <Link
          href="/dashboard"
          className="block w-full rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Ir al panel
        </Link>
      </div>
    </div>
  );
}
