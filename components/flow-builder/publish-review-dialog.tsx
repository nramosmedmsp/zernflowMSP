"use client";

import { useEffect } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import type { FlowIssue } from "@/lib/flow-engine/validate";

interface Props {
  issues: FlowIssue[];
  publishing: boolean;
  onClose: () => void;
  /** Publicar de todos modos: solo existe si no hay errores. */
  onPublishAnyway: () => void;
  /** Selecciona el nodo del problema en el lienzo. */
  onShowNode: (nodeId: string) => void;
}

/** Lista de problemas y avisos antes de publicar un flujo. */
export function PublishReviewDialog({ issues, publishing, onClose, onPublishAnyway, onShowNode }: Props) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const renderIssue = (issue: FlowIssue, index: number) => (
    <li key={`${issue.code}-${issue.nodeId ?? "flujo"}-${index}`} className="flex items-start gap-2 text-sm">
      {issue.severity === "error" ? (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      )}
      <span className="flex-1">
        {issue.message}
        {issue.nodeId && (
          <button
            type="button"
            onClick={() => onShowNode(issue.nodeId!)}
            className="ml-2 text-xs font-medium text-primary underline hover:opacity-80"
          >
            Ver nodo
          </button>
        )}
      </span>
    </li>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade-in fixed inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-review-title"
        className="animate-pop-in relative z-10 w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-lg"
      >
        <h3 id="publish-review-title" className="text-sm font-semibold text-foreground">
          {errors.length > 0 ? "No se puede publicar todavía" : "Revisa estos avisos antes de publicar"}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {errors.length > 0
            ? "Corrige lo siguiente y vuelve a publicar. Los nodos con problema se marcan en rojo en el lienzo."
            : "El flujo se puede publicar, pero conviene revisar esto."}
        </p>
        <div className="mt-4 max-h-72 space-y-4 overflow-auto">
          {errors.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-red-600">Hay que corregir ({errors.length})</p>
              <ul className="space-y-2">{errors.map(renderIssue)}</ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-amber-600">Avisos ({warnings.length})</p>
              <ul className="space-y-2">{warnings.map(renderIssue)}</ul>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            {errors.length > 0 ? "Cerrar" : "Seguir editando"}
          </button>
          {errors.length === 0 && (
            <button
              type="button"
              onClick={onPublishAnyway}
              disabled={publishing}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {publishing ? "Publicando…" : "Publicar de todos modos"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
