"use client";

// Caja de texto con subrayado ondulado dentro: una capa idéntica detrás del
// textarea (misma letra, margen, ancho y desplazamiento) pinta las marcas y el
// textarea, transparente, escribe encima. Rojo = seguro, ámbar = dudoso, verde =
// recién corregido. También ajusta el alto al texto (mínimo y máximo).

import { useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import type { TextRange, UnderlineMark } from "@/lib/review-items";

export interface TextMark extends TextRange {
  tone: UnderlineMark["tone"] | "fixed";
}

const TONE_CLASS: Record<TextMark["tone"], string> = {
  safe: "underline decoration-red-500 decoration-wavy decoration-1 underline-offset-[3px] [text-decoration-skip-ink:none]",
  doubt: "underline decoration-amber-500 decoration-wavy decoration-1 underline-offset-[3px] [text-decoration-skip-ink:none]",
  fixed: "rounded-sm bg-green-300/60 dark:bg-green-500/30",
};

/** Marcas ordenadas y recortadas al texto, sin superponerse (la primera gana). */
function cleanMarks(marks: readonly TextMark[], length: number): TextMark[] {
  const out: TextMark[] = [];
  let last = 0;
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    const start = Math.max(m.start, last);
    const end = Math.min(m.end, length);
    if (end <= start) continue;
    out.push({ ...m, start, end });
    last = end;
  }
  return out;
}

export function HighlightedTextarea({
  ref,
  value,
  marks,
  minHeight,
  maxHeight,
  className,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
  ref?: Ref<HTMLTextAreaElement>;
  value: string;
  marks: readonly TextMark[];
  minHeight: number;
  maxHeight: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

  // El alto sigue al texto: unas 3 líneas al empezar, hasta el máximo; recién ahí
  // aparece la barra. La capa se corre lo que ocupa la barra para que el texto
  // caiga en las mismas líneas.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!el || !mirror) return;
    el.style.height = "auto";
    // scrollHeight no cuenta el borde: sin sumarlo aparecen las flechas de desplazamiento.
    const border = el.offsetHeight - el.clientHeight;
    const wanted = el.scrollHeight + border;
    el.style.height = `${Math.min(Math.max(wanted, minHeight), maxHeight)}px`;
    el.style.overflowY = wanted > maxHeight ? "auto" : "hidden";
    const bar = Math.max(0, el.offsetWidth - el.clientWidth - 2);
    mirror.style.paddingRight = `calc(1rem + ${bar}px)`;
    mirror.scrollTop = el.scrollTop;
  }, [value, minHeight, maxHeight]);

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const m of cleanMarks(marks, value.length)) {
    if (m.start > cursor) parts.push(value.slice(cursor, m.start));
    parts.push(
      <span key={`${m.start}:${m.end}`} className={TONE_CLASS[m.tone]}>
        {value.slice(m.start, m.end)}
      </span>,
    );
    cursor = m.end;
  }
  parts.push(value.slice(cursor));

  return (
    <div className="relative rounded-lg bg-background">
      <div
        ref={mirrorRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-lg border border-transparent px-4 py-2.5 text-sm text-transparent"
      >
        {parts}
        {/* Sin esto, un salto de línea al final no ocupa su renglón. */}
        {"​"}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onScroll={(e) => {
          if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        className={cn("relative block w-full bg-transparent", className)}
        style={{ minHeight, maxHeight }}
        {...props}
      />
    </div>
  );
}
