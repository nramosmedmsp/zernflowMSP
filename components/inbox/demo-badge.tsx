import { cn } from "@/lib/utils";
import { DEMO_LABEL } from "@/lib/demo";

/** Etiqueta "Prueba" de canales y conversaciones de prueba (lib/demo.ts). */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      title="Canal de prueba: los mensajes no se envían a Zernio"
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
        className,
      )}
    >
      {DEMO_LABEL}
    </span>
  );
}
