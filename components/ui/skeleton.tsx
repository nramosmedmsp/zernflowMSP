import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Bloque gris pulsante: pieza base de los esqueletos de carga. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded bg-muted", className)} />;
}

/** Envoltorio accesible para el esqueleto de una pantalla. */
export function SkeletonRegion({
  className,
  children,
  label = "Cargando…",
}: {
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={cn("animate-fade-in", className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Cabecera de página (título, subtítulo y botón) usada por varios esqueletos. */
export function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <Skeleton className="h-7 w-40 rounded-lg" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      {action && <Skeleton className="h-9 w-28 rounded-lg" />}
    </div>
  );
}
