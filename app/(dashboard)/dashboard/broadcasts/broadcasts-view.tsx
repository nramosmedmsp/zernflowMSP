"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  Trash2,
  Pause,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  SegmentBuilder,
  createEmptyFilter,
  type SegmentFilter,
} from "@/components/segment-builder";
import { TemplateContentEditor } from "@/components/sequences/template-content-editor";
import { SegmentSummary } from "@/components/broadcasts/segment-summary";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteBroadcast, updateBroadcastFilter } from "@/lib/actions/broadcasts";
import { incompleteFilterProblem } from "@/lib/broadcasts/segment";
import { useViewAs } from "@/components/view-as/view-as-context";
import { BROADCAST_SENDS_PER_PASS, describeBroadcastEta } from "@/lib/broadcasts/pacing";
import {
  BROADCAST_STATUS_TEXT,
  cancelConfirmMessage,
  cancelledSummary,
  isBroadcastLive,
  pauseExplanation,
  progressFromCounts,
  progressPercent,
  waitingCount,
  type BroadcastProgress,
} from "@/lib/broadcasts/status";
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
    label: BROADCAST_STATUS_TEXT.draft,
    icon: FileEdit,
    className: "bg-muted text-muted-foreground",
  },
  scheduled: {
    label: BROADCAST_STATUS_TEXT.scheduled,
    icon: Clock,
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  sending: {
    label: BROADCAST_STATUS_TEXT.sending,
    icon: Loader2,
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  paused: {
    label: BROADCAST_STATUS_TEXT.paused,
    icon: Pause,
    className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  },
  completed: {
    label: BROADCAST_STATUS_TEXT.completed,
    icon: CheckCircle2,
    className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  cancelled: {
    label: BROADCAST_STATUS_TEXT.cancelled,
    icon: XCircle,
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
};

export function BroadcastsView({
  broadcasts,
  workspaceId,
  initialSelectedId = null,
}: {
  broadcasts: Broadcast[];
  workspaceId: string;
  /** Difusión que se abre al entrar (por ejemplo, desde un aviso). */
  initialSelectedId?: string | null;
}) {
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [items, setItems] = useState(broadcasts);
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>(
    createEmptyFilter()
  );
  const [showSegmentFilter, setShowSegmentFilter] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [newKind, setNewKind] = useState<ContentKind>("text");

  async function handleCreate() {
    if (!newName.trim() || creating) return;
    // Un filtro con reglas sin completar no coincide con nadie: se corrige antes de guardar.
    const filterProblem = showSegmentFilter ? incompleteFilterProblem(segmentFilter) : null;
    if (filterProblem) {
      toast.error(filterProblem);
      return;
    }
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
        toast.success("Difusión creada");
      }
    } catch (err) {
      console.error("Failed to create broadcast:", err);
      toast.error("No se pudo crear la difusión. Inténtalo de nuevo.");
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
        onDeleted={(id) => {
          setItems((prev) => prev.filter((b) => b.id !== id));
          setSelectedId(null);
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
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {creating && <Spinner />}
                {creating ? "Creando…" : "Crear"}
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
          <div className="stagger-list divide-y divide-border">
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
  excluded?: {
    closedWindow?: number;
    noConversation?: number;
    optedOut?: number;
    noConsent?: number;
  };
}

interface SkippedRecipient {
  id: string;
  error_message: string | null;
  contacts: { display_name: string | null } | null;
}

interface FailedRecipient {
  id: string;
  error_message: string | null;
  contacts: { display_name: string | null } | null;
}

/** Filtro guardado -> filtro del editor (con los ids que usa para las listas). */
function filterWithIds(raw: Json | null): SegmentFilter {
  const stored = raw as { combinator?: "and" | "or"; groups?: { combinator?: "and" | "or"; rules?: { field: string; operator: string; value: string }[] }[] } | null;
  if (!stored || !Array.isArray(stored.groups) || stored.groups.length === 0) return createEmptyFilter();
  const id = () => Math.random().toString(36).slice(2, 10);
  return {
    combinator: stored.combinator === "or" ? "or" : "and",
    groups: stored.groups.map((g) => ({
      id: id(),
      combinator: g.combinator === "or" ? "or" : "and",
      rules: (g.rules ?? []).map((r) => ({ id: id(), field: r.field, operator: r.operator, value: r.value ?? "" })),
    })),
  } as SegmentFilter;
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

/** Estado en palabras claras, barra de avance y conteos por resultado. */
function BroadcastProgressPanel({ broadcast, progress }: { broadcast: Broadcast; progress: BroadcastProgress | null }) {
  // Mientras llega la primera consulta se usan los contadores de la propia difusión.
  const p =
    progress ??
    progressFromCounts({
      sent: broadcast.sent,
      failed: broadcast.failed,
      pending: Math.max(0, broadcast.total_recipients - broadcast.sent - broadcast.failed),
    });
  const waiting = waitingCount(p);
  const percent = progressPercent(p);

  let banner: { text: string; className: string } | null = null;
  if (broadcast.status === "sending") {
    banner = {
      text: `Enviando a unos ${BROADCAST_SENDS_PER_PASS} contactos por minuto, para cuidar tu número de WhatsApp. ${
        waiting > 0 ? `Faltan ${formatNumber(waiting)}: terminará en ${describeBroadcastEta(waiting)}. ` : ""
      }Esta pantalla se actualiza sola.`,
      className: "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-900/10 dark:text-yellow-200",
    };
  } else if (broadcast.status === "paused") {
    banner = {
      text: `${pauseExplanation(broadcast.paused_reason, broadcast.pause_note)} ${
        waiting > 0 ? `Faltan ${formatNumber(waiting)} por enviar.` : ""
      }`.trim(),
      className:
        broadcast.paused_reason === "auto_failures"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-300"
          : "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900/50 dark:bg-orange-900/10 dark:text-orange-200",
    };
  } else if (broadcast.status === "cancelled") {
    banner = {
      text: `Difusión cancelada: ${formatNumber(p.sent)} ${p.sent === 1 ? "contacto la recibió" : "contactos la recibieron"} y ${formatNumber(p.cancelled)} no ${p.cancelled === 1 ? "la recibirá" : "la recibirán"}.`,
      className: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-300",
    };
  } else if (broadcast.status === "completed") {
    banner = {
      text: `La difusión terminó: ${formatNumber(p.sent)} de ${formatNumber(p.total)} ${p.total === 1 ? "contacto recibió" : "contactos recibieron"} el mensaje.`,
      className: "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-900/10 dark:text-green-300",
    };
  }

  const cards: { label: string; value: number; className?: string; hide?: boolean }[] = [
    { label: "Destinatarios", value: p.total },
    { label: "Enviados", value: p.sent, className: "text-green-600 dark:text-green-400" },
    { label: "Pendientes", value: waiting, className: "text-blue-600 dark:text-blue-400" },
    { label: "Omitidos por baja o sin consentimiento", value: p.skipped, className: "text-amber-600 dark:text-amber-400" },
    { label: "Fallidos", value: p.failed, className: "text-red-600 dark:text-red-400" },
    { label: "Cancelados", value: p.cancelled, className: "text-muted-foreground", hide: p.cancelled === 0 },
  ];

  return (
    <div className="space-y-3" aria-live="polite">
      {banner && <div className={cn("rounded-lg border px-4 py-3 text-sm", banner.className)}>{banner.text}</div>}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>Avance</span>
          <span>{percent}%</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Avance de la difusión"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards
          .filter((c) => !c.hide)
          .map((c) => (
            <div key={c.label} className="rounded-lg border border-border bg-card p-3 text-center sm:p-4">
              <p className={cn("text-xl font-bold sm:text-2xl", c.className)}>{formatNumber(c.value)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.label}</p>
            </div>
          ))}
      </div>
    </div>
  );
}

type ControlAction = "pause" | "resume" | "cancel";
/** Cada cuánto se actualiza sola la pantalla de una difusión que está enviando. */
const PROGRESS_POLL_MS = 5_000;

function BroadcastDetail({
  broadcast,
  workspaceId,
  onBack,
  onUpdate,
  onDeleted,
}: {
  broadcast: Broadcast;
  workspaceId: string;
  onBack: () => void;
  onUpdate: (updated: Broadcast) => void;
  onDeleted: (id: string) => void;
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
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [failedRecipients, setFailedRecipients] = useState<FailedRecipient[]>([]);
  const [skippedRecipients, setSkippedRecipients] = useState<SkippedRecipient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingFilter, setEditingFilter] = useState(false);
  const [filterDraft, setFilterDraft] = useState<SegmentFilter>(() => filterWithIds(broadcast.segment_filter));
  const [savingFilter, setSavingFilter] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const viewAs = useViewAs();
  const [progress, setProgress] = useState<BroadcastProgress | null>(null);
  const [acting, setActing] = useState<ControlAction | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Siempre la última versión, para que el avance automático no use datos viejos.
  const latest = useRef({ broadcast, onUpdate });
  useEffect(() => {
    latest.current = { broadcast, onUpdate };
  });

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

  // Quienes no recibieron la difusión porque se dieron de baja o no tenían consentimiento al momento de enviar.
  useEffect(() => {
    if (isDraft) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("broadcast_recipients")
      .select("id, error_message, contacts(display_name)")
      .eq("broadcast_id", broadcast.id)
      .eq("status", "skipped")
      .limit(50)
      .then(({ data }) => {
        if (!cancelled) setSkippedRecipients((data ?? []) as unknown as SkippedRecipient[]);
      });
    return () => {
      cancelled = true;
    };
  }, [broadcast.id, broadcast.status, broadcast.sent, broadcast.failed, isDraft]);

  const isLive = isBroadcastLive(broadcast.status);

  // Avance real (por estado de cada destinatario). Se consulta solo mientras la difusión envía o está en pausa.
  const refreshProgress = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/broadcasts/${broadcast.id}/progress`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        progress: BroadcastProgress;
        broadcast: Pick<Broadcast, "status" | "sent" | "delivered" | "failed" | "total_recipients" | "paused_reason" | "pause_note" | "paused_at">;
      };
      setProgress(data.progress);
      const current = latest.current.broadcast;
      const b = data.broadcast;
      if (
        b.status !== current.status ||
        b.sent !== current.sent ||
        b.failed !== current.failed ||
        b.paused_reason !== current.paused_reason ||
        b.pause_note !== current.pause_note
      ) {
        latest.current.onUpdate({ ...current, ...b });
      }
    } catch {
      // Sin conexión un momento: la próxima consulta lo corrige.
    }
  }, [broadcast.id]);

  useEffect(() => {
    if (broadcast.status === "draft" || broadcast.status === "scheduled") return;
    void refreshProgress();
    if (!isLive) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshProgress();
    }, PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [broadcast.id, broadcast.status, isLive, refreshProgress]);

  async function runControl(action: ControlAction) {
    setActing(action);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/v1/broadcasts/${broadcast.id}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo completar la operación. Inténtalo de nuevo.");
      const next = data.progress as BroadcastProgress;
      setProgress(next);
      onUpdate({ ...broadcast, status: data.status });
      const message =
        action === "pause"
          ? "Difusión en pausa. Dejará de enviar en menos de un minuto; lo ya enviado queda enviado."
          : action === "resume"
            ? "Difusión reanudada. Sigue con los pendientes, sin repetir a nadie."
            : cancelledSummary(next);
      setSuccess(message);
      toast.success(message);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo completar la operación. Inténtalo de nuevo.";
      setError(message);
      toast.error(message);
    } finally {
      setActing(null);
    }
  }

  function askCancel() {
    setConfirmCancel(true);
    void refreshProgress(); // cifras al momento de confirmar
  }

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
      toast.success("Borrador guardado");
    } catch (err) {
      console.error("Failed to save broadcast:", err);
      const message = "No se pudo guardar el borrador. Inténtalo de nuevo.";
      setError(message);
      toast.error(message);
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo calcular quién recibirá la difusión");
      setPreview(data as PreviewResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo calcular quién recibirá la difusión");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSaveFilter(next: SegmentFilter | null) {
    setSavingFilter(true);
    setError(null);
    try {
      const result = await updateBroadcastFilter(broadcast.id, next);
      if ("error" in result) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      onUpdate({ ...broadcast, segment_filter: result.segment_filter });
      setFilterDraft(filterWithIds(result.segment_filter));
      setEditingFilter(false);
      setPreview(null);
      toast.success(next ? "Filtro guardado" : "Filtro quitado");
    } catch {
      const message = "No se pudo guardar el filtro. Inténtalo de nuevo.";
      setError(message);
      toast.error(message);
    } finally {
      setSavingFilter(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const result = await deleteBroadcast(broadcast.id);
      if ("error" in result) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Borrador eliminado");
      onDeleted(broadcast.id);
    } catch {
      const message = "No se pudo eliminar el borrador. Inténtalo de nuevo.";
      setError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
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

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "No se pudo enviar la difusión");
      }

      setSuccess(`Enviando a ${formatNumber(data.totalRecipients)} destinatarios`);
      toast.success(`Difusión en marcha: ${formatNumber(data.totalRecipients)} destinatarios`);
      setPreview(null);

      // Actualizar la difusión localmente
      onUpdate({
        ...broadcast,
        status: "sending",
        total_recipients: data.totalRecipients,
        message_content: content as unknown as Json,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo enviar";
      setError(message);
      toast.error(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <button
            onClick={onBack}
            aria-label="Volver a las difusiones"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 basis-48">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="min-w-0 break-words text-xl font-bold sm:text-2xl">{broadcast.name}</h1>
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
          {isLive && (
            <div className="flex flex-wrap items-center gap-2">
              {broadcast.status === "sending" && (
                <button
                  onClick={() => runControl("pause")}
                  disabled={acting !== null || viewAs.active}
                  title={viewAs.active ? (viewAs.blockedNotice ?? undefined) : "Deja de enviar; lo ya enviado queda enviado"}
                  className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {acting === "pause" ? <Spinner /> : <Pause className="h-4 w-4" />}
                  {acting === "pause" ? "Pausando…" : "Pausar"}
                </button>
              )}
              {broadcast.status === "paused" && (
                <button
                  onClick={() => runControl("resume")}
                  disabled={acting !== null || viewAs.active}
                  title={viewAs.active ? (viewAs.blockedNotice ?? undefined) : "Sigue con los pendientes, sin repetir a nadie"}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {acting === "resume" ? <Spinner /> : <Play className="h-4 w-4" />}
                  {acting === "resume" ? "Reanudando…" : "Reanudar"}
                </button>
              )}
              <button
                onClick={askCancel}
                disabled={acting !== null || viewAs.active}
                title={viewAs.active ? (viewAs.blockedNotice ?? undefined) : "Los que faltan no recibirán el mensaje"}
                className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                {acting === "cancel" ? <Spinner /> : <XCircle className="h-4 w-4" />}
                {acting === "cancel" ? "Cancelando…" : "Cancelar difusión"}
              </button>
              <ConfirmDialog
                open={confirmCancel}
                title="Cancelar difusión"
                message={
                  progress
                    ? cancelConfirmMessage(progress)
                    : "Calculando cuántos contactos ya recibieron el mensaje…"
                }
                confirmLabel="Sí, cancelar difusión"
                cancelLabel="Volver"
                destructive
                onConfirm={() => {
                  setConfirmCancel(false);
                  void runControl("cancel");
                }}
                onCancel={() => setConfirmCancel(false)}
              />
            </div>
          )}
          {isDraft && (
            <>
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={deleting || sending}
                className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
                Eliminar borrador
              </button>
              <ConfirmDialog
                open={confirmDelete}
                title="Eliminar borrador"
                message="¿Seguro que quieres eliminar este borrador? No se puede deshacer."
                confirmLabel="Eliminar"
                destructive
                onConfirm={() => {
                  setConfirmDelete(false);
                  handleDelete();
                }}
                onCancel={() => setConfirmDelete(false)}
              />
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-4 sm:px-8 sm:py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Estado y avance real de una difusión que ya salió */}
          {!isDraft && (broadcast.total_recipients > 0 || progress) && (
            <BroadcastProgressPanel broadcast={broadcast} progress={progress} />
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

          {/* Omitidos por baja o falta de consentimiento */}
          {skippedRecipients.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-900/10">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                No se envió a {skippedRecipients.length} {skippedRecipients.length === 1 ? "contacto" : "contactos"} (se dieron de baja o dejaron de tener consentimiento antes del envío)
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {skippedRecipients.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium text-foreground">{r.contacts?.display_name || "Contacto sin nombre"}</span>
                    : {r.error_message || "Omitido"}
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

          {/* Filtro de segmento: en palabras, y editable mientras es borrador */}
          {(broadcast.segment_filter || editingFilter) && (
            <div className="rounded-lg border border-border bg-card p-4">
              {editingFilter ? (
                <div className="space-y-3">
                  <SegmentBuilder value={filterDraft} onChange={setFilterDraft} workspaceId={workspaceId} />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSaveFilter(filterDraft)}
                      disabled={savingFilter}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {savingFilter && <Spinner />}
                      Guardar filtro
                    </button>
                    <button
                      onClick={() => {
                        setEditingFilter(false);
                        setFilterDraft(filterWithIds(broadcast.segment_filter));
                      }}
                      disabled={savingFilter}
                      className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                    >
                      Cancelar
                    </button>
                    {broadcast.segment_filter && (
                      <button
                        onClick={() => handleSaveFilter(null)}
                        disabled={savingFilter}
                        className="ml-auto rounded-lg px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        Quitar filtro (enviar a todos)
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <SegmentSummary filter={filterWithIds(broadcast.segment_filter)} workspaceId={workspaceId} />
                  {incompleteFilterProblem(broadcast.segment_filter as unknown as SegmentFilter) && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Este filtro tiene reglas sin completar y no se podrá enviar así. Edítalo.
                    </p>
                  )}
                  {isDraft && (
                    <button
                      onClick={() => setEditingFilter(true)}
                      className="rounded-lg border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                      Editar filtro
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {isDraft && !broadcast.segment_filter && !editingFilter && (
            <button
              onClick={() => {
                setFilterDraft(createEmptyFilter());
                setEditingFilter(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Filter className="h-3.5 w-3.5" />
              Dirigir a contactos específicos
            </button>
          )}

          {/* Resultado de la selección antes de enviar */}
          {preview && isDraft && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <p className="text-sm font-medium">
                {preview.segmentTotal === 0
                  ? "Ningún contacto cumple el filtro."
                  : `Recibirán la difusión ${formatNumber(preview.willReceive)} ${preview.willReceive === 1 ? "contacto" : "contactos"}`}
              </p>
              {preview.willReceive > 0 && (
                <p className="text-xs text-muted-foreground">
                  Se envía a unos {BROADCAST_SENDS_PER_PASS} contactos por minuto para cuidar tu número de WhatsApp: tardará{" "}
                  {describeBroadcastEta(preview.willReceive)}. Puedes pausarla o cancelarla mientras tanto.
                </p>
              )}
              {preview.excludedTotal > 0 && (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Quedan fuera {formatNumber(preview.excludedTotal)}: {preview.excludedReasons.join("; ")}.
                </p>
              )}
              {((preview.excluded?.noConsent ?? 0) > 0 || (preview.excluded?.optedOut ?? 0) > 0) && (
                <p className="text-xs text-muted-foreground">
                  La publicidad solo se envía a quien aceptó recibirla. Para incluir a los «sin registrar», anota su
                  consentimiento en su ficha o en el panel del chat. A quienes se dieron de baja no se les puede enviar.
                </p>
              )}
              {preview.kind === "text" && (preview.excluded?.closedWindow ?? 0) + (preview.excluded?.noConversation ?? 0) > 0 && (
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
                  {sending ? "Enviando…" : `Confirmar y enviar a ${formatNumber(preview.willReceive)}`}
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
                {previewing ? "Calculando…" : "Revisar y enviar"}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !contentReady}
                className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                {saving && <Spinner />}
                {saving ? "Guardando…" : "Guardar borrador"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
