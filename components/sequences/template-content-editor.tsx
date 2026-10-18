"use client";

// Selector de plantilla aprobada de WhatsApp con sus variables por contacto
// ({nombre}, {fecha_clave}, {empresa} y campos personalizados). Lo usan las
// difusiones y los pasos de secuencia: el valor es el mismo
// `{ kind: 'template', template_name, language, params }`.

import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CONTACT_VARIABLES, customFieldToken } from "@/lib/broadcasts/tokens";
import {
  isSendable,
  renderTemplatePreview,
  templateCategoryLabel,
  type TemplateSummary,
} from "@/lib/whatsapp-templates";
import type { TemplateMessageContent } from "@/lib/types/database";

interface Props {
  workspaceId: string;
  value: TemplateMessageContent | null;
  onChange: (value: TemplateMessageContent | null) => void;
  disabled?: boolean;
}

interface ChannelOption {
  id: string;
  name: string;
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

export function TemplateContentEditor({ workspaceId, value, onChange, disabled }: Props) {
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [channelId, setChannelId] = useState("");
  const [loaded, setLoaded] = useState<{ channelId: string; templates: TemplateSummary[]; error: string | null } | null>(null);
  const [fields, setFields] = useState<{ slug: string; name: string }[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);

  // Canales de WhatsApp y campos personalizados.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const [channelsRes, fieldsRes] = await Promise.all([
        supabase
          .from("channels")
          .select("id, display_name, username")
          .eq("workspace_id", workspaceId)
          .eq("platform", "whatsapp")
          .eq("is_active", true)
          .order("created_at"),
        supabase
          .from("custom_field_definitions")
          .select("slug, name")
          .eq("workspace_id", workspaceId)
          .order("name"),
      ]);
      if (cancelled) return;
      const list = (channelsRes.data ?? []).map((c) => ({
        id: c.id,
        name: c.display_name || c.username || "WhatsApp",
      }));
      setChannels(list);
      setChannelId((prev) => prev || list[0]?.id || "");
      setFields(fieldsRes.data ?? []);
      setLoadingChannels(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Plantillas del canal elegido.
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    fetch(`/api/v1/templates?channelId=${encodeURIComponent(channelId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudieron cargar las plantillas");
        if (!cancelled) setLoaded({ channelId, templates: data.templates as TemplateSummary[], error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoaded({
            channelId,
            templates: [],
            error: err instanceof Error ? err.message : "No se pudieron cargar las plantillas",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const loadingTemplates = !!channelId && loaded?.channelId !== channelId;
  const templates = useMemo(() => (loaded?.channelId === channelId ? loaded.templates : []), [loaded, channelId]);
  const error = loaded?.channelId === channelId ? loaded.error : null;
  const sendable = useMemo(() => templates.filter(isSendable), [templates]);
  const selected = useMemo(
    () =>
      value
        ? templates.find((t) => t.name === value.template_name && t.language === value.language) ?? null
        : null,
    [templates, value],
  );
  const variables = useMemo(
    () => [
      ...CONTACT_VARIABLES,
      ...fields.map((f) => ({ token: customFieldToken(f.slug), label: f.name })),
    ],
    [fields],
  );

  function pick(key: string) {
    if (!key) return onChange(null);
    const [name, language] = key.split("|");
    const t = templates.find((x) => x.name === name && x.language === language);
    if (!t) return;
    onChange({
      kind: "template",
      template_name: t.name,
      language: t.language,
      params: t.slots.map(() => ""),
    });
  }

  function setParam(index: number, text: string) {
    if (!value) return;
    const params = [...value.params];
    while (params.length <= index) params.push("");
    params[index] = text;
    onChange({ ...value, params });
  }

  if (loadingChannels) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando plantillas...
      </p>
    );
  }

  if (channels.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Conecta un canal de WhatsApp para usar plantillas.
      </p>
    );
  }

  const preview = selected && value ? renderTemplatePreview(selected, value.params) : null;
  const selectedKey = value ? `${value.template_name}|${value.language}` : "";

  return (
    <div className="space-y-3">
      {channels.length > 1 && (
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          disabled={disabled}
          className={inputClass}
          aria-label="Canal de WhatsApp"
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}

      <select
        value={selectedKey}
        onChange={(e) => pick(e.target.value)}
        disabled={disabled || loadingTemplates}
        className={inputClass}
        aria-label="Plantilla de WhatsApp"
      >
        <option value="">{loadingTemplates ? "Cargando..." : "Elige una plantilla aprobada..."}</option>
        {value && !selected && !loadingTemplates && (
          <option value={selectedKey}>
            {value.template_name} ({value.language})
          </option>
        )}
        {sendable.map((t) => (
          <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
            {t.name} ({t.language}) - {templateCategoryLabel(t.category)}
          </option>
        ))}
      </select>

      {error && (
        <p className="flex items-center gap-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      {!error && !loadingTemplates && sendable.length === 0 && (
        <p className="text-xs text-muted-foreground">No hay plantillas aprobadas en este canal todavía.</p>
      )}

      {selected && value && (
        <>
          {selected.slots.map((slot, i) => (
            <div key={`${slot.section}-${i}`} className="space-y-1">
              <label className="text-xs font-medium">{slot.label}</label>
              <input
                type="text"
                value={value.params[i] ?? ""}
                onChange={(e) => setParam(i, e.target.value)}
                disabled={disabled}
                placeholder="Escribe un texto o usa una variable..."
                className={inputClass}
              />
              {!disabled && (
                <div className="flex flex-wrap gap-1">
                  {variables.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      title={v.label}
                      onClick={() => setParam(i, `${value.params[i] ?? ""}${v.token}`)}
                      className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                    >
                      {v.token}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {preview && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              {preview.header && <p className="mb-1 font-medium">{preview.header}</p>}
              <p className="whitespace-pre-wrap">{preview.body}</p>
              {preview.footer && <p className="mt-1 text-xs text-muted-foreground">{preview.footer}</p>}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Cada contacto recibe sus propios valores. Si una variable queda vacía para un contacto, a ese contacto no se le envía.
          </p>
        </>
      )}
    </div>
  );
}
