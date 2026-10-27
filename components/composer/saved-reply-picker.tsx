"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Image as ImageIcon, Loader2, MessageSquareText, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { listSavedReplies, type SavedReplyView } from "@/lib/actions/saved-replies";
import { applyReplyVariables, applyReplyVariablesDetailed, searchSavedReplies } from "@/lib/saved-replies";
import { formatRelative } from "@/lib/format";

/** Lo que entrega el selector al elegir una respuesta. */
export interface PickedReply {
  text: string;
  /** Variables que quedaron sin dato (para avisar). */
  empty: string[];
  /** Archivo de la respuesta (foto o PDF), si tiene. */
  attachment: { replyId: string; path: string; name: string; mime: string; size: number | null } | null;
}

/** "Actualizada hace 3 días", "Actualizada ayer", "Actualizada el 16 oct 2026". */
export function updatedLabel(iso: string, now = new Date()): string {
  const rel = formatRelative(iso, now);
  if (!rel) return "";
  return /^(hace|ayer|ahora)/.test(rel) ? `Actualizada ${rel}` : `Actualizada el ${rel}`;
}

export interface SavedReplyPickerProps {
  open: boolean;
  /** Lo que se escribió después de `/` (con o sin la barra). */
  query: string;
  /**
   * Recibe el texto con las variables ya reemplazadas, para pegarlo en la caja,
   * las variables que quedaron sin dato (para avisar) y el archivo, si tiene.
   */
  onSelect: (result: PickedReply) => void;
  onClose: () => void;
  context: {
    contactName?: string;
    agentName?: string;
    teamName?: string;
    workspaceName?: string;
    customFields?: Record<string, string>;
    caseTypeId?: string | null;
  };
}

const SCOPE_LABELS: Record<SavedReplyView["scope"], string> = {
  workspace: "Empresa",
  team: "Equipo",
  personal: "Personal",
};

// Las respuestas casi no cambian: se guardan unos segundos para que abrir el
// selector varias veces seguidas no vuelva a pedirlas.
const CACHE_MS = 30_000;
let cache: { at: number; replies: SavedReplyView[] } | null = null;

/** Para la pantalla de configuración: tras crear o editar, el selector vuelve a pedirlas. */
export function invalidateSavedRepliesCache() {
  cache = null;
}

/**
 * Buscador de respuestas guardadas que se abre al escribir `/` en la caja de
 * texto de la bandeja. Se coloca con `absolute bottom-full` sobre su contenedor
 * (que debe ser `relative`). Mientras está abierto captura las flechas, Enter,
 * Tab y Escape, así que la caja de texto puede seguir con el foco. No envía
 * nada: `onSelect` entrega el texto para que la persona lo revise.
 */
export function SavedReplyPicker({ open, query, onSelect, onClose, context }: SavedReplyPickerProps) {
  // null = todavía no se cargaron.
  const [loaded, setLoaded] = useState<SavedReplyView[] | null>(() => cache?.replies ?? null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    // Con la caché al día no hay nada que pedir (el estado ya parte de ella).
    if (cache && Date.now() - cache.at < CACHE_MS) return;
    let cancelled = false;
    listSavedReplies()
      .then((result) => {
        if (cancelled) return;
        if ("error" in result) {
          setError(result.error);
          return;
        }
        cache = { at: Date.now(), replies: result.data.replies };
        setError(null);
        setLoaded(result.data.replies);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudieron cargar las respuestas guardadas.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const available = loaded ?? cache?.replies ?? null;
  const replies = useMemo(() => available ?? [], [available]);
  const loading = available === null && !error;
  const caseTypeId = context.caseTypeId ?? null;
  const results = useMemo(
    () => searchSavedReplies(replies, query, caseTypeId),
    [replies, query, caseTypeId],
  );

  // Cada búsqueda empieza en la primera coincidencia: la posición se guarda
  // junto con la búsqueda a la que pertenece.
  const resetKey = `${query}\u0000${results.length}`;
  const [pointer, setPointer] = useState({ key: resetKey, index: 0 });
  const active = pointer.key === resetKey ? Math.min(pointer.index, Math.max(results.length - 1, 0)) : 0;
  const moveActive = useCallback(
    (step: number) =>
      setPointer((p) => {
        const current = p.key === resetKey ? p.index : 0;
        return { key: resetKey, index: (current + step + results.length) % results.length };
      }),
    [resetKey, results.length],
  );
  const setActive = useCallback((index: number) => setPointer({ key: resetKey, index }), [resetKey]);

  const { contactName, agentName, teamName, workspaceName, customFields } = context;
  const choose = useCallback(
    (reply: SavedReplyView) => {
      const filled = applyReplyVariablesDetailed(reply.body, { contactName, agentName, teamName, workspaceName, customFields, now: new Date() });
      onSelect({
        ...filled,
        attachment: reply.attachment ? { replyId: reply.id, ...reply.attachment } : null,
      });
    },
    [onSelect, contactName, agentName, teamName, workspaceName, customFields],
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        moveActive(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        moveActive(-1);
      } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        choose(results[Math.min(active, results.length - 1)]);
      }
    }
    // En captura, para ganarle al Enter de la caja de texto (que enviaría el mensaje).
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, results, active, choose, onClose, moveActive]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Respuestas guardadas"
      className="animate-pop-in absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <MessageSquareText className="h-3.5 w-3.5" />
          Respuestas guardadas
        </span>
        <span className="text-[11px] text-muted-foreground">↑ ↓ para moverte · Enter para usar · Esc para cerrar</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando...
        </div>
      ) : error ? (
        <p className="px-3 py-4 text-sm text-destructive">{error}</p>
      ) : results.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          {replies.length === 0
            ? "Aún no hay respuestas guardadas."
            : "Ninguna respuesta coincide con lo que escribiste."}
        </p>
      ) : (
        <ul ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
          {results.map((reply, index) => {
            const suggested = !!caseTypeId && reply.caseTypeId === caseTypeId;
            return (
              <li
                key={reply.id}
                role="option"
                aria-selected={index === active}
                // mouseDown (y no click) para que la caja de texto no pierda el foco.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(reply);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn("cursor-pointer px-3 py-2", index === active ? "bg-accent" : "hover:bg-accent/60")}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{reply.title}</span>
                  {reply.shortcut && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {reply.shortcut}
                    </span>
                  )}
                  {suggested && (
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      Sugerida
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {reply.scope === "team" && reply.teamName ? reply.teamName : SCOPE_LABELS[reply.scope]}
                  </span>
                </div>
                {reply.body && (
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">
                    {applyReplyVariables(reply.body, { contactName, agentName, teamName, workspaceName, customFields })}
                  </p>
                )}
                {reply.attachment && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    {reply.attachment.mime.startsWith("image/") ? (
                      <ImageIcon className="h-3 w-3 shrink-0" />
                    ) : (
                      <FileText className="h-3 w-3 shrink-0 text-red-500" />
                    )}
                    <span className="truncate">{reply.attachment.name}</span>
                    <span className="shrink-0">· {updatedLabel(reply.updatedAt)}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-border px-3 py-1.5">
        <Link
          href="/dashboard/settings/replies"
          onMouseDown={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="h-3 w-3" />
          Administrar respuestas
        </Link>
      </div>
    </div>
  );
}
