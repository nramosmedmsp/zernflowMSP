"use client";

// Foto ampliada del chat: Esc o clic fuera para cerrar.

import { useEffect } from "react";
import { Download, ExternalLink, X } from "lucide-react";
import { downloadHref } from "@/lib/chat-media";

export interface LightboxImage {
  url: string;
  name: string | null;
}

export function MediaLightbox({ image, onClose }: { image: LightboxImage | null; onClose: () => void }) {
  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [image, onClose]);

  if (!image) return null;
  const linkClass =
    "inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20";
  return (
    <div role="dialog" aria-modal="true" aria-label="Foto" className="fixed inset-0 z-50 flex flex-col">
      <div className="animate-fade-in fixed inset-0 bg-black/85" onClick={onClose} />
      <div className="relative z-10 flex items-center justify-end gap-2 p-3">
        {image.url.startsWith("/api/v1/media/") && (
          <a href={downloadHref(image.url)} className={linkClass}>
            <Download className="h-4 w-4" />
            Descargar
          </a>
        )}
        <a href={image.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <ExternalLink className="h-4 w-4" />
          Abrir en otra pestaña
        </a>
        <button type="button" onClick={onClose} aria-label="Cerrar" className={linkClass}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="pointer-events-none relative z-10 flex flex-1 items-center justify-center p-4 pt-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado privado, sin optimizador */}
        <img
          src={image.url}
          alt={image.name ?? "Foto"}
          className="animate-pop-in pointer-events-auto max-h-[85vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
        />
      </div>
    </div>
  );
}
