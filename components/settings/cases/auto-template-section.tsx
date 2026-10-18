"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { getAutoTemplateContext, saveAutoTemplate, type AutoTemplateContext } from "@/lib/actions/case-config";
import { isSendable, renderTemplatePreview, type TemplateSummary as WhatsAppTemplate } from "@/lib/whatsapp-templates";
import {
  buildAutoTemplate,
  mappingFor,
  paramOptions,
  sampleParamValue,
} from "./auto-template-rules";
import { SectionTitle, inputClass, primaryButtonClass, secondaryButtonClass, type TabProps } from "./shared";

type TemplatesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; templates: WhatsAppTemplate[] };

const keyOf = (t: { name: string; language: string }) => `${t.name}|${t.language}`;

/**
 * «Plantilla al activarse»: solo para tipos proactivos y solo si hay un canal
 * de WhatsApp conectado. Elige una plantilla aprobada y mapea cada variable.
 */
export function AutoTemplateSection({ type, run, busy }: Pick<TabProps, "type" | "run" | "busy">) {
  const [ctx, setCtx] = useState<AutoTemplateContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getAutoTemplateContext(type.id)
      .then((r) => {
        if (cancelled) return;
        if ("error" in r) setCtxError(r.error);
        else {
          setCtx(r.context);
          setCtxError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setCtxError("No se pudo cargar la plantilla. Inténtalo de nuevo.");
      });
    return () => {
      cancelled = true;
    };
  }, [type.id, reloadKey]);

  if (ctxError) return <p className="text-xs text-destructive">{ctxError}</p>;
  if (!ctx) return <p className="text-xs text-muted-foreground">Cargando plantilla...</p>;
  // Sin WhatsApp conectado no se ofrece (si hubiera una guardada, se puede quitar).
  if (ctx.channels.length === 0 && !ctx.current) return null;

  return <AutoTemplateEditor key={`${type.id}-${reloadKey}`} type={type} ctx={ctx} run={run} busy={busy} onSaved={() => setReloadKey((k) => k + 1)} />;
}

