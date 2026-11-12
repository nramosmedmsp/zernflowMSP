"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Loader2, Lock } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadMoreAuditLog } from "@/lib/actions/audit-log";
import { AUDIT_CATEGORIES } from "@/lib/audit-labels";
import type { AuditEntry, AuditFilters, AuditPage, AuditPerson } from "@/lib/audit-log";
import { LOG_PERIODS, type LogPeriod } from "@/lib/view-as/ui-rules";

const categoryLabel = (value: string | null) => AUDIT_CATEGORIES.find((c) => c.value === value)?.label ?? null;

export function AuditLogView({
  filters,
  people,
  initial,
  loadError,
}: {
  filters: AuditFilters;
  people: AuditPerson[];
  initial: AuditPage;
  loadError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [entries, setEntries] = useState<AuditEntry[]>(initial.entries);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(loadError);
  const [pending, startTransition] = useTransition();

  function go(next: Partial<{ persona: string; tipo: string; periodo: LogPeriod }>) {
    const params = new URLSearchParams();
    const persona = next.persona ?? filters.person;
    const tipo = next.tipo ?? filters.category;
    const periodo = next.periodo ?? filters.period;
    if (persona) params.set("persona", persona);
    if (tipo) params.set("tipo", tipo);
    if (periodo !== "30") params.set("periodo", periodo);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function loadMore() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      const result = await loadMoreAuditLog(
        { persona: filters.person, tipo: filters.category, periodo: filters.period },
        cursor,
      );
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...result.entries.filter((e) => !seen.has(e.id))];
      });
      setCursor(result.nextCursor);
    });
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const select = "min-w-0 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm";
  const filtered = filters.person !== "" || filters.category !== "" || filters.period !== "all";

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Persona" value={filters.person} onChange={(e) => go({ persona: e.target.value })} className={select}>
          <option value="">Todas las personas</option>
          <option value="system">Sistema (automático)</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select aria-label="Tipo de cambio" value={filters.category} onChange={(e) => go({ tipo: e.target.value })} className={select}>
          <option value="">Todos los tipos de cambio</option>
          {AUDIT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select aria-label="Periodo" value={filters.period} onChange={(e) => go({ periodo: e.target.value as LogPeriod })} className={select}>
          {LOG_PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground sm:ml-auto" aria-live="polite">
          {entries.length} {entries.length === 1 ? "cambio" : "cambios"}
          {cursor ? " o más" : ""}
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {entries.length === 0 && !error ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {filtered
            ? "No hay cambios que coincidan con estos filtros. Prueba con otra persona, otro tipo o «Todo el registro»."
            : "Todavía no hay cambios registrados."}
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {entries.map((e) => {
            const expanded = open.has(e.id);
            const category = categoryLabel(e.category);
            return (
              <li key={e.id} className="px-4 py-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
                  <div className="shrink-0 text-xs text-muted-foreground sm:w-40 sm:pt-0.5">
                    <p className="whitespace-nowrap tabular-nums">{formatDateTime(e.createdAt)}</p>
                    <p className="mt-0.5 truncate font-medium text-foreground sm:text-muted-foreground">{e.actorName}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{e.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {category && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{category}</span>
                      )}
                      {e.details.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggle(e.id)}
                          aria-expanded={expanded}
                          className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
                        >
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                          {expanded ? "Ocultar detalle" : "Ver detalle"}
                        </button>
                      )}
                    </div>
                    {expanded && (
                      <ul className="mt-2 space-y-1 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                        {e.details.map((line, i) => (
                          <li key={i} className="break-words">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {cursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Cargar más
          </button>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Solo lo ven el Dueño y los Administradores. Por seguridad, el registro nunca guarda claves, contraseñas ni enlaces de acceso,
        y no muestra datos personales de clientes eliminados. Las horas son de Lima.
      </p>
    </div>
  );
}
