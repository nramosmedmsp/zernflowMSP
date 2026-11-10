"use client";

import { usePathname, useRouter } from "next/navigation";
import { LOG_PERIODS, type LogPeriod } from "@/lib/view-as/ui-rules";

/** Filtros del registro: cambian la dirección (persona y periodo) y la página se vuelve a leer. */
export function LogFilters({
  targets,
  target,
  period,
  count,
}: {
  targets: { key: string; label: string }[];
  target: string;
  period: LogPeriod;
  count: number;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next: { target?: string; period?: LogPeriod }) {
    const params = new URLSearchParams();
    const t = next.target ?? target;
    const p = next.period ?? period;
    if (t) params.set("a", t);
    if (p !== "30") params.set("periodo", p);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const select = "rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Persona" value={target} onChange={(e) => go({ target: e.target.value })} className={select}>
        <option value="">Todas las personas vistas</option>
        {targets.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Periodo"
        value={period}
        onChange={(e) => go({ period: e.target.value as LogPeriod })}
        className={select}
      >
        {LOG_PERIODS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <span className="ml-auto text-xs text-muted-foreground">
        {count} {count === 1 ? "acceso" : "accesos"}
      </span>
    </div>
  );
}
