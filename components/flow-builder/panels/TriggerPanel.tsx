"use client";

import { useCallback, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TriggerType } from "@/lib/types/database";
import { openStages, useCaseCatalog } from "./use-case-catalog";

interface Keyword {
  value: string;
  matchType: "exact" | "contains" | "startsWith";
}

interface TriggerPanelData {
  triggerType?: string;
  keywords?: Keyword[];
  payload?: string;
  alsoMatchInDms?: boolean;
  /** Disparadores de gestión (fase 2). Los nombres son solo para mostrar. */
  caseTypeId?: string;
  caseTypeName?: string;
  stageId?: string;
  stageName?: string;
  outcome?: "won" | "lost" | "resolved";
  minutes?: number;
  /** case_opened: solo gestiones sin tipo, y/o solo ciertos tipos de contacto. */
  onlyUnclassified?: boolean;
  contactTypeIds?: string[];
  contactTypeNames?: string[];
  [key: string]: unknown;
}

interface TriggerPanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

const triggerTypes: Array<{ value: TriggerType; label: string; description: string }> = [
  { value: "keyword", label: "Palabra clave", description: "Se activa cuando el cliente envía una palabra clave que coincide" },
  { value: "postback", label: "Botón (postback)", description: "Se activa cuando el cliente pulsa un botón" },
  { value: "quick_reply", label: "Respuesta rápida", description: "Se activa cuando el cliente elige una respuesta rápida" },
  { value: "welcome", label: "Bienvenida", description: "Se activa cuando el cliente inicia una conversación" },
  { value: "default", label: "Por defecto", description: "Se activa cuando ningún otro disparador coincide" },
  { value: "comment_keyword", label: "Palabra clave en comentario", description: "Se activa con palabras clave en los comentarios de una publicación" },
  { value: "case_opened", label: "Gestión nueva", description: "Se activa cuando se abre una gestión entrante nueva: el primer mensaje de un cliente nuevo o el de un cliente que vuelve sin gestión abierta" },
  { value: "case_stage_changed", label: "Cambio de etapa", description: "Se activa cuando una gestión cambia de etapa" },
  { value: "case_closed", label: "Gestión cerrada", description: "Se activa cuando una gestión se gana, se pierde o se resuelve" },
  { value: "client_no_reply", label: "Cliente sin responder", description: "Se activa cuando el cliente no responde al último mensaje que le enviaste" },
];

const outcomeOptions: Array<{ value: "won" | "lost" | "resolved"; label: string }> = [
  { value: "won", label: "Ganada" },
  { value: "lost", label: "Perdida" },
  { value: "resolved", label: "Resuelta" },
];

const caseSelectClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

