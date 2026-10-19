"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import {
  MessageCircle,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
  X,
  TrendingUp,
  Send,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Database, Json } from "@/lib/types/database";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { formatNumber, formatRelative } from "@/lib/format";

type Channel = Database["public"]["Tables"]["channels"]["Row"];
type CommentLog = Database["public"]["Tables"]["comment_logs"]["Row"];

interface TriggerWithFlow {
  id: string;
  flow_id: string;
  channel_id: string | null;
  type: string;
  config: Json;
  priority: number;
  is_active: boolean;
  created_at: string;
  flows: { id: string; name: string; status: string } | null;
}

interface TriggerConfig {
  keywords: Array<{
    value: string;
    matchType?: "exact" | "contains" | "startsWith";
  }>;
  postIds?: string[];
  replyText?: string;
}

export function GrowthView({
  workspaceId,
  channels,
  triggers: initialTriggers,
  flows,
  stats,
  recentLogs,
}: {
  workspaceId: string;
  channels: Channel[];
  triggers: TriggerWithFlow[];
  flows: Array<{ id: string; name: string }>;
  stats: {
    totalComments: number;
    matchedComments: number;
    dmsSent: number;
  };
  recentLogs: CommentLog[];
}) {
  const [triggers, setTriggers] = useState(initialTriggers);
  const [showCreate, setShowCreate] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const createFormRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if ((showCreate || editingId) && createFormRef.current) {
      createFormRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showCreate, editingId]);

  // New rule form state
  const [form, setForm] = useState({
    channelId: channels[0]?.id || "",
    flowId: flows[0]?.id || "",
    keywords: "",
    matchType: "contains" as "exact" | "contains" | "startsWith",
    replyText: "",
    postIds: "",
  });
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const toast = useToast();

  const conversionRate = formatNumber(
    stats.totalComments > 0
      ? Math.round((stats.dmsSent / stats.totalComments) * 1000) / 10
      : 0
  );

  async function handleToggle(trigger: TriggerWithFlow) {
    setTogglingId(trigger.id);
    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("triggers")
        .update({ is_active: !trigger.is_active })
        .eq("id", trigger.id);

      if (error) {
        toast.error("No se pudo cambiar el estado de la regla.");
      } else {
        setTriggers((prev) =>
          prev.map((t) =>
            t.id === trigger.id ? { ...t, is_active: !t.is_active } : t
          )
        );
        toast.success(trigger.is_active ? "Regla pausada" : "Regla activada");
      }
    } catch {
      toast.error("No se pudo cambiar el estado de la regla.");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(triggerId: string) {
    setDeletingId(triggerId);
    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("triggers")
        .delete()
        .eq("id", triggerId);

      if (error) {
        toast.error("No se pudo eliminar la regla.");
      } else {
        setTriggers((prev) => prev.filter((t) => t.id !== triggerId));
        toast.success("Regla eliminada");
      }
    } catch {
      toast.error("No se pudo eliminar la regla.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCreate() {
    if (!form.channelId || !form.flowId || !form.keywords.trim() || creating) {
      return;
    }

    setCreating(true);
    const supabase = createClient();

    const keywords = form.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((value) => ({ value, matchType: form.matchType }));

    const config: TriggerConfig = {
      keywords,
      ...(form.replyText.trim() ? { replyText: form.replyText.trim() } : {}),
      ...(form.postIds.trim()
        ? {
            postIds: form.postIds
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean),
          }
        : {}),
    };

    try {
      const { data, error } = await supabase
        .from("triggers")
        .insert({
          flow_id: form.flowId,
          channel_id: form.channelId,
          type: "comment_keyword" as const,
          config: config as unknown as Json,
          is_active: true,
          priority: 10,
        })
        .select("*, flows(id, name, status)")
        .single();

      if (error) throw error;

      if (data) {
        setTriggers((prev) => [
          data as unknown as TriggerWithFlow,
          ...prev,
        ]);
        setShowCreate(false);
        setForm({
          channelId: channels[0]?.id || "",
          flowId: flows[0]?.id || "",
          keywords: "",
          matchType: "contains",
          replyText: "",
          postIds: "",
        });
        toast.success("Regla creada");
      }
    } catch (err) {
      console.error("Failed to create comment rule:", err);
      toast.error("No se pudo crear la regla.");
    } finally {
      setCreating(false);
    }
  }

  function handleStartEdit(trigger: TriggerWithFlow) {
    const config = trigger.config as unknown as TriggerConfig;
    setEditingId(trigger.id);
    setShowCreate(false);
    setForm({
      channelId: trigger.channel_id || channels[0]?.id || "",
      flowId: trigger.flow_id,
      keywords: (config.keywords || []).map((k) => k.value).join(", "),
      matchType: config.keywords?.[0]?.matchType || "contains",
      replyText: config.replyText || "",
      postIds: (config.postIds || []).join(", "),
    });
  }

  async function handleSaveEdit() {
    if (!editingId || !form.channelId || !form.flowId || !form.keywords.trim() || saving) {
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const keywords = form.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((value) => ({ value, matchType: form.matchType }));

    const config: TriggerConfig = {
      keywords,
      ...(form.replyText.trim() ? { replyText: form.replyText.trim() } : {}),
      ...(form.postIds.trim()
        ? {
            postIds: form.postIds
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean),
          }
        : {}),
    };

    try {
      const { data, error } = await supabase
        .from("triggers")
        .update({
          flow_id: form.flowId,
          channel_id: form.channelId,
          config: config as unknown as Json,
        })
        .eq("id", editingId)
        .select("*, flows(id, name, status)")
        .single();

      if (error) throw error;

      if (data) {
        setTriggers((prev) =>
          prev.map((t) =>
            t.id === editingId ? (data as unknown as TriggerWithFlow) : t
          )
        );
        setEditingId(null);
        setForm({
          channelId: channels[0]?.id || "",
          flowId: flows[0]?.id || "",
          keywords: "",
          matchType: "contains",
          replyText: "",
          postIds: "",
        });
        toast.success("Cambios guardados");
      }
    } catch (err) {
      console.error("Failed to update comment rule:", err);
      toast.error("No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelForm() {
    setShowCreate(false);
    setEditingId(null);
    setForm({
      channelId: channels[0]?.id || "",
      flowId: flows[0]?.id || "",
      keywords: "",
      matchType: "contains",
      replyText: "",
      postIds: "",
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Herramientas de crecimiento
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Automatización de comentario a mensaje directo para captar clientes e interactuar
            </p>
          </div>
          <button
            onClick={() => { setEditingId(null); setShowCreate(true); }}
            disabled={channels.length === 0 || flows.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Nueva regla de comentarios
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {/* Stats cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Comentarios procesados"
            value={formatNumber(stats.totalComments)}
            icon={<Eye className="h-4 w-4" />}
            sublabel="Últimos 30 días"
          />
          <StatCard
            label="Palabras clave detectadas"
            value={formatNumber(stats.matchedComments)}
            icon={<MessageCircle className="h-4 w-4" />}
            sublabel="Últimos 30 días"
          />
          <StatCard
            label="Mensajes directos enviados"
            value={formatNumber(stats.dmsSent)}
            icon={<Send className="h-4 w-4" />}
            sublabel="Últimos 30 días"
          />
          <StatCard
            label="Tasa de conversión"
            value={`${conversionRate}%`}
            icon={<TrendingUp className="h-4 w-4" />}
            sublabel="De comentarios a mensajes directos"
          />
        </div>

        {/* Create / Edit form */}
        {(showCreate || editingId) && (
          <div ref={createFormRef} className="mt-6 rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                {editingId ? "Editar regla de comentario a mensaje directo" : "Crear regla de comentario a mensaje directo"}
              </h2>
              <button
                onClick={handleCancelForm}
                className="rounded-md p-1 text-muted-foreground/60 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {/* Channel */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Canal
                </label>
                <select
                  value={form.channelId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, channelId: e.target.value }))
                  }
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.display_name || ch.username || ch.late_account_id} (
                      {PLATFORM_LABELS[ch.platform]})
                    </option>
                  ))}
                </select>
              </div>

              {/* Flow */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Flujo de respuesta
                </label>
                <select
                  value={form.flowId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, flowId: e.target.value }))
                  }
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {flows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Keywords */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Palabras clave (separadas por comas)
                </label>
                <input
                  type="text"
                  value={form.keywords}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, keywords: e.target.value }))
                  }
                  placeholder="info, precio, detalles"
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Match Type */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Tipo de coincidencia
                </label>
                <select
                  value={form.matchType}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      matchType: e.target.value as
                        | "exact"
                        | "contains"
                        | "startsWith",
                    }))
                  }
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="contains">Contiene</option>
                  <option value="exact">Coincidencia exacta</option>
                  <option value="startsWith">Empieza con</option>
                </select>
              </div>

              {/* Public reply text (optional) */}
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Respuesta pública (opcional)
                </label>
                <input
                  type="text"
                  value={form.replyText}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, replyText: e.target.value }))
                  }
                  placeholder="¡Revisa tus mensajes directos! Te acabamos de enviar más información."
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/60">
                  Si la completas, se publicará como respuesta pública al
                  comentario que coincida, antes de enviar el mensaje directo.
                </p>
              </div>

              {/* Post IDs (optional) */}
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">
                  IDs de publicaciones específicas (opcional, separados por comas)
                </label>
                <input
                  type="text"
                  value={form.postIds}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, postIds: e.target.value }))
                  }
                  placeholder="Déjalo vacío para detectar comentarios en todas las publicaciones"
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-[11px] text-muted-foreground/60">
                  Limita esta regla a IDs de publicaciones de Zernio específicas. Si lo
                  dejas vacío, se monitorean todas las publicaciones de este canal.
                </p>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={handleCancelForm}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Cancelar
              </button>
              {editingId ? (
                <button
                  onClick={handleSaveEdit}
                  disabled={
                    !form.keywords.trim() || !form.channelId || !form.flowId || saving
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {saving && <Spinner className="h-3.5 w-3.5" />}
                  {saving ? "Guardando…" : "Guardar cambios"}
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={
                    !form.keywords.trim() || !form.channelId || !form.flowId || creating
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {creating && <Spinner className="h-3.5 w-3.5" />}
                  {creating ? "Creando…" : "Crear regla"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {channels.length === 0 && (
          <div className="mt-8 rounded-xl border border-dashed border-input p-8 text-center">
            <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <h2 className="mt-3 text-lg font-semibold text-foreground">
              Conecta un canal primero
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Necesitas al menos un canal activo para configurar la automatización de comentarios.
            </p>
            <a
              href="/dashboard/channels"
              className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Ir a Canales
            </a>
          </div>
        )}

        {flows.length === 0 && channels.length > 0 && (
          <div className="mt-8 rounded-xl border border-dashed border-input p-8 text-center">
            <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <h2 className="mt-3 text-lg font-semibold text-foreground">
              Crea un flujo primero
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Publica al menos un flujo para usarlo como respuesta por mensaje
              directo cuando los comentarios coincidan con tus palabras clave.
            </p>
            <Link
              href="/dashboard/flows"
              className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Ir a Flujos
            </Link>
          </div>
        )}

        {/* Active rules */}
        {triggers.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-foreground">
              Reglas de comentarios activas
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cuando un comentario coincide con una palabra clave, el flujo
              vinculado envía un mensaje directo a quien comentó.
            </p>

            <div className="mt-4 space-y-3">
              {triggers.map((trigger) => {
                const config = trigger.config as unknown as TriggerConfig;
                const channel = channels.find(
                  (c) => c.id === trigger.channel_id
                );
                return (
                  <div
                    key={trigger.id}
                    className={cn(
                      "rounded-xl border bg-card p-5 transition-shadow hover:shadow-sm",
                      trigger.is_active
                        ? "border-border"
                        : "border-border/60 opacity-60"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                              trigger.is_active
                                ? "bg-green-100 text-green-700"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                trigger.is_active
                                  ? "bg-green-500"
                                  : "bg-muted-foreground"
                              )}
                            />
                            {trigger.is_active ? "Activa" : "En pausa"}
                          </span>

                          {channel && (
                            <span className="text-xs text-muted-foreground">
                              {channel.display_name ||
                                channel.username ||
                                PLATFORM_LABELS[channel.platform]}
                            </span>
                          )}

                          {!trigger.channel_id && (
                            <span className="text-xs text-muted-foreground">
                              Todos los canales
                            </span>
                          )}
                        </div>

                        {/* Keywords */}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {config.keywords?.map((kw, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                            >
                              {kw.matchType === "exact" && "= "}
                              {kw.matchType === "startsWith" && "^ "}
                              {kw.value}
                            </span>
                          ))}
                        </div>

                        {/* Flow name */}
                        <p className="mt-2 text-xs text-muted-foreground">
                          Flujo:{" "}
                          <span className="font-medium text-foreground">
                            {trigger.flows?.name || "Desconocido"}
                          </span>
                        </p>

                        {/* Reply text preview */}
                        {config.replyText && (
                          <p className="mt-1 text-xs text-muted-foreground/60">
                            Respuesta pública: &ldquo;{config.replyText}&rdquo;
                          </p>
                        )}

                        {/* Post IDs */}
                        {config.postIds?.length ? (
                          <p className="mt-1 text-xs text-muted-foreground/60">
                            Limitada a {config.postIds.length}{" "}
                            {config.postIds.length === 1 ? "publicación" : "publicaciones"}
                          </p>
                        ) : null}
                      </div>

                      {/* Actions */}
                      <div className="ml-4 flex items-center gap-1">
                        <button
                          onClick={() => handleStartEdit(trigger)}
                          className="rounded-lg p-2 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                          title="Editar regla"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleToggle(trigger)}
                          disabled={togglingId === trigger.id}
                          className={cn(
                            "rounded-lg p-2 transition-colors",
                            trigger.is_active
                              ? "text-green-600 hover:bg-green-50"
                              : "text-muted-foreground/60 hover:bg-muted"
                          )}
                          title={
                            trigger.is_active ? "Pausar regla" : "Activar regla"
                          }
                        >
                          {trigger.is_active ? (
                            <Power className="h-4 w-4" />
                          ) : (
                            <PowerOff className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(trigger.id)}
                          disabled={deletingId === trigger.id}
                          className="rounded-lg p-2 text-muted-foreground/60 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          title="Eliminar regla"
                        >
                          {deletingId === trigger.id ? <Spinner /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent activity log */}
        {recentLogs.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-foreground">
              Actividad reciente
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Últimos comentarios procesados y sus resultados.
            </p>

            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">
                      Autor
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">
                      Comentario
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">
                      Coincide
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">
                      Mensaje directo
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">
                      Hora
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">
                          {log.author_name || log.author_username || "Desconocido"}
                        </p>
                        {log.author_username && (
                          <p className="text-xs text-muted-foreground/60">
                            @{log.author_username}
                          </p>
                        )}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-sm text-foreground">
                        {log.comment_text}
                      </td>
                      <td className="px-4 py-3">
                        {log.matched_trigger_id ? (
                          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                            Sí
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            No
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {log.dm_sent ? (
                          <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                            Enviado
                          </span>
                        ) : log.error ? (
                          <span
                            className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700"
                            title={log.error}
                          >
                            Error
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">
                            --
                          </span>
                        )}
                      </td>
                      <td
                        suppressHydrationWarning
                        className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground/60"
                      >
                        {formatRelative(log.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar regla"
        message="¿Eliminar esta regla de comentarios? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        destructive
        onConfirm={() => {
          const id = confirmDeleteId;
          setConfirmDeleteId(null);
          if (id) void handleDelete(id);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  sublabel,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  sublabel: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="text-muted-foreground/60">{icon}</div>
      </div>
      <p className="mt-2 text-3xl font-bold text-foreground">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground/60">
        {sublabel}
      </p>
    </div>
  );
}
