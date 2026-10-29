"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeSearch } from "@/lib/saved-replies";
import { useToast } from "@/components/ui/toast";
import {
  buildTemplateParams,
  isSendable,
  renderTemplatePreview,
  suggestFirstParam,
  templateCategoryLabel,
  type TemplateSummary,
} from "./whatsapp-templates";

export interface TemplatePickerProps {
  conversationId: string;
  open: boolean;
  onClose: () => void;
  /** Se llama cuando la plantilla ya salió (la bandeja recarga los mensajes). */
  onSent: () => void;
  /** Para precargar la primera variable si parece un nombre. */
  contactName?: string;
}

/**
 * Diálogo para enviar una plantilla aprobada de WhatsApp en una conversación
 * (obligatorio pasadas 24 h desde el último mensaje del contacto). Pide las
 * plantillas a GET /api/v1/templates y envía con POST /api/v1/templates/send.
 * Cada vez que se abre empieza de cero.
 */
export function TemplatePicker(props: TemplatePickerProps) {
  if (!props.open) return null;
  return <TemplatePickerDialog {...props} />;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; templates: TemplateSummary[] };

function TemplatePickerDialog({ conversationId, onClose, onSent, contactName }: TemplatePickerProps) {
  const toast = useToast();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TemplateSummary | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Clave de una sola vez: la misma en todos los reintentos del mismo envío
  // (misma plantilla y mismos valores); cambia si el asesor cambia algo.
  const sendKey = useRef<{ fingerprint: string; id: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/templates?conversationId=${encodeURIComponent(conversationId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setState({
            status: "error",
            message: typeof data.error === "string" ? data.error : "No se pudieron cargar las plantillas.",
          });
          return;
        }
        const templates = ((data.templates ?? []) as TemplateSummary[]).filter(isSendable);
        setState({ status: "ready", templates });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "No se pudieron cargar las plantillas. Revisa tu conexión." });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !sending) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, sending]);

  const templates = useMemo(() => (state.status === "ready" ? state.templates : []), [state]);
  const filtered = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return templates;
    return templates.filter((t) => normalizeSearch(`${t.name} ${t.body}`).includes(q));
  }, [templates, search]);

  function choose(template: TemplateSummary) {
    setSelected(template);
    setSendError(null);

    // La primera variable suele ser el nombre del contacto.
    setValues(template.slots.map((_, i) => (i === 0 ? suggestFirstParam(contactName) : "")));
  }

  const preview = selected ? renderTemplatePreview(selected, values) : null;
  const built = selected ? buildTemplateParams(selected, values) : null;
  const canSend = !!selected && !!built?.ok && !sending;

  async function send() {
    if (!selected || !built || !built.ok || sending) return;
    setSending(true);
    setSendError(null);
    const fingerprint = JSON.stringify([conversationId, selected.name, selected.language, built.params]);
    if (sendKey.current?.fingerprint !== fingerprint) sendKey.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const res = await fetch("/api/v1/templates/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          templateName: selected.name,
          language: selected.language,
          params: built.params,
          clientMessageId: sendKey.current.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data.error === "string" ? data.error : "No se pudo enviar la plantilla.";
        setSendError(message);
        toast.error(message);
        return;
      }
      toast.success("Plantilla enviada");
      onSent();
      onClose();
    } catch {
      // La respuesta se cortó: la plantilla pudo haber salido. Si se reintenta,
      // va con la misma clave y Zernio no la repite.
      setSendError("No se recibió respuesta. Puede que la plantilla ya haya salido: revisa el chat antes de reintentar.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade-in fixed inset-0 bg-black/50" onClick={() => !sending && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Enviar plantilla de WhatsApp"
        className="animate-pop-in relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Enviar plantilla de WhatsApp</h3>
            <p className="text-xs text-muted-foreground">
              Pasadas 24 horas desde el último mensaje del contacto, solo se pueden enviar plantillas aprobadas.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {state.status === "loading" ? (
          <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando plantillas…
          </div>
        ) : state.status === "error" ? (
          <p className="px-5 py-8 text-center text-sm text-destructive">{state.message}</p>
        ) : templates.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            <p>No hay plantillas aprobadas para esta cuenta de WhatsApp.</p>
            <Link href="/dashboard/settings/whatsapp-templates" className="mt-2 inline-block text-primary hover:underline">
              Ver plantillas
            </Link>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[16rem_1fr] md:overflow-hidden">
            <div className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
              <div className="relative p-3">
                <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar plantilla"
                  className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm"
                  autoFocus
                />
              </div>
              <ul className="max-h-48 min-h-0 flex-1 overflow-y-auto pb-2 md:max-h-none">
                {filtered.length === 0 && (
                  <li className="px-4 py-3 text-xs text-muted-foreground">Ninguna plantilla coincide.</li>
                )}
                {filtered.map((t) => (
                  <li key={`${t.name}:${t.language}`}>
                    <button
                      onClick={() => choose(t)}
                      className={cn(
                        "w-full px-4 py-2 text-left hover:bg-accent",
                        selected?.name === t.name && selected.language === t.language && "bg-accent",
                      )}
                    >
                      <span className="block truncate text-sm font-medium text-foreground">{t.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {templateCategoryLabel(t.category)} · {t.language}
                        {t.variableCount > 0 && ` · ${t.variableCount} variable${t.variableCount === 1 ? "" : "s"}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="min-h-0 overflow-y-auto p-5">
              {!selected || !preview ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Elige una plantilla para ver cómo quedará.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl rounded-tl-md bg-muted px-4 py-3 text-sm text-foreground">
                    {preview.header && <p className="mb-1 font-semibold">{preview.header}</p>}
                    {selected.headerFormat && selected.headerFormat !== "TEXT" && (
                      <p className="mb-1 text-xs italic text-muted-foreground">
                        Encabezado con {headerFormatLabel(selected.headerFormat)} (se envía el de la plantilla)
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">{preview.body}</p>
                    {preview.footer && <p className="mt-2 text-xs text-muted-foreground">{preview.footer}</p>}
                    {selected.buttons.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {selected.buttons
                          .filter((b) => b.text)
                          .map((b, i) => (
                            <span key={i} className="rounded-md border border-border bg-card px-2 py-1 text-xs text-primary">
                              {b.text}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>

                  {selected.slots.length > 0 && (
                    <div className="space-y-3">
                      {selected.slots.map((slot, i) => (
                        <label key={i} className="block">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground">
                            {slot.label}
                          </span>
                          <input
                            type="text"
                            value={values[i] ?? ""}
                            onChange={(e) =>
                              setValues((prev) => {
                                const next = [...prev];
                                next[i] = e.target.value;
                                return next;
                              })
                            }
                            disabled={sending}
                            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                          />
                        </label>
                      ))}
                    </div>
                  )}

                  {sendError && <p className="text-sm text-destructive">{sendError}</p>}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            disabled={sending}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={send}
            disabled={!canSend}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

function headerFormatLabel(format: string): string {
  switch (format) {
    case "IMAGE":
      return "imagen";
    case "VIDEO":
      return "video";
    case "DOCUMENT":
      return "documento";
    default:
      return "archivo";
  }
}
