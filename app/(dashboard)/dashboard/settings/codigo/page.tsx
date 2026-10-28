import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download, FileCode2 } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";

export const metadata: Metadata = { title: "Código de la app" };

export default async function SourceCodePage() {
  const { role } = await getWorkspace();
  const isAdmin = isAdminRole(role);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Volver a Configuración"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold">Código de la app</h1>
        </div>
      </div>
      {isAdmin ? (
        <div className="mx-auto w-full max-w-2xl px-8 py-8">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-start gap-3">
              <FileCode2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="space-y-2 text-sm">
                <p>
                  Descarga el código fuente para revisarlo o dárselo a un colaborador. No incluye claves ni datos de
                  clientes.
                </p>
                <p className="text-muted-foreground">
                  El archivo trae una guía (LEEME-PARA-CLAUDE.md) con la fecha y la versión del código, para que un
                  colaborador, o Claude, entienda la app rápidamente. Corresponde a la versión instalada ahora.
                </p>
              </div>
            </div>
            <a
              href="/api/v1/admin/source-zip"
              download
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Download className="h-4 w-4" />
              Descargar código (.zip)
            </a>
          </div>
        </div>
      ) : (
        <p className="mx-auto mt-10 max-w-md px-8 text-center text-sm text-muted-foreground">
          Solo el Dueño o un Administrador pueden descargar el código de la app.
        </p>
      )}
    </div>
  );
}
