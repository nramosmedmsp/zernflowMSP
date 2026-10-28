"use client";

// Franja debajo de la caja de texto: todo lo que hay por revisar (lib/review-items.ts)
// como chips con la palabra tachada y su corrección a un clic. La flechita abre otras
// sugerencias, "Agregar al diccionario de la tienda" e "Ignorar en este mensaje"; la X
// ignora rápido. Al enviar con cosas pendientes se vuelve un panel ámbar ("modo
// revisión") con Enviar así / Corregir las seguras y enviar; sin nada pendiente, verde.

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookPlus, Check, ChevronDown, EyeOff, SpellCheck, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReviewItem } from "@/lib/review-items";
import { primaryButtonClass, secondaryButtonClass } from "../ui";

const MAX_CHIPS = 6;

function Chip({
  item,
  open,
  onToggle,
  onPick,
  onAdd,
  onIgnore,
  canAddWords,
}: {
  item: ReviewItem;
  open: boolean;
  onToggle: () => void;
  onPick: (word: string) => void;
  onAdd: () => void;
  onIgnore: () => void;
  canAddWords: boolean;
}) {
  const ignoreButton = (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onIgnore}
      aria-label={`Ignorar «${item.from}» en este mensaje`}
      title="Ignorar en este mensaje"
      className="rounded-full p-0.5 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );

  if (item.source === "llave") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 py-0.5 pl-2 pr-0.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <TriangleAlert className="h-3 w-3 shrink-0" />
        <span>
          <span className="font-mono">{item.from}</span> sin reemplazar
        </span>
        {ignoreButton}
      </span>
    );
  }

  const options = item.to === null ? [] : [item.to, ...item.others];
  const first = options[0];
  const dictionary = item.source === "diccionario";
  return (
    <span
      className={cn(
        "relative inline-flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-0.5 text-xs",
        item.safe
          ? "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30"
          : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
      )}
    >
      <span
        className={cn(
          "max-w-[12rem] truncate line-through",
          item.safe
            ? "text-red-700 decoration-red-500/70 dark:text-red-300"
            : "text-amber-900 decoration-amber-600/70 dark:text-amber-200",
        )}
      >
        {item.from}
      </span>
      {first ? (
        <>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(first)}
            title={`Cambiar por «${first}»`}
            className="max-w-[14rem] truncate rounded-full bg-white px-2 py-0.5 font-medium text-green-700 shadow-sm ring-1 ring-green-200 hover:bg-green-50 dark:bg-background dark:text-green-400"
          >
            {first}
            {!item.safe && <span className="ml-0.5 text-amber-600">?</span>}
          </button>
        </>
      ) : (
        <span className="px-1 text-[11px] text-muted-foreground">sin sugerencias</span>
      )}
      {!item.safe && first && <span className="text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">revisa</span>}
      {dictionary && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggle}
          aria-label={`Más opciones para «${item.from}»`}
          aria-expanded={open}
          className="rounded-full p-0.5 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      )}
      {ignoreButton}
      {open && dictionary && (
        <span
          role="menu"
          className="animate-pop-in absolute bottom-full left-0 z-40 mb-1.5 w-64 rounded-lg border border-border bg-card p-1 text-left shadow-lg"
        >
          {options.length > 1 && (
            <>
              <span className="block px-2 pb-1 pt-0.5 text-[11px] font-medium text-muted-foreground">Cambiar «{item.from}» por</span>
              {options.map((w) => (
                <button
                  key={w}
                  type="button"
                  role="menuitem"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(w)}
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  {w}
                </button>
              ))}
              <span className="my-1 block h-px bg-border" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onAdd}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
          >
            <BookPlus className="h-3.5 w-3.5 shrink-0 text-primary" />
            {canAddWords ? `Agregar «${item.from}» al diccionario de la tienda` : `Pedir agregar «${item.from}» al diccionario`}
          </button>
          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onIgnore}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
          >
            <EyeOff className="h-3.5 w-3.5 shrink-0" />
            Ignorar en este mensaje
          </button>
        </span>
      )}
    </span>
  );
}

export function ReviewStrip({
  items,
  reviewing,
  nudge,
  canAddWords = false,
  onPick,
  onApplySafe,
  onAdd,
  onIgnore,
  onSendAsIs,
  onApplySafeAndSend,
  onDisable,
}: {
  items: ReviewItem[];
  /** Modo revisión: se intentó enviar con cosas pendientes. */
  reviewing: boolean;
  /** Sube cada vez que se pulsa Enter con cosas pendientes: el panel se sacude. */
  nudge: number;
  /** Administradores agregan; los demás piden que se agregue. */
  canAddWords?: boolean;
  onPick: (item: ReviewItem, word?: string) => void;
  /** Corrige solo las seguras (no envía). */
  onApplySafe: () => void;
  onAdd: (item: ReviewItem) => void;
  onIgnore: (item: ReviewItem) => void;
  onSendAsIs: () => void;
  onApplySafeAndSend: () => void;
  onDisable: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpenId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  const safeCount = items.filter((i) => i.safe && i.to !== null).length;
  const close = () => setOpenId(null);

  const chips = (list: ReviewItem[]) =>
    list.map((item) => (
      <Chip
        key={item.id}
        item={item}
        open={openId === item.id}
        onToggle={() => setOpenId((id) => (id === item.id ? null : item.id))}
        onPick={(w) => {
          close();
          onPick(item, w);
        }}
        onAdd={() => {
          close();
          onAdd(item);
        }}
        onIgnore={() => {
          close();
          onIgnore(item);
        }}
        canAddWords={canAddWords}
      />
    ));

  if (reviewing && items.length === 0) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-900 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-200"
      >
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Check className="h-3.5 w-3.5 shrink-0" />
          Todo revisado. Lo que ves en la caja es lo que se envía.
        </span>
        <span className="text-[11px]">Enter = enviar</span>
      </div>
    );
  }

  if (reviewing) {
    return (
      <div
        key={nudge}
        ref={rootRef}
        role="alert"
        className={cn(
          "space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/40",
          nudge > 0 && "animate-nudge",
        )}
      >
        <p className="flex items-start gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Todavía no se envió: {items.length === 1 ? "queda 1 cosa" : `quedan ${items.length} cosas`} por revisar. Corrige con un clic o
            ignóralas con ✕.
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">{chips(items)}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onSendAsIs} className={cn(secondaryButtonClass, "py-1 text-xs")}>
            Enviar así
          </button>
          {safeCount > 0 && (
            <button type="button" onClick={onApplySafeAndSend} className={cn(primaryButtonClass, "py-1 text-xs")}>
              Corregir las seguras y enviar
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-800 dark:text-amber-300">
          <span>Enter envía cuando no quede nada · Ctrl+Enter: enviar así</span>
          <button
            type="button"
            onClick={onDisable}
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            No volver a revisar en este equipo
          </button>
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;
  const shown = items.slice(0, MAX_CHIPS);
  return (
    <div ref={rootRef} className="flex flex-wrap items-center gap-1.5" aria-label="Cosas por revisar">
      <span className="mr-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <SpellCheck className="h-3.5 w-3.5 text-red-500" />
        Revisa:
      </span>
      {chips(shown)}
      {items.length > MAX_CHIPS && <span className="text-[11px] text-muted-foreground">y {items.length - MAX_CHIPS} más</span>}
      {safeCount > 1 && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onApplySafe}
          className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Corregir las seguras ({safeCount})
        </button>
      )}
    </div>
  );
}
