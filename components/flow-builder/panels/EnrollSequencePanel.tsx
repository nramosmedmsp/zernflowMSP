"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import { sequenceStatusLabel } from "../labels";

interface EnrollSequencePanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

interface SequenceOption {
  id: string;
  name: string;
  status: string;
}

export function EnrollSequencePanel({ data, onChange }: EnrollSequencePanelProps) {
  const [sequences, setSequences] = useState<SequenceOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: rows } = await supabase
        .from("sequences")
        .select("id, name, status")
        .order("name", { ascending: true });

      setSequences(rows ?? []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted p-4">
        <p className="text-sm font-medium text-foreground">
          Inscribir en secuencia
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          El contacto se inscribirá en la secuencia seleccionada cuando llegue
          a este paso.
        </p>
      </div>

      <div>
        <label className="mb-2 block text-xs font-semibold text-muted-foreground">
          Secuencia
        </label>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Cargando secuencias...
          </div>
        ) : sequences.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No hay secuencias. Primero crea una en la sección Secuencias.
          </p>
        ) : (
          <select
            value={(data.sequenceId as string) || ""}
            onChange={(e) => onChange({ ...data, sequenceId: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Selecciona una secuencia...</option>
            {sequences.map((seq) => (
              <option key={seq.id} value={seq.id}>
                {seq.name} ({sequenceStatusLabel(seq.status)})
              </option>
            ))}
          </select>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">
          Solo las secuencias activas inscribirán contactos al ejecutarse el flujo.
        </p>
      </div>
    </div>
  );
}
