// Aviso de la ficha de un cliente eliminado (solo lectura). Lo usan la ficha del
// contacto y el panel del contacto de la Bandeja. El texto sale de lib/contact-erased.ts.

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { erasedNotice } from "@/lib/contact-erased";

export function ErasedNotice({
  erasedAt,
  byName,
  className,
}: {
  erasedAt: string | null | undefined;
  /** Quién eliminó los datos; solo se pasa a Dueño y Administrador. */
  byName?: string | null;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200",
        className,
      )}
    >
      <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>{erasedNotice(erasedAt, byName)}</p>
    </div>
  );
}