/** Opciones de los disparadores de gestión: tipo, etapa, resultado y minutos. */
function CaseTriggerOptions({
  data,
  triggerType,
  onChange,
}: {
  data: TriggerPanelData;
  triggerType: string;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const catalog = useCaseCatalog();
  const caseTypeId = data.caseTypeId || "";
  const type = catalog.caseTypes.find((t) => t.id === caseTypeId);
  const stages = openStages(type);
  const contactTypeIds = data.contactTypeIds ?? [];

  function toggleContactType(id: string, checked: boolean) {
    const next = checked ? [...contactTypeIds, id] : contactTypeIds.filter((v) => v !== id);
    onChange({
      ...data,
      contactTypeIds: next,
      contactTypeNames: catalog.contactTypes.filter((t) => next.includes(t.id)).map((t) => t.name),
    });
  }

  return (
    <div className="space-y-4">
      {triggerType === "case_opened" && (
        <>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={data.onlyUnclassified === true}
              onChange={(e) => onChange({ ...data, onlyUnclassified: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-input text-emerald-500 focus:ring-emerald-500"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">Solo gestiones sin clasificar</span>
              <span className="block text-xs text-muted-foreground">
                Una gestión nueva queda sin clasificar cuando ningún tipo de gestión se sugiere para el tipo de contacto
                del cliente (por ejemplo, un cliente que vuelve). Si lo dejas sin marcar, se activa con cualquier
                gestión nueva.
              </span>
            </span>
          </label>
          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">Tipos de contacto (opcional)</label>
            {catalog.contactTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground">{catalog.loading ? "Cargando..." : "No hay tipos de contacto."}</p>
            ) : (
              <div className="space-y-1.5">
                {catalog.contactTypes.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={contactTypeIds.includes(t.id)}
                      onChange={(e) => toggleContactType(t.id, e.target.checked)}
                      className="h-4 w-4 rounded border-input text-emerald-500 focus:ring-emerald-500"
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              Sin ninguno marcado, se activa para cualquier tipo de contacto. Solo cuenta la gestión que abre un mensaje
              del cliente: reabrir una gestión cerrada hace menos de 24 h no la activa.
            </p>
          </div>
        </>
      )}

      {triggerType !== "case_opened" && (
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">Tipo de gestión (opcional)</label>
        <select
          value={caseTypeId}
          onChange={(e) => {
            const next = catalog.caseTypes.find((t) => t.id === e.target.value);
            onChange({
              ...data,
              caseTypeId: e.target.value,
              caseTypeName: next?.name ?? "",
              stageId: "",
              stageName: "",
            });
          }}
          className={caseSelectClass}
        >
          <option value="">Cualquier tipo</option>
          {catalog.caseTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      )}

      {triggerType === "case_stage_changed" && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">Etapa nueva (opcional)</label>
          <select
            value={data.stageId || ""}
            disabled={!caseTypeId}
            onChange={(e) => {
              const stage = stages.find((s) => s.id === e.target.value);
              onChange({ ...data, stageId: e.target.value, stageName: stage?.name ?? "" });
            }}
            className={caseSelectClass + " disabled:opacity-50"}
          >
            <option value="">Cualquier etapa</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {caseTypeId
              ? "Se activa solo cuando la gestión llega a esta etapa."
              : "Elige primero un tipo de gestión para filtrar por etapa."}
          </p>
        </div>
      )}

      {triggerType === "case_closed" && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">Resultado (opcional)</label>
          <select
            value={data.outcome || ""}
            onChange={(e) => onChange({ ...data, outcome: e.target.value || undefined })}
            className={caseSelectClass}
          >
            <option value="">Cualquier resultado</option>
            {outcomeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {triggerType === "client_no_reply" && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">Minutos sin respuesta</label>
          <input
            type="number"
            min={1}
            step={1}
            value={data.minutes ?? ""}
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value));
              onChange({ ...data, minutes: Number.isFinite(n) && n > 0 ? n : undefined });
            }}
            placeholder="60"
            className={caseSelectClass}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Se activa cuando pasan estos minutos desde el último mensaje que recibió el cliente (del bot o de una
            persona) sin que responda. Si lo dejas vacío, son 60 minutos. Al enviar un mensaje desde este flujo, la
            cuenta no se reinicia.
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Estos flujos corren en la conversación más reciente del contacto, incluso si pausaste el bot en ella (la pausa
        solo evita que el bot responda a los mensajes del cliente). Un flujo no se vuelve a activar a sí mismo por los
        cambios que él mismo hace en la gestión.
      </p>
    </div>
  );
}

const matchTypes: Array<{ value: "exact" | "contains" | "startsWith"; label: string }> = [
  { value: "exact", label: "Coincidencia exacta" },
  { value: "contains", label: "Contiene" },
  { value: "startsWith", label: "Empieza con" },
];

/** ¿Ya existe esa palabra clave (sin importar mayúsculas ni espacios) con el mismo tipo de coincidencia? */
export function hasKeyword(
  keywords: readonly { value: string; matchType: string }[],
  value: string,
  matchType: string,
): boolean {
  const wanted = value.trim().toLowerCase();
  return keywords.some((k) => k.value.trim().toLowerCase() === wanted && k.matchType === matchType);
}

export function TriggerPanel({ data: rawData, onChange }: TriggerPanelProps) {
  const data = rawData as TriggerPanelData;
  const triggerType = data.triggerType || "keyword";
  const keywords = data.keywords || [];
  const [newKeyword, setNewKeyword] = useState("");
  const [newMatchType, setNewMatchType] = useState<"exact" | "contains" | "startsWith">("contains");

  const handleTriggerTypeChange = useCallback(
    (type: string) => {
      onChange({ ...data, triggerType: type });
    },
    [data, onChange]
  );

  const [keywordNotice, setKeywordNotice] = useState<string | null>(null);

  const addKeyword = useCallback(() => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    // La misma palabra con el mismo tipo de coincidencia no se agrega dos veces.
    if (hasKeyword(keywords, trimmed, newMatchType)) {
      setKeywordNotice(`«${trimmed}» ya está en la lista.`);
      return;
    }
    setKeywordNotice(null);
    const updated: Keyword[] = [...keywords, { value: trimmed, matchType: newMatchType }];
    onChange({ ...data, keywords: updated });
    setNewKeyword("");
  }, [data, keywords, newKeyword, newMatchType, onChange]);

  const removeKeyword = useCallback(
    (index: number) => {
      const updated = keywords.filter((_, i) => i !== index);
      onChange({ ...data, keywords: updated });
    },
    [data, keywords, onChange]
  );

  const updateKeywordMatchType = useCallback(
    (index: number, matchType: "exact" | "contains" | "startsWith") => {
      const updated = keywords.map((k, i) => (i === index ? { ...k, matchType } : k));
      onChange({ ...data, keywords: updated });
    },
    [data, keywords, onChange]
  );

  const showKeywords = triggerType === "keyword" || triggerType === "comment_keyword";
  const showPayload = triggerType === "postback" || triggerType === "quick_reply";
  const showCaseOptions =
    triggerType === "case_opened" || triggerType === "case_stage_changed" || triggerType === "case_closed" || triggerType === "client_no_reply";

  return (
    <div className="space-y-5">
      {/* Trigger Type */}
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">
          Tipo de disparador
        </label>
        <div className="space-y-1.5">
          {triggerTypes.map((t) => (
            <label
              key={t.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                triggerType === t.value
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-border bg-card hover:border-input"
              )}
            >
              <input
                type="radio"
                name="triggerType"
                value={t.value}
                checked={triggerType === t.value}
                onChange={() => handleTriggerTypeChange(t.value)}
                className="mt-0.5 h-4 w-4 border-input text-emerald-500 focus:ring-emerald-500"
              />
              <div>
                <p className="text-sm font-medium text-foreground">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Keywords Section */}
      {showKeywords && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Palabras clave
          </label>

          {/* Existing keywords */}
          {keywords.length > 0 && (
            <div className="mb-3 space-y-2">
              {keywords.map((keyword, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card p-2"
                >
                  <span className="flex-1 truncate text-sm text-foreground">
                    {keyword.value}
                  </span>
                  <select
                    value={keyword.matchType}
                    onChange={(e) =>
                      updateKeywordMatchType(index, e.target.value as "exact" | "contains" | "startsWith")
                    }
                    className="rounded border border-border bg-muted px-2 py-1 text-xs text-foreground"
                  >
                    {matchTypes.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeKeyword(index)}
                    aria-label="Quitar palabra clave"
                    title="Quitar palabra clave"
                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new keyword */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => {
                setNewKeyword(e.target.value);
                setKeywordNotice(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              placeholder="Escribe una palabra clave..."
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <select
              value={newMatchType}
              onChange={(e) => setNewMatchType(e.target.value as "exact" | "contains" | "startsWith")}
              className="rounded-lg border border-border bg-card px-2 py-2 text-xs text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {matchTypes.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addKeyword}
              aria-label="Agregar palabra clave"
              title="Agregar palabra clave"
              disabled={!newKeyword.trim()}
              className="rounded-lg bg-emerald-500 p-2 text-white transition-colors hover:bg-emerald-600 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {keywordNotice && <p className="mt-1.5 text-xs text-amber-700">{keywordNotice}</p>}

          {keywords.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Agrega las palabras clave que activarán este flujo. Pulsa Enter o haz clic en + para agregar.
            </p>
          )}

          {/* Comment keywords only: publish also writes a `keyword` trigger row so
              the same flow answers people who DM the keyword instead of commenting. */}
          {triggerType === "comment_keyword" && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card p-3">
              <input
                type="checkbox"
                checked={data.alsoMatchInDms === true}
                onChange={(e) => onChange({ ...data, alsoMatchInDms: e.target.checked })}
                disabled={keywords.length === 0}
                className="mt-0.5 h-4 w-4 rounded border-input text-emerald-500 focus:ring-emerald-500 disabled:opacity-40"
              />
              <div>
                <p className="text-sm font-medium text-foreground">También coincidir en DM</p>
                <p className="text-xs text-muted-foreground">
                  {keywords.length === 0
                    ? "Agrega al menos una palabra clave para usar esta opción."
                    : "Ejecuta este flujo cuando alguien envíe la palabra clave por mensaje directo, no solo como comentario."}
                </p>
                {data.alsoMatchInDms === true && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Un DM no tiene un comentario detrás, así que las respuestas públicas y las
                    variables de comentario ({"{{comment_text}}"}, {"{{post_id}}"}) quedan vacías en esa ejecución.
                  </p>
                )}
              </div>
            </label>
          )}
        </div>
      )}

      {showCaseOptions && <CaseTriggerOptions data={data} triggerType={triggerType} onChange={onChange} />}

      {/* Payload Section */}
      {showPayload && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Valor (payload)
          </label>
          <input
            type="text"
            value={data.payload || ""}
            onChange={(e) => onChange({ ...data, payload: e.target.value })}
            placeholder="Escribe el valor del payload..."
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            El valor del payload que debe coincidir cuando {triggerType === "postback" ? "se pulsa un botón" : "se elige una respuesta rápida"}.
          </p>
        </div>
      )}
    </div>
  );
}
