"use client";

// Vista previa de los archivos por enviar, cada uno con su ✕ para quitarlo.

import { FileText, Loader2, X } from "lucide-react";
import { formatFileSize } from "@/lib/chat-media";
import type { TrayItem } from "./use-attachments";

export function AttachmentTray({
  items,
  preparing,
  onRemove,
}: {
  items: TrayItem[];
  preparing: boolean;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0 && !preparing) return null;
  return (
    <div className="flex flex-wrap items-end gap-2" aria-label="Archivos por enviar">
      {items.map((item) => (
        <div key={item.id} className="animate-pop-in group relative">
          {item.kind === "image" && item.localUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local
            <img
              src={item.localUrl}
              alt={item.name}
              title={item.name}
              className="h-16 w-16 rounded-lg border border-border object-cover"
            />
          ) : (
            <div className="flex h-16 max-w-56 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3" title={item.name}>
              <FileText className="h-6 w-6 flex-shrink-0 text-red-500" />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{item.name}</p>
                <p className="text-[11px] text-muted-foreground">{formatFileSize(item.size)}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={`Quitar ${item.name}`}
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      {preparing && (
        <div className="flex h-16 items-center gap-1.5 px-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Preparando…
        </div>
      )}
    </div>
  );
}
