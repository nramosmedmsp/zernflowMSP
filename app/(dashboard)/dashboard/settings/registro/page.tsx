import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { AUDIT_NOT_ALLOWED_MESSAGE, canReadAuditLog, loadAuditPage, loadAuditPeople, parseAuditFilters } from "@/lib/audit-log";
import { NoPermission } from "@/components/settings/cases/no-permission";
import { AuditLogView } from "./audit-log-view";

export const metadata: Metadata = { title: "Registro de cambios" };
export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ persona?: string | string[]; tipo?: string | string[]; periodo?: string | string[] }>;
}) {
  // El rol es el efectivo: en «Ver como» manda la persona vista.
  const { role, workspace, supabase } = await getWorkspace();
  if (!canReadAuditLog(role)) return <NoPermission title="Registro de cambios" message={AUDIT_NOT_ALLOWED_MESSAGE} />;

  const filters = parseAuditFilters(await searchParams);
  const service = await createServiceClient();
  const [page, people] = await Promise.all([
    loadAuditPage(supabase, service, { workspaceId: workspace.id, filters }),
    loadAuditPeople(supabase, service, workspace.id),
  ]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-5 sm:px-8 sm:py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Volver a Configuración"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Registro de cambios</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Quién cambió qué en la app: equipo, configuración, canales, difusiones, datos de clientes y descargas.
            </p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <AuditLogView
          key={`${filters.person}|${filters.category}|${filters.period}`}
          filters={filters}
          people={people}
          initial={"error" in page ? { entries: [], nextCursor: null } : page}
          loadError={"error" in page ? page.error : null}
        />
      </div>
    </div>
  );
}
