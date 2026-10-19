"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { createSequence } from "@/lib/actions/sequences";
import { useToast } from "@/components/ui/toast";
import { startRouteProgress } from "@/components/ui/route-progress";

export function CreateSequenceButton() {
  const router = useRouter();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const pendingRef = useRef(false);

  async function handleCreate() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setCreating(true);

    try {
      const result = await createSequence("Secuencia sin título");

      if (result.error) {
        console.error("Failed to create sequence:", result.error);
        toast.error(`No se pudo crear la secuencia: ${result.error}`);
        return;
      }

      if (result.sequence) {
        toast.success("Secuencia creada");
        startRouteProgress();
        router.push(`/dashboard/sequences/${result.sequence.id}`);
      }
    } catch (err) {
      console.error("Failed to create sequence:", err);
      toast.error(`No se pudo crear la secuencia: ${err instanceof Error ? err.message : "Error desconocido"}`);
    } finally {
      pendingRef.current = false;
      setCreating(false);
    }
  }

  return (
    <button
      onClick={handleCreate}
      disabled={creating}
      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
    >
      {creating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
      {creating ? "Creando…" : "Nueva secuencia"}
    </button>
  );
}
