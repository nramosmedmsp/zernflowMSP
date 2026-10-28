"use client";

// Franja "Revisa:" debajo de la caja de texto: cada palabra que el diccionario
// no conoce, tachada, con su corrección a un clic. La flechita abre otras
// sugerencias, "Agregar al diccionario de la tienda" e "Ignorar en este mensaje".

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookPlus, ChevronDown, EyeOff, SpellCheck } from "lucide-react";
import type { SpellIssue } from "@/lib/spell-check";

const MAX_CHIPS = 5;

function Chip({
  issue,
  open,
  onToggle,
  onPick,
  onAdd,
  onIgnore,
  canAddWords,
}: {
  issue: SpellIssue;
  open: boolean;
  onToggle: () => void;
  onPick: (word: string) => void;
  onAdd: () => void;
  onIgnore: () => void;
  canAddWords: boolean;
}) {
  const [first, ...rest] = issue.suggestions;
  return (
    <span className="relative inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 py-0.5 pl-2 pr-0.5 text-xs dark:border-red-900/60 dark:bg-red-950/30">
      <span className="text-red-700 line-through decoration-red-500/70 dark:text-red-300">{issue.word}</span>
      {first ? (
        <>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(first)}
            title={`Cambiar por «${first}»`}
            className="rounded-full bg-white px-2 py-0.5 font-medium text-green-700 shadow-sm ring-1 ring-green-200 hover:bg-green-50 dark:bg-background dark:text-green-400"
          >
            {first}
          </button>
        </>
      ) : (
        <span className="px-1 text-[11px] text-muted-foreground">sin sugerencias</span>
      )}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
        aria-label={`Más opciones para «${issue.word}»`}
        aria-expanded={open}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-red-100 hover:text-foreground dark:hover:bg-red-950/60"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="menu"
          className="animate-pop-in absolute bottom-full left-0 z-40 mb-1.5 w-64 rounded-lg border border-border bg-card p-1 text-left shadow-lg"
        >
          {issue.suggestions.length > 0 && (
            <>
              <span className="block px-2 pb-1 pt-0.5 text-[11px] font-medium text-muted-foreground">Cambiar «{issue.word}» por</span>
              {[first, ...rest].map((w) => (
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
            {canAddWords ? `Agregar «${issue.word}» al diccionario de la tienda` : `Pedir agregar «${issue.word}» al diccionario`}
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

export function SpellStrip({
  issues,
  onPick,
  onPickAll,
  onAdd,
  onIgnore,
  canAddWords = false,
}: {
  issues: SpellIssue[];
  onPick: (issue: SpellIssue, word: string) => void;
  onPickAll: () => void;
  onAdd: (issue: SpellIssue) => void;
  onIgnore: (issue: SpellIssue) => void;
  /** Administradores agregan; los demás piden que se agregue. */
  canAddWords?: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openKey) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpenKey(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenKey(null);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openKey]);

  if (issues.length === 0) return null;
  const shown = issues.slice(0, MAX_CHIPS);
  const fixable = issues.some((i) => i.suggestions.length > 0);
  const key = (i: SpellIssue) => `${i.word}:${i.start}`;
  const close = () => setOpenKey(null);

  return (
    <div ref={rootRef} className="flex flex-wrap items-center gap-1.5" aria-label="Palabras para revisar">
      <span className="mr-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <SpellCheck className="h-3.5 w-3.5 text-red-500" />
        Revisa:
      </span>
      {shown.map((issue) => (
        <Chip
          key={key(issue)}
          issue={issue}
          open={openKey === key(issue)}
          onToggle={() => setOpenKey((k) => (k === key(issue) ? null : key(issue)))}
          onPick={(w) => {
            close();
            onPick(issue, w);
          }}
          onAdd={() => {
            close();
            onAdd(issue);
          }}
          onIgnore={() => {
            close();
            onIgnore(issue);
          }}
          canAddWords={canAddWords}
        />
      ))}
      {issues.length > MAX_CHIPS && (
        <span className="text-[11px] text-muted-foreground">y {issues.length - MAX_CHIPS} más</span>
      )}
      {fixable && issues.length > 1 && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onPickAll}
          className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Corregir todo
        </button>
      )}
    </div>
  );
}