function AutoTemplateEditor({
  type,
  ctx,
  run,
  busy,
  onSaved,
}: Pick<TabProps, "type" | "run" | "busy"> & { ctx: AutoTemplateContext; onSaved: () => void }) {
  const [channelId, setChannelId] = useState(ctx.channels[0]?.id ?? "");
  const [state, setState] = useState<TemplatesState>(
    ctx.channels.length === 0 ? { status: "ready", templates: [] } : { status: "loading" },
  );
  const [selected, setSelected] = useState<string>(ctx.current ? keyOf({ name: ctx.current.template_name, language: ctx.current.language }) : "");
  const [mapping, setMapping] = useState<string[]>(ctx.current?.params ?? []);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!channelId) return;
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
        setState({ status: "ready", templates: (data.templates ?? []) as WhatsAppTemplate[] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "No se pudieron cargar las plantillas. Revisa tu conexión." });
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const approved = useMemo(
    () => (state.status === "ready" ? state.templates.filter(isSendable).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [state],
  );
  const template = approved.find((t) => keyOf(t) === selected) ?? null;
  const options = useMemo(() => paramOptions(ctx.customFields), [ctx.customFields]);
  const current = ctx.current;

  function pickTemplate(key: string) {
    setSelected(key);
    setLocalError(null);
    const t = approved.find((x) => keyOf(x) === key);
    setMapping(t ? mappingFor(t.slots.length, current, t.name, t.language) : []);
  }

  const mappingChanged =
    !current ||
    !template ||
    current.template_name !== template.name ||
    current.language !== template.language ||
    current.params.join("\u0001") !== mapping.join("\u0001");

  async function save() {
    if (!template) {
      setLocalError("Elige una plantilla.");
      return;
    }
    const built = buildAutoTemplate({
      templateName: template.name,
      language: template.language,
      params: mapping,
      fieldSlugs: new Set(ctx.customFields.map((f) => f.slug)),
      slotCount: template.slots.length,
    });
    if (!built.ok) {
      setLocalError(built.error);
      return;
    }
    setLocalError(null);
    if (await run(() => saveAutoTemplate({ caseTypeId: type.id, autoTemplate: built.value }), "Plantilla guardada.")) onSaved();
  }

  async function remove() {
    setLocalError(null);
    if (await run(() => saveAutoTemplate({ caseTypeId: type.id, autoTemplate: null }), "Se quitó la plantilla.")) {
      setSelected("");
      setMapping([]);
      onSaved();
    }
  }

  const preview = template
    ? renderTemplatePreview(
        template,
        mapping.map((token) => (token ? sampleParamValue(token, ctx.customFields) : "")),
      )
    : null;

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <SectionTitle
        title="Plantilla al activarse"
        hint="Cuando una gestión de este tipo se activa (llega su día), se envía esta plantilla de WhatsApp al contacto, aunque nunca haya escrito. La gestión pasa a la segunda etapa abierta. Si el envío falla, se avisa al responsable."
      />

      {current && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span>
            Plantilla actual: <span className="font-medium">{current.template_name}</span>{" "}
            <span className="text-xs text-muted-foreground">({current.language})</span>
          </span>
          <button type="button" className={`${secondaryButtonClass} ml-auto text-destructive`} disabled={busy} onClick={remove}>
            <Trash2 className="h-4 w-4" />
            Quitar plantilla
          </button>
        </div>
      )}

      {ctx.channels.length === 0 ? (
        <p className="text-xs text-muted-foreground">Conecta un canal de WhatsApp para elegir otra plantilla.</p>
      ) : (
        <>
          {ctx.channels.length > 1 && (
            <div>
              <label htmlFor="auto-template-channel" className="mb-1 block text-xs font-medium text-muted-foreground">
                Canal de WhatsApp
              </label>
              <select
                id="auto-template-channel"
                value={channelId}
                onChange={(e) => {
                  setChannelId(e.target.value);
                  setState({ status: "loading" });
                }}
                disabled={busy}
                className={`${inputClass} w-full max-w-xs`}
              >
                {ctx.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {state.status === "loading" && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Cargando plantillas aprobadas...
            </p>
          )}
          {state.status === "error" && <p className="text-xs text-destructive">{state.message}</p>}

          {state.status === "ready" &&
            (approved.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No hay plantillas aprobadas en este canal. Crea una en Configuración → Plantillas de WhatsApp y espera su aprobación.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <label htmlFor="auto-template-pick" className="mb-1 block text-xs font-medium text-muted-foreground">
                    Plantilla aprobada
                  </label>
                  <select
                    id="auto-template-pick"
                    value={selected}
                    onChange={(e) => pickTemplate(e.target.value)}
                    disabled={busy}
                    className={`${inputClass} w-full`}
                  >
                    <option value="">Elige una plantilla...</option>
                    {approved.map((t) => (
                      <option key={keyOf(t)} value={keyOf(t)}>
                        {t.name} ({t.language})
                      </option>
                    ))}
                  </select>
                </div>

                {template && (
                  <>
                    {template.slots.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Esta plantilla no tiene variables.</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Qué dato va en cada variable</p>
                        {template.slots.map((slot, i) => (
                          <div key={`${slot.section}-${slot.token}-${i}`} className="flex flex-wrap items-center gap-2">
                            <span className="w-56 shrink-0 text-xs">{slot.label}</span>
                            <select
                              value={mapping[i] ?? ""}
                              onChange={(e) => {
                                setLocalError(null);
                                setMapping((m) => template.slots.map((_, j) => (j === i ? e.target.value : (m[j] ?? ""))));
                              }}
                              disabled={busy}
                              aria-label={slot.label}
                              className={`${inputClass} min-w-48 flex-1 py-1.5`}
                            >
                              <option value="">Elige un dato...</option>
                              {options.map((o) => (
                                <option key={o.token} value={o.token}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {preview && (
                      <div className="rounded-lg bg-muted/50 p-3 text-sm">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Vista previa con datos de ejemplo</p>
                        {preview.header && <p className="font-semibold">{preview.header}</p>}
                        <p className="whitespace-pre-wrap">{preview.body}</p>
                        {preview.footer && <p className="mt-1 text-xs text-muted-foreground">{preview.footer}</p>}
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      Si el contacto no tiene el dato (por ejemplo, la fecha clave), el envío falla y se avisa al responsable.
                    </p>
                  </>
                )}

                {localError && <p className="text-xs text-destructive">{localError}</p>}
                <button type="button" className={primaryButtonClass} disabled={busy || !template || !mappingChanged} onClick={save}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Guardar plantilla
                </button>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
