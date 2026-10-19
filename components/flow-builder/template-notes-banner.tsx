"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { clearTemplateNotes, readTemplateNotes, type TemplateNotes } from "./template-notes";

/**
 * Avisos del flujo creado desde una plantilla: lo que quedó sin configurar y lo
 * que hay que ajustar antes de publicar. Se muestra hasta que lo cierres.
 */
export function TemplateNotesBanner({ flowId }: { flowId: string }) {
  const [notes, setNotes] = useState<TemplateNotes | null>(null);

  useEffect(() => {
    setNotes(readTemplateNotes(flowId));
  }, [flowId]);

  if (!notes) return null;

  const warnings = notes.warnings.filter((w) => w.level === "warning");
  const infos = notes.warnings.filter((w) => w.level === "info");

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="font-semibold">
            Creaste este flujo desde la plantilla &ldquo;{notes.templateName}&rdquo;. Quedó como borrador: revísalo antes de
            publicarlo.
          </p>

          {warnings.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                <AlertTriangle className="h-3.5 w-3.5" />
                Quedó sin configurar
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {warnings.map((w, i) => (
                  <li key={i}>
                    {w.nodeLabel ? <strong>{w.nodeLabel}: </strong> : null}
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {infos.length > 0 && (
            <ul className="space-y-0.5">
              {infos.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {w.message}
                </li>
              ))}
            </ul>
          )}

          {notes.adjust.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide">Qué tienes que ajustar</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {notes.adjust.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            clearTemplateNotes(flowId);
            setNotes(null);
          }}
          aria-label="Cerrar los avisos"
          title="Cerrar los avisos"
          className="shrink-0 rounded p-1 hover:bg-amber-200/60 dark:hover:bg-amber-800/40"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
