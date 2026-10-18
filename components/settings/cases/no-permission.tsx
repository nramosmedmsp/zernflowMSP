import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** Pantalla para quien no es Dueño ni Administrador. */
export function NoPermission({ title, message }: { title: string; message?: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Volver a Configuración">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-md px-8 text-center">
        <p className="text-sm font-medium">No tienes permiso</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {message ?? "Solo el Dueño o un Administrador pueden ver y cambiar esta configuración."}
        </p>
      </div>
    </div>
  );
}
