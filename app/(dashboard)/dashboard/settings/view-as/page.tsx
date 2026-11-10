import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Eye, Lock } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { createRawServiceClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  formatViewDuration,
  isViewInProgress,
  logPeriodSince,
  parseLogPeriod,
  viewDurationMs,
} from "@/lib/view-as/ui-rules";
import { LogFilters } from "./log-filters";

export const metadata: Metadata = { title: "Registro de «Ver como»" };
export const dynamic = "force-dynamic";

const MAX_ROWS = 300;

interface LogRow {
  id: string;
  viewer_name: string;
  target_kind: "person" | "role";
  target_user_id: string;
  target_label: string;
  target_detail: string | null;
  started_at: string;
  expires_at: string;
  last_seen_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  sections: string[] | null;
}

const COLUMNS =
  "id, viewer_name, target_kind, target_user_id, target_label, target_detail, started_at, expires_at, last_seen_at, ended_at, end_reason, sections";

/** Clave de filtro: una persona por su id; un rol por su nombre (cada vista por rol tiene un id nuevo). */
function targetKey(r: Pick<LogRow, "target_kind" | "target_user_id" | "target_label">): string {
  return r.target_kind === "person" ? `person:${r.target_user_id}` : `role:${r.target_label}`;
}

export default async function ViewAsLogPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string | string[]; periodo?: string | string[] }>;
}) {
  const { role, workspace, viewAs } = await getWorkspace();
  // Solo el Dueño real, y no dentro de una vista.
  if (viewAs.locked || role !== "owner") redirect("/dashboard/settings");

  const params = await searchParams;
  const period = parseLogPeriod(params.periodo);
  const rawTarget = Array.isArray(params.a) ? params.a[0] : params.a;
  const target = rawTarget && /^(person:[0-9a-f-]{36}|role:.{1,120})$/i.test(rawTarget) ? rawTarget : "";

  const now = new Date().getTime();
  const since = logPeriodSince(period, now);
  const service = createRawServiceClient();
  // La tabla no está en los tipos generados (00040): se lee con tipado propio.
  let query = (service as unknown as { from: (t: string) => { select: (c: string) => any } })
    .from("view_as_sessions")
    .select(COLUMNS)
    .eq("workspace_id", workspace.id)
    .order("started_at", { ascending: false })
    .limit(MAX_ROWS);
  if (since) query = query.gte("started_at", since);
  const { data } = (await query) as { data: LogRow[] | null };
  const all = data ?? [];

  const targets = new Map<string, string>();
  for (const r of all) targets.set(targetKey(r), r.target_kind === "role" ? `${r.target_label} (por rol)` : r.target_label);
  const rows = target ? all.filter((r) => targetKey(r) === target) : all;

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
          <div>
            <h1 className="text-2xl font-bold">Registro de «Ver como»</h1>
            <p className="mt-1 text-sm text-muted-foreground">Quién miró la app como otra persona, a quién y por cuánto tiempo.</p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-8 py-8">
          <LogFilters
            targets={[...targets.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, "es"))}
            target={target}
            period={period}
            count={rows.length}
          />

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Fecha y hora</th>
                  <th className="px-4 py-2.5 font-medium">Quién miró</th>
                  <th className="px-4 py-2.5 font-medium">A quién miró</th>
                  <th className="px-4 py-2.5 font-medium">Qué abrió</th>
                  <th className="px-4 py-2.5 text-right font-medium">Duración</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      Nadie ha usado «Ver como» en este periodo.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const live = isViewInProgress(r, now);
                  const sections = (r.sections ?? []).join(", ");
                  return (
                    <tr
                      key={r.id}
                      className={cn("border-b border-border last:border-0", live && "bg-amber-50/60 dark:bg-amber-950/20")}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(r.started_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium">{r.viewer_name}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                            {r.target_label.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{r.target_label}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {r.target_kind === "role" ? "Vista de ejemplo por rol" : (r.target_detail ?? "Persona")}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{sections || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatViewDuration(viewDurationMs(r, now))}
                        {live && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                            <Eye className="h-3 w-3" />
                            En curso
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Mirar no deja huella en la tienda: no se marcan chats como leídos ni cambia Disponible/Ausente. Solo queda este registro, y solo lo ve el Dueño.
            {rows.length >= MAX_ROWS && ` Se muestran los ${MAX_ROWS} accesos más recientes.`}
          </p>
        </div>
      </div>
    </div>
  );
}
