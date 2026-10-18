"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseNodeTemplate, type NodeTemplate } from "@/lib/flow-engine/send-mode";
import { isSendable, renderTemplatePreview, type TemplateSummary } from "@/lib/whatsapp-templates";

interface SendTemplateSectionProps {
  template: unknown;
  onChange: (template: NodeTemplate | null) => void;
}

interface WhatsAppChannel {
  id: string;
  label: string;
}

/** Variables que se reemplazan al enviar (el motor las arma con lib/cases/auto-template.ts). */
const VARIABLE_TOKENS = [
  { token: "{nombre}", label: "Nombre del contacto" },
  { token: "{fecha_clave}", label: "Fecha clave" },
  { token: "{empresa}", label: "Empresa" },
  { token: "{sede}", label: "Sede o equipo" },
];

/** Resultado de la carga para un canal; mientras no coincide con el canal elegido, se está cargando. */
type LoadState =
  | { status: "error"; channelId: string; message: string }
  | { status: "ready"; channelId: string; templates: TemplateSummary[] };

/**
 * Plantilla de WhatsApp del nodo Enviar mensaje. Se usa solo cuando la ventana
 * de 24 h está cerrada; con la ventana abierta se envía el texto del nodo.
 */
export function SendTemplateSection({ template: rawTemplate, onChange }: SendTemplateSectionProps) {
  const template = parseNodeTemplate(rawTemplate);
  const [enabled, setEnabled] = useState(!!template);
  const [channels, setChannels] = useState<WhatsAppChannel[] | null>(null);
  const [channelId, setChannelId] = useState("");
  const [loaded, setLoaded] = useState<LoadState | null>(null);
  const state = useMemo<{ status: "loading" } | LoadState>(
    () => (loaded && loaded.channelId === channelId ? loaded : { status: "loading" }),
    [loaded, channelId],
  );

  // Canales de WhatsApp activos (las plantillas son de la cuenta de cada canal).
  useEffect(() => {
    if (!enabled || channels) return;
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("channels")
        .select("id, display_name, username")
        .eq("platform", "whatsapp")
        .eq("is_active", true);
      if (cancelled) return;
      const list = (data ?? []).map((c) => ({ id: c.id, label: c.display_name || c.username || "WhatsApp" }));
      setChannels(list);
      if (list.length > 0) setChannelId((current) => current || list[0].id);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, channels]);

  useEffect(() => {
    if (!enabled || !channelId) return;
    let cancelled = false;
    fetch(`/api/v1/templates?channelId=${encodeURIComponent(channelId)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoaded({
            status: "error",
            channelId,
            message: typeof body.error === "string" ? body.error : "No se pudieron cargar las plantillas.",
          });
          return;
        }
        setLoaded({
          status: "ready",
          channelId,
          templates: ((body.templates ?? []) as TemplateSummary[]).filter(isSendable),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({ status: "error", channelId, message: "No se pudieron cargar las plantillas. Revisa tu conexión." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, channelId]);

  const templates = useMemo(() => (state.status === "ready" ? state.templates : []), [state]);
  const selected = template
    ? templates.find((t) => t.name === template.template_name && t.language === template.language)
    : undefined;
  const slotCount = selected ? selected.slots.length : template?.params.length ?? 0;

  function choose(key: string) {
    if (!key) {
      onChange(null);
      return;
    }
    const [name, language] = key.split("|");
    const next = templates.find((t) => t.name === name && t.language === language);
    if (!next) return;
    // La primera variable suele ser el nombre del contacto.
    onChange({
      template_name: next.name,
      language: next.language,
      params: next.slots.map((_, i) => (i === 0 ? "{nombre}" : "")),
    });
  }

  function setParam(index: number, value: string) {
    if (!template) return;
    const params = Array.from({ length: Math.max(slotCount, template.params.length) }, (_, i) => template.params[i] ?? "");
    params[index] = value;
    onChange({ ...template, params });
  }

  const preview =
    selected && template
      ? renderTemplatePreview(
          selected,
          template.params.map((p) => p.replace(/\{[^}]+\}/g, "…") || ""),
        )
      : null;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            if (!e.target.checked) onChange(null);
          }}
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        <div>
          <p className="text-sm font-medium text-foreground">Usar plantilla de WhatsApp si pasaron 24 h</p>
          <p className="text-xs text-muted-foreground">
            Si la ventana de 24 h está abierta se envía el texto de arriba. Si está cerrada y hay una plantilla, se
            envía la plantilla. Si está cerrada y no hay plantilla, el mensaje no se envía y queda registrado el motivo.
          </p>
        </div>
      </label>

      {enabled && (
        <div className="mt-3 space-y-3">
          {channels === null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Cargando canales...
            </div>
          ) : channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">Conecta un canal de WhatsApp para usar plantillas.</p>
          ) : (
            <>
              {channels.length > 1 && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Canal de WhatsApp</label>
                  <select
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Plantilla aprobada</label>
                {state.status === "loading" && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Cargando plantillas...
                  </div>
                )}
                {state.status === "error" && <p className="text-xs text-red-600">{state.message}</p>}
                {state.status === "ready" && (
                  <select
                    value={template ? `${template.template_name}|${template.language}` : ""}
                    onChange={(e) => choose(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Selecciona una plantilla...</option>
                    {template && !selected && (
                      <option value={`${template.template_name}|${template.language}`}>
                        {template.template_name} ({template.language})
                      </option>
                    )}
                    {templates.map((t) => (
                      <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                        {t.name} ({t.language})
                      </option>
                    ))}
                  </select>
                )}
                {state.status === "ready" && templates.length === 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">No hay plantillas aprobadas en este canal.</p>
                )}
              </div>
            </>
          )}

          {template && slotCount > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Variables de la plantilla</p>
              {Array.from({ length: slotCount }, (_, i) => (
                <div key={i}>
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    {selected?.slots[i]?.label ?? `Variable ${i + 1}`}
                  </label>
                  <input
                    type="text"
                    value={template.params[i] ?? ""}
                    onChange={(e) => setParam(i, e.target.value)}
                    placeholder="{nombre}"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">
                Puedes escribir texto y usar {VARIABLE_TOKENS.map((v) => v.token).join(", ")} o un campo personalizado
                con {"{campo:slug}"}. WhatsApp no acepta variables vacías: si el contacto no tiene el dato, la
                plantilla no se envía.
              </p>
            </div>
          )}

          {preview && (
            <div className="rounded-lg bg-muted p-3 text-xs text-foreground">
              {preview.header && <p className="mb-1 font-semibold">{preview.header}</p>}
              <p className="whitespace-pre-wrap">{preview.body}</p>
              {preview.footer && <p className="mt-1 text-muted-foreground">{preview.footer}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
