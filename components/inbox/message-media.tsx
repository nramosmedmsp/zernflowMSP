"use client";

// Archivos dentro de la burbuja: fotos (clic para ampliar), PDF y documentos
// (abrir y descargar), audios y notas de voz (1x, 1,5x, 2x), videos y stickers.

import { useRef, useState } from "react";
import { Download, FileText, ImageOff, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadHref, formatFileSize } from "@/lib/chat-media";
import type { InboxMedia } from "@/lib/inbox-messages";
import type { LightboxImage } from "./media-lightbox";

const SPEEDS = [1, 1.5, 2] as const;

function speedLabel(speed: number): string {
  return `${String(speed).replace(".", ",")}x`;
}

function Unavailable({ media, inbound }: { media: InboxMedia; inbound: boolean }) {
  const text =
    media.status === "expired"
      ? "Archivo vencido (se guarda 2 meses)"
      : media.status === "too_large"
        ? "Archivo muy pesado para guardarlo"
        : "Archivo adjunto";
  return (
    <div className={cn("flex items-center gap-1.5 px-2.5 py-1.5 text-xs", inbound ? "text-muted-foreground" : "opacity-80")}>
      {media.status === "expired" ? <ImageOff className="h-3.5 w-3.5" /> : <Paperclip className="h-3.5 w-3.5" />}
      <span>{media.name ? `${text} · ${media.name}` : text}</span>
    </div>
  );
}

function ImageMedia({
  media,
  src,
  sticker,
  onOpen,
}: {
  media: InboxMedia;
  src: string;
  sticker: boolean;
  onOpen: (image: LightboxImage) => void;
}) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="flex h-24 w-40 items-center justify-center gap-1.5 rounded-xl bg-background/40 text-xs opacity-80">
        <ImageOff className="h-4 w-4" />
        No se pudo cargar
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen({ url: media.url ?? src, name: media.name })}
      className="block overflow-hidden rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={sticker ? "Ver sticker" : "Ampliar foto"}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado privado, sin optimizador */}
      <img
        src={src}
        alt={media.name ?? (sticker ? "Sticker" : "Foto")}
        loading="lazy"
        onError={() => setBroken(true)}
        className={cn("block object-cover", sticker ? "h-28 w-28 object-contain" : "max-h-72 min-h-20 w-auto max-w-full min-w-28")}
      />
    </button>
  );
}

function AudioMedia({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState<number>(1);
  const next = () => {
    const value = SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
    setSpeed(value);
    if (ref.current) ref.current.playbackRate = value;
  };
  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5">
      <audio ref={ref} controls preload="none" src={src} className="h-9 w-64 max-w-full" />
      <button
        type="button"
        onClick={next}
        title="Velocidad"
        className="rounded-full bg-background/60 px-2 py-0.5 text-[11px] font-semibold text-foreground hover:bg-background"
      >
        {speedLabel(speed)}
      </button>
    </div>
  );
}

/** `src` null: el archivo todavía está saliendo (sin enlaces). */
function FileMedia({ media, src, inbound }: { media: InboxMedia; src: string | null; inbound: boolean }) {
  const size = formatFileSize(media.size);
  const isPdf = media.mime === "application/pdf" || /\.pdf$/i.test(media.name ?? "");
  return (
    <div className={cn("flex min-w-56 items-center gap-2.5 rounded-xl px-2.5 py-2", inbound ? "bg-background/70" : "bg-white/15")}>
      <FileText className={cn("h-8 w-8 flex-shrink-0", inbound ? "text-red-500" : "")} />
      <div className="min-w-0 flex-1">
        {src ? (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium underline-offset-2 hover:underline"
            title={media.name ?? undefined}
          >
            {media.name ?? (isPdf ? "Documento PDF" : "Documento")}
          </a>
        ) : (
          <p className="truncate text-sm font-medium" title={media.name ?? undefined}>
            {media.name ?? (isPdf ? "Documento PDF" : "Documento")}
          </p>
        )}
        <p className={cn("text-[11px]", inbound ? "text-muted-foreground" : "opacity-80")}>
          {[isPdf ? "PDF" : null, size].filter(Boolean).join(" · ") || "Abrir"}
        </p>
      </div>
      {src && (
        <a
          href={downloadHref(src)}
          title="Descargar"
          aria-label="Descargar"
          {...(src.startsWith("/api/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
          className={cn("rounded-full p-1.5", inbound ? "text-muted-foreground hover:bg-accent hover:text-foreground" : "hover:bg-white/20")}
        >
          <Download className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

export function MessageMedia({
  media,
  inbound,
  onOpenImage,
}: {
  media: InboxMedia[];
  inbound: boolean;
  onOpenImage: (image: LightboxImage) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {media.map((item, i) => {
        const src = item.localUrl ?? item.url;
        // Documento que todavía está saliendo desde este navegador.
        if (!src && item.status === "stored" && item.kind === "file") return <FileMedia key={i} media={item} src={null} inbound={inbound} />;
        if (!src) return <Unavailable key={i} media={item} inbound={inbound} />;
        switch (item.kind) {
          case "image":
          case "sticker":
            return <ImageMedia key={i} media={item} src={src} sticker={item.kind === "sticker"} onOpen={onOpenImage} />;
          case "audio":
            return <AudioMedia key={i} src={src} />;
          case "video":
            return <video key={i} controls preload="metadata" src={src} className="max-h-72 max-w-full rounded-xl bg-black" />;
          default:
            return <FileMedia key={i} media={item} src={src} inbound={inbound} />;
        }
      })}
    </div>
  );
}
