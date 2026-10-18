"use client";

import { useEffect, useState } from "react";
import {
  Radio,
  Plus,
  Clock,
  CheckCircle2,
  Send,
  Loader2,
  XCircle,
  FileEdit,
  Calendar,
  Filter,
  ChevronDown,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  SegmentBuilder,
  createEmptyFilter,
  type SegmentFilter,
} from "@/components/segment-builder";
import { TemplateContentEditor } from "@/components/sequences/template-content-editor";
import type {
  Database,
  BroadcastStatus,
  Json,
  TemplateMessageContent,
} from "@/lib/types/database";

type Broadcast = Database["public"]["Tables"]["broadcasts"]["Row"];

const statusConfig: Record<
  BroadcastStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  draft: {
    label: "Borrador",
    icon: FileEdit,
    className: "bg-muted text-muted-foreground",
  },
  scheduled: {
    label: "Programada",
    icon: Clock,
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  sending: {
    label: "Enviando",
    icon: Loader2,
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  completed: {
    label: "Completada",
    icon: CheckCircle2,
    className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  cancelled: {
    label: "Cancelada",
    icon: XCircle,
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
};

export function BroadcastsView({
  broadcasts,
  workspaceId,
}: {
  broadcasts: Broadcast[];
  workspaceId: string;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [items, setItems] = useState(broadcasts);
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>(
    createEmptyFilter()
  );
  const [showSegmentFilter, setShowSegmentFilter] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<ContentKind>("text");

  async function handleCreate() {
    if (!newName.trim() || creating) return;
    setCreating(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("broadcasts")
        .insert({
          workspace_id: workspaceId,
          name: newName.trim(),
          status: "draft",
          // El tipo se elige al crear; el texto o la plantilla se completan al abrirla.
          message_content:
            newKind === "template"
              ? ({ kind: "template", template_name: "", language: "", params: [] } as unknown as Json)
              : ({ kind: "text", text: "" } as unknown as Json),
          segment_filter: showSegmentFilter
            ? (segmentFilter as unknown as Json)
            : null,
        })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setItems((prev) => [data, ...prev]);
        setNewName("");
        setNewKind("text");
        setShowCreate(false);
        setSelectedId(data.id);
      }
    } catch (err) {
      console.error("Failed to create broadcast:", err);
    } finally {
      setCreating(false);
    }
  }

  const selectedBroadcast = selectedId
    ? items.find((b) => b.id === selectedId) ?? null
    : null;

  if (selectedBroadcast) {
    return (
      <BroadcastDetail
        broadcast={selectedBroadcast}
        workspaceId={workspaceId}
        onBack={() => setSelectedId(null)}
        onUpdate={(updated) => {
          setItems((prev) =>
            prev.map((b) => (b.id === updated.id ? updated : b))
          );
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Difusiones</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Envía mensajes a varios contactos a la vez
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Crear difusión
          </button>
        </div>

        {/* Formulario de creación */}
        {showCreate && (
          <div className="mt-4 rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Nombre de la difusión..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !showSegmentFilter) handleCreate();
                  if (e.key === "Escape") setShowCreate(false);
                }}
                autoFocus
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {creating ? "Creando..." : "Crear"}
              </button>
              <button
                onClick={() => {
                  setShowCreate(false);
                  setNewName("");
                  setShowSegmentFilter(false);
                  setSegmentFilter(createEmptyFilter());
                }}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                Cancelar
              </button>
            </div>

            {/* Tipo de difusión */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground uppercase">Tipo</span>
              <KindToggle value={newKind} onChange={setNewKind} />
              <span className="text-xs text-muted-foreground">
                {newKind === "text"
                  ? "Solo a contactos que escribieron en las últimas 24 horas"
                  : "A cualquier contacto con teléfono de WhatsApp"}
              </span>
            </div>

            {/* Sección de segmentación */}
            <div>
              <button
                type="button"
                onClick={() => setShowSegmentFilter(!showSegmentFilter)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  showSegmentFilter
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                Dirigir a contactos específicos
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    showSegmentFilter && "rotate-180"
                  )}
                />
              </button>

              {showSegmentFilter && (
                <div className="mt-3">
                  <SegmentBuilder
                    value={segmentFilter}
                    onChange={setSegmentFilter}
                    workspaceId={workspaceId}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lista de difusiones */}
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Radio className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              Aún no hay difusiones
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Crea tu primera difusión para enviar mensajes a tus contactos
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((broadcast) => {
              const status = statusConfig[broadcast.status];
              const StatusIcon = status.icon;
              const total = broadcast.total_recipients;

              return (
                <button
                  key={broadcast.id}
                  onClick={() => setSelectedId(broadcast.id)}
                  className="flex w-full items-center gap-6 px-8 py-4 text-left transition-colors hover:bg-accent/50"
                >
                  {/* Estado y nombre */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="truncate text-sm font-medium">
                        {broadcast.name}
                      </h3>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          status.className
                        )}
                      >
                        <StatusIcon
                          className={cn(
                            "h-3 w-3",
                            broadcast.status === "sending" && "animate-spin"
                          )}
                        />
                        {status.label}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {broadcast.scheduled_for
                          ? formatDateTime(broadcast.scheduled_for)
                          : "Sin programar"}
                      </span>
                      <span>
                        Creada el {formatDateTime(broadcast.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Estadísticas */}
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <p className="text-lg font-semibold">{formatNumber(total)}</p>
                      <p className="text-[10px] uppercase text-muted-foreground">
                        Destinatarios
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-semibold text-green-600">
                        {formatNumber(broadcast.sent)}
                      </p>
                      <p className="text-[10px] uppercase text-muted-foreground">
                        Enviados
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-semibold text-blue-600">
                        {formatNumber(broadcast.delivered)}
                      </p>
                      <p className="text-[10px] uppercase text-muted-foreground">
                        Entregados
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-semibold text-red-600">
                        {formatNumber(broadcast.failed)}
                      </p>
                      <p className="text-[10px] uppercase text-muted-foreground">
                        Fallidos
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type ContentKind = "text" | "template";

interface PreviewResult {
  kind: ContentKind;
  segmentTotal: number;
  willReceive: number;
  excludedTotal: number;
  excludedReasons: string[];
}

interface FailedRecipient {
  id: string;
  error_message: string | null;
  contacts: { display_name: string | null } | null;
}

function KindToggle({
  value,
  onChange,
  disabled,
}: {
  value: ContentKind;
  onChange: (kind: ContentKind) => void;
  disabled?: boolean;
}) {
  const options: { kind: ContentKind; label: string }[] = [
    { kind: "text", label: "Texto" },
    { kind: "template", label: "Plantilla de WhatsApp" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted p-0.5" role="group" aria-label="Tipo de difusión">
      {options.map((o) => (
        <button
          key={o.kind}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.kind)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
            value === o.kind
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BroadcastDetail({
  broadcast,
  workspaceId,
  onBack,
  onUpdate,
}: {
  broadcast: Broadcast;
  workspaceId: string;
  onBack: () => void;
  onUpdate: (updated: Broadcast) => void;
}) {
  const stored = broadcast.message_content as
    | { kind?: string; text?: string; template_name?: string; language?: string; params?: string[] }
    | null;
  const [kind, setKind] = useState<ContentKind>(stored?.kind === "template" ? "template" : "text");
  const [messageText, setMessageText] = useState(stored?.text || "");
  const [template, setTemplate] = useState<TemplateMessageContent | null>(
    stored?.kind === "template" && stored.template_name && stored.language
      ? {
          kind: "template",
          template_name: stored.template_name,
          language: stored.language,
          params: Array.isArray(stored.params) ? stored.params : [],
        }
      : null
  );
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [failedRecipients, setFailedRecipients] = useState<FailedRecipient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isDraft = broadcast.status === "draft" || broadcast.status === "scheduled";
  const status = statusConfig[broadcast.status];
  const StatusIcon = status.icon;

  // Contenido que se envía según el tipo elegido.
  const content: object =
    kind === "text"
      ? { kind: "text", text: messageText.trim() }
      : template ?? { kind: "template", template_name: "", language: "", params: [] };
  const contentReady =
    kind === "text"
      ? messageText.trim().length > 0
      : !!template && template.params.every((p) => p.trim().length > 0);

  // Motivo de cada envío fallido (p. ej. "Pasaron más de 24 horas...").
  useEffect(() => {
    if (broadcast.failed <= 0) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("broadcast_recipients")
      .select("id, error_message, contacts(display_name)")
      .eq("broadcast_id", broadcast.id)
      .eq("status", "failed")
      .limit(50)
      .then(({ data }) => {
        if (!cancelled) setFailedRecipients((data ?? []) as unknown as FailedRecipient[]);
      });
    return () => {
      cancelled = true;
    };
  }, [broadcast.id, broadcast.failed]);

  function changeKind(next: ContentKind) {
    setKind(next);
    setPreview(null);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("broadcasts")
        .update({ message_content: content as unknown as Json })
        .eq("id", broadcast.id)
        .select()
        .single();

      if (err) throw err;
      if (data) onUpdate(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  // Antes de enviar: cuántos recibirán y cuántos quedan fuera.
  async function handlePreview() {
    if (!contentReady) {
      setError(
        kind === "text"
          ? "El mensaje no puede estar vacío"
          : "Elige una plantilla y completa todas sus variables"
      );
      return;
    }
    setPreviewing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/v1/broadcasts/${broadcast.id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageContent: content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo calcular quién recibirá la difusión");
      setPreview(data as PreviewResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo calcular quién recibirá la difusión");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/v1/broadcasts/${broadcast.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageContent: content }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "No se pudo enviar la difusión");
      }

      setSuccess(`Enviando a ${formatNumber(data.totalRecipients)} destinatarios`);
      setPreview(null);

      // Actualizar la difusión localmente
      onUpdate({
        ...broadcast,
        status: "sending",
        total_recipients: data.totalRecipients,
        message_content: content as unknown as Json,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{broadcast.name}</h1>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                  status.className
                )}
              >
                <StatusIcon
                  className={cn(
                    "h-3.5 w-3.5",
                    broadcast.status === "sending" && "animate-spin"
                  )}
                />
                {status.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Creada el {formatDateTime(broadcast.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Estadísticas de difusiones que no son borrador */}
          {broadcast.total_recipients > 0 && (
            <div className="grid grid-cols-4 gap-4">
              <div className="rounded-lg border border-border bg-card p-4 text-center">
                <p className="text-2xl font-bold">{formatNumber(broadcast.total_recipients)}</p>
                <p className="text-xs text-muted-foreground">Destinatarios</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{formatNumber(broadcast.sent)}</p>
                <p className="text-xs text-muted-foreground">Enviados</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4 text-center">
                <p className="text-2xl font-bold text-blue-600">{formatNumber(broadcast.delivered)}</p>
                <p className="text-xs text-muted-foreground">Entregados</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4 text-center">
                <p className="text-2xl font-bold text-red-600">{formatNumber(broadcast.failed)}</p>
                <p className="text-xs text-muted-foreground">Fallidos</p>
              </div>
            </div>
          )}

          {/* Envíos fallidos con su motivo */}
          {failedRecipients.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-900/50 dark:bg-red-900/10">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Envíos fallidos{broadcast.failed > failedRecipients.length ? ` (primeros ${failedRecipients.length})` : ""}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {failedRecipients.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium text-foreground">
                      {r.contacts?.display_name || "Contacto sin nombre"}
                    </span>
                    : {r.error_message || "Sin detalle"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tipo y redacción del mensaje */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium">Mensaje</label>
              <KindToggle value={kind} onChange={changeKind} disabled={!isDraft} />
            </div>

            {kind === "text" ? (
              <>
                <textarea
                  value={messageText}
                  onChange={(e) => {
                    setMessageText(e.target.value);
                    setPreview(null);
                  }}
                  disabled={!isDraft}
                  placeholder="Escribe aquí el mensaje de tu difusión..."
                  rows={6}
                  className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
                {isDraft && (
                  <p className="text-xs text-muted-foreground">
                    El texto solo le llega a los contactos que te escribieron en las últimas 24 horas. Para
                    escribirle a los demás, usa una plantilla de WhatsApp.
                  </p>
                )}
              </>
            ) : (
              <>
                <TemplateContentEditor
                  workspaceId={workspaceId}
                  value={template}
                  onChange={(t) => {
                    setTemplate(t);
                    setPreview(null);
                  }}
                  disabled={!isDraft}
                />
                {isDraft && (
                  <p className="text-xs text-muted-foreground">
                    La plantilla le llega a cualquier contacto con teléfono de WhatsApp, aunque nunca haya
                    escrito.
                  </p>
                )}
              </>
            )}
            {isDraft && (
              <p className="text-xs text-muted-foreground">
                Se enviará a los contactos que cumplan tu filtro de segmento
                {broadcast.segment_filter ? "" : " (todos los contactos suscritos)"}.
              </p>
            )}
          </div>

          {/* Información del segmento */}
          {broadcast.segment_filter && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Filter className="h-4 w-4 text-muted-foreground" />
                Filtro de segmento aplicado
              </div>
              <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">
                {JSON.stringify(broadcast.segment_filter, null, 2)}
              </pre>
            </div>
          )}

          {/* Resultado de la selección antes de enviar */}
          {preview && isDraft && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <p className="text-sm font-medium">
                Recibirán la difusión {formatNumber(preview.willReceive)}{" "}
                {preview.willReceive === 1 ? "contacto" : "contactos"}
              </p>
              {preview.excludedTotal > 0 && (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Quedan fuera {formatNumber(preview.excludedTotal)}: {preview.excludedReasons.join("; ")}.
                </p>
              )}
              {preview.kind === "text" && preview.excludedTotal > 0 && (
                <p className="text-xs text-muted-foreground">
                  Fuera de las 24 horas WhatsApp solo acepta plantillas: cambia a “Plantilla de WhatsApp” para
                  llegar a esos contactos.
                </p>
              )}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSend}
                  disabled={sending || preview.willReceive === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? "Enviando..." : `Confirmar y enviar a ${formatNumber(preview.willReceive)}`}
                </button>
                <button
                  onClick={() => setPreview(null)}
                  disabled={sending}
                  className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
                >
                  Volver
                </button>
              </div>
            </div>
          )}

          {/* Mensajes de error y éxito */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {success}
            </div>
          )}

          {/* Acciones */}
          {isDraft && !preview && (
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handlePreview}
                disabled={previewing || !contentReady}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {previewing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {previewing ? "Calculando..." : "Revisar y enviar"}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !contentReady}
                className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar borrador"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
