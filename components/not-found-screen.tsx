import Link from "next/link";
import { BrandLogo } from "@/lib/brand-logo";
import { APP_NAME } from "@/lib/brand";

export function NotFoundScreen({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "flex h-full min-h-[60vh] items-center justify-center overflow-auto px-4 py-8"
          : "flex min-h-screen items-center justify-center px-4"
      }
    >
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandLogo size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Página no encontrada</h1>
          <p className="mt-1 text-sm text-muted-foreground">{APP_NAME}</p>
        </div>

        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
          La página que buscas no existe o ya no está disponible. Revisa la dirección o vuelve a la Bandeja.
        </p>

        <Link
          href="/dashboard/inbox"
          className="block w-full rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Volver a la Bandeja
        </Link>
      </div>
    </div>
  );
}
