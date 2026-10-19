"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import {
  TEMPLATE_BODY_MAX,
  extractPlaceholders,
  templateCategoryLabel,
  templateStatusLabel,
  type TemplateSummary,
} from "@/components/composer/whatsapp-templates";

interface ChannelOption {
  id: string;
  name: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; templates: TemplateSummary[] };

const STATUS_STYLES: Record<string, string> = {
  APPROVED: "bg-green-500/10 text-green-600 dark:text-green-400",
  PENDING: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  IN_APPEAL: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  REJECTED: "bg-destructive/10 text-destructive",
  PAUSED: "bg-muted text-muted-foreground",
  DISABLED: "bg-muted text-muted-foreground",
};

const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

interface CreateForm {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  body: string;
  examples: string[];
}

const EMPTY_FORM: CreateForm = { name: "", language: "es", category: "UTILITY", body: "", examples: [] };

function Header() {
  return (
    <div className="border-b border-border px-8 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/settings"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Volver a Configuración"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Plantillas de WhatsApp</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mensajes que Meta aprueba de antemano. Son la única forma de escribirle a un contacto pasadas 24 horas
            desde su último mensaje.
          </p>
        </div>
      </div>
    </div>
  );
}

export function TemplatesView({ channels, canCreate }: { channels: ChannelOption[]; canCreate: boolean }) {
  if (channels.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Header />
        <p className="mx-auto mt-10 max-w-md px-8 text-center text-sm text-muted-foreground">
          Conecta un canal de WhatsApp para usar plantillas.
        </p>
      </div>
    );
  }
  return <TemplatesPanel channels={channels} canCreate={canCreate} />;
}

function TemplatesPanel({ channels, canCreate }: { channels: ChannelOption[]; canCreate: boolean }) {
  const [channelId, setChannelId] = useState(channels[0].id);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<CreateForm | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/templates?channelId=${encodeURIComponent(channelId)}`)
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
        setState({ status: "ready", templates: (data.templates ?? []) as TemplateSummary[] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "No se pudieron cargar las plantillas. Revisa tu conexión." });
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, reloadKey]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setReloadKey((k) => k + 1);
  }, []);

  const templates = useMemo(() => {
    if (state.status !== "ready") return [];
    const rank = (s: string) => (s === "APPROVED" ? 0 : s === "PENDING" || s === "IN_APPEAL" ? 1 : 2);
    return [...state.templates].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
  }, [state]);

  function updateBody(body: string) {
    setForm((f) => {
      if (!f) return f;
      const count = extractPlaceholders(body).length;
      const examples = Array.from({ length: count }, (_, i) => f.examples[i] ?? "");
      return { ...f, body, examples };
    });
  }

  async function create() {
    if (!form || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, ...form }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "No se pudo crear la plantilla.");
        return;
      }
      setForm(null);
      toast.success(
        data.template?.status === "APPROVED"
          ? "Plantilla creada y aprobada."
          : "Plantilla enviada a Meta para revisión. Podrás usarla cuando quede aprobada (suele tardar unos minutos).",
      );
      reload();
    } catch {
      toast.error("No se pudo crear la plantilla. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Header />

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {channels.length > 1 ? (
                <select
                  value={channelId}
                  onChange={(e) => {
                    setChannelId(e.target.value);
                    setState({ status: "loading" });
                    setForm(null);
                  }}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  aria-label="Canal de WhatsApp"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{channels[0].name}</span>
              )}
              <button
                onClick={reload}
                disabled={state.status === "loading"}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                title="Actualizar estados"
                aria-label="Actualizar"
              >
                <RefreshCw className={cn("h-4 w-4", state.status === "loading" && "animate-spin")} />
              </button>
            </div>
            {canCreate && !form && (
              <button
                onClick={() => {
                  setForm({ ...EMPTY_FORM });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                Nueva plantilla
              </button>
            )}
          </div>

          {canCreate && form && (
            <div className="space-y-4 rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">Nueva plantilla</h2>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block sm:col-span-1">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Nombre</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="recordatorio_recompra"
                    className={cn(inputClass, "font-mono")}
                    autoFocus
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Minúsculas, números y guion bajo.
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Idioma</span>
                  <input
                    type="text"
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value })}
                    placeholder="es"
                    className={inputClass}
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">Por ejemplo es, es_MX o en_US.</span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Categoría</span>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as CreateForm["category"] })}
                    className={inputClass}
                  >
                    <option value="UTILITY">Utilidad (avisos, recordatorios)</option>
                    <option value="MARKETING">Marketing (ofertas)</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Cuerpo</span>
                <textarea
                  value={form.body}
                  maxLength={TEMPLATE_BODY_MAX}
                  onChange={(e) => updateBody(e.target.value)}
                  rows={5}
                  placeholder="Hola {{1}}, tu membresía vence el {{2}}. Responde este mensaje para renovarla."
                  className={inputClass}
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Usa {"{{1}}"}, {"{{2}}"}... para los datos que cambian en cada envío. No puede empezar ni terminar con
                  una variable. {form.body.length}/{TEMPLATE_BODY_MAX}
                </span>
              </label>

              {form.examples.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Ejemplos de cada variable (Meta los pide para revisar la plantilla)
                  </p>
                  {form.examples.map((example, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{`{{${i + 1}}}`}</span>
                      <input
                        type="text"
                        value={example}
                        onChange={(e) =>
                          setForm((f) => {
                            if (!f) return f;
                            const examples = [...f.examples];
                            examples[i] = e.target.value;
                            return { ...f, examples };
                          })
                        }
                        className={inputClass}
                        placeholder={i === 0 ? "María" : "30 de noviembre"}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setForm(null)}
                  disabled={saving}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={create}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saving ? "Enviando…" : "Enviar a revisión"}
                </button>
              </div>
            </div>
          )}

          {state.status === "loading" ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando plantillas…
            </div>
          ) : state.status === "error" ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-destructive">
              {state.message}
            </p>
          ) : templates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              Esta cuenta aún no tiene plantillas.
              {canCreate ? " Crea la primera con “Nueva plantilla”." : " Pídele a un Administrador que cree una."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {templates.map((t) => (
                <li key={`${t.name}:${t.language}`} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{t.name}</span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium",
                        STATUS_STYLES[t.status] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {templateStatusLabel(t.status)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {templateCategoryLabel(t.category)} · {t.language}
                      {t.variableCount > 0 && ` · ${t.variableCount} variable${t.variableCount === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  {t.body && (
                    <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{t.body}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
