import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Indicador de carga pequeño para botones y textos. Hereda el color del texto. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden="true" className={cn("h-4 w-4 shrink-0 animate-spin", className)} />;
}
