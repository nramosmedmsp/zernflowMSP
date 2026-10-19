import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

// Esqueletos con la forma real de cada pantalla. Los loading.tsx de cada sección
// solo los componen, así el tamaño y el espaciado siguen a las pantallas reales.

/** Cabecera de sección: título, subtítulo y botón a la derecha (border-b px-8 py-6). */
function SectionHeader({ children, action = true }: { children?: React.ReactNode; action?: boolean }) {
  return (
    <div className="border-b border-border px-8 py-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-40 rounded-lg" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        {action && <Skeleton className="h-9 w-32 rounded-lg" />}
      </div>
      {children}
    </div>
  );
}

function Tabs({ count = 4 }: { count?: number }) {
  return (
    <div className="mt-4 flex gap-4 border-b border-border pb-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-20" />
      ))}
    </div>
  );
}

function CardSkeleton({ lines = 1 }: { lines?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-1.5 h-3 w-20" />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="mt-3 h-3 w-full max-w-[14rem]" />
      ))}
      <Skeleton className="mt-4 h-3 w-36" />
    </div>
  );
}

/** Tarjetas en cuadrícula (flujos, secuencias, canales). */
export function CardsScreenSkeleton({ cards = 6, action = true }: { cards?: number; action?: boolean }) {
  return (
    <SkeletonRegion className="flex h-full flex-col">
      <SectionHeader action={action} />
      <div className="flex-1 overflow-hidden px-8 py-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: cards }).map((_, i) => (
            <CardSkeleton key={i} lines={i % 2} />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

function TableRows({ rows, columns }: { rows: number; columns: number }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-border bg-muted/50 text-left">
          {Array.from({ length: columns }).map((_, c) => (
            <th key={c} className={c === 0 ? "px-8 py-3" : "px-4 py-3"}>
              <Skeleton className="h-3 w-16" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r} className="border-b border-border">
            {Array.from({ length: columns }).map((_, c) => (
              <td key={c} className={c === 0 ? "px-8 py-3.5" : "px-4 py-3.5"}>
                {c === 0 ? (
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                    <Skeleton className="h-4 w-36" />
                  </div>
                ) : (
                  <Skeleton className={c === 1 ? "h-5 w-20 rounded-full" : "h-4 w-24"} />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Tabla con barra de filtros (contactos, gestiones). */
export function TableScreenSkeleton({ tabs = false, columns = 6, rows = 10 }: { tabs?: boolean; columns?: number; rows?: number }) {
  return (
    <SkeletonRegion className="flex h-full flex-col">
      <SectionHeader>
        {tabs && <Tabs />}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-64 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      </SectionHeader>
      <div className="min-h-0 flex-1 overflow-hidden">
        <TableRows rows={rows} columns={columns} />
      </div>
    </SkeletonRegion>
  );
}

/** Bandeja: lista de conversaciones, hilo de mensajes y panel del contacto. */
export function InboxScreenSkeleton() {
  return (
    <SkeletonRegion className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="space-y-3 border-b border-border p-3">
          <Skeleton className="h-9 w-full rounded-lg" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-border px-4 py-3">
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <Skeleton className="mt-2 h-3 w-full max-w-[11rem]" />
                <Skeleton className="mt-2 h-4 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="h-[41px] shrink-0 border-b border-border bg-muted/30" />
        <div className="flex-1 overflow-hidden p-4">
          <div className="mx-auto max-w-2xl space-y-4">
            <Skeleton className="h-10 w-2/5 rounded-2xl" />
            <Skeleton className="ml-auto h-14 w-1/2 rounded-2xl" />
            <Skeleton className="h-10 w-1/3 rounded-2xl" />
            <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
            <Skeleton className="h-16 w-3/5 rounded-2xl" />
          </div>
        </div>
        <div className="border-t border-border p-4">
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <Skeleton className="h-10 flex-1 rounded-lg" />
            <Skeleton className="h-10 w-10 rounded-lg" />
          </div>
        </div>
      </div>

      <div className="hidden w-80 shrink-0 flex-col gap-4 border-l border-border p-4 lg:flex">
        <div className="flex flex-col items-center gap-2 pt-2">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-8 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Métricas y analítica: tarjetas de cifras y bloques de gráficos o tablas. */
export function StatsScreenSkeleton({ tabs = false }: { tabs?: boolean }) {
  return (
    <SkeletonRegion className="flex h-full flex-col">
      <SectionHeader action={false}>{tabs && <Tabs count={6} />}</SectionHeader>
      <div className="flex-1 space-y-6 overflow-hidden px-8 py-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-3 h-8 w-20" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5">
              <Skeleton className="h-4 w-40" />
              <div className="mt-5 flex h-40 items-end gap-2">
                {[40, 65, 30, 80, 55, 70, 45, 60, 35, 75].map((h, j) => (
                  <div key={j} className="flex-1 self-end" style={{ height: `${h}%` }}><Skeleton className="h-full w-full" /></div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <Skeleton className="h-4 w-44" />
          </div>
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** Configuración: columna central con grupos de ajustes. */
export function SettingsScreenSkeleton() {
  return (
    <SkeletonRegion className="flex h-full flex-col">
      <SectionHeader action={false} />
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="mt-1.5 h-3 w-36" />
                </div>
              </div>
            ))}
          </div>
          <hr className="border-border" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-full max-w-md" />
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-9 w-24 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** Pantallas con un lienzo grande (constructor de flujos, mapa, laboratorio, explorador). */
export function CanvasScreenSkeleton() {
  return (
    <SkeletonRegion className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden bg-muted/20">
        <Skeleton className="absolute left-[12%] top-[18%] h-20 w-52 rounded-xl" />
        <Skeleton className="absolute left-[38%] top-[34%] h-20 w-52 rounded-xl" />
        <Skeleton className="absolute left-[62%] top-[18%] h-20 w-52 rounded-xl" />
        <Skeleton className="absolute left-[38%] top-[62%] h-20 w-52 rounded-xl" />
      </div>
    </SkeletonRegion>
  );
}

/** Ficha de un contacto o editor con columna central. */
export function DetailScreenSkeleton() {
  return (
    <SkeletonRegion className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-8 py-5">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-12 w-12 rounded-full" />
        <div>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-2 h-3 w-28" />
        </div>
      </div>
      <div className="grid flex-1 gap-6 overflow-hidden px-8 py-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <div className="space-y-3 lg:col-span-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** Lista de filas a todo el ancho (difusiones). */
export function ListScreenSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <SkeletonRegion className="flex h-full flex-col">
      <SectionHeader />
      <div className="flex-1 divide-y divide-border overflow-hidden">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 px-8 py-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
