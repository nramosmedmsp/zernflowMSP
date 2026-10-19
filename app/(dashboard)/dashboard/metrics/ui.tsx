"use client";

import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/metrics/stats";
import type { DualStats, TimeStats } from "@/lib/metrics/types";
import type { TimeMode } from "@/lib/metrics/export";

export function pickStats(d: DualStats, mode: TimeMode): TimeStats {
  return mode === "business" ? d.business : d.clock;
}

export function dur(seconds: number | null | undefined): string {
  return formatDuration(seconds);
}

export function pctText(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value}%`;
}

/** Descarga un CSV ya armado (con BOM) en el navegador. */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportButton({
  filename,
  build,
  disabled,
}: {
  filename: string;
  build: () => string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => downloadCsv(filename, build())}
      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Download className="h-4 w-4" />
      Exportar CSV
    </button>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold",
          tone === "good" && "text-green-600",
          tone === "bad" && "text-red-600",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn("whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground", right ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

export function Td({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={cn("px-3 py-2 text-sm", right && "text-right tabular-nums", className)}>{children}</td>;
}
