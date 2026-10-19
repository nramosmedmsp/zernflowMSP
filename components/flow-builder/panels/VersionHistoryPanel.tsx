"use client";

import { useState, useEffect } from "react";
import { X, RotateCcw, Loader2, History } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDateTime } from "@/lib/format";

interface Version {
  id: string;
  version: number;
  name: string;
  published_by: string | null;
  created_at: string;
}

interface VersionHistoryPanelProps {
  flowId: string;
  currentVersion: number;
  onClose: () => void;
  onRestore: () => void;
}

export function VersionHistoryPanel({
  flowId,
  currentVersion,
  onClose,
  onRestore,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/v1/flows/${flowId}/versions`);
        if (res.ok) {
          const data = await res.json();
          setVersions(data);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [flowId]);

  async function handleRestore(versionId: string) {
    setRestoring(versionId);
    try {
      const res = await fetch(
        `/api/v1/flows/${flowId}/versions/${versionId}/restore`,
        { method: "POST" }
      );
      if (res.ok) {
        onRestore();
      }
    } finally {
      setRestoring(null);
    }
  }


  return (
    <div className="animate-slide-in-right w-80 border-l border-border bg-card overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Historial de versiones</h3>
        </div>
        <button
          onClick={onClose}
          aria-label="Cerrar"
          title="Cerrar"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : versions.length === 0 ? (
          <div className="py-8 text-center">
            <History className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              Aún no hay versiones
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Publica tu flujo para crear la primera versión.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {versions.map((v) => (
              <div
                key={v.id}
                className="rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">v{v.version}</span>
                    {v.version === currentVersion && (
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                        actual
                      </span>
                    )}
                  </div>
                  {v.version !== currentVersion && (
                    <button
                      onClick={() => setConfirmRestore(v.id)}
                      disabled={restoring === v.id}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {restoring === v.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      Restaurar
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {v.name}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  {formatDateTime(v.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!confirmRestore}
        title="Restaurar versión"
        message="El borrador actual se reemplazará por los nodos y conexiones de esta versión."
        confirmLabel="Restaurar"
        cancelLabel="Cancelar"
        onConfirm={() => {
          if (confirmRestore) handleRestore(confirmRestore);
          setConfirmRestore(null);
        }}
        onCancel={() => setConfirmRestore(null)}
      />
    </div>
  );
}
