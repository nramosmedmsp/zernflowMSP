"use client";

import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Bot, BotOff, User, MessageSquare, CheckCircle, Clock, RotateCcw, Loader2, StickyNote, FlaskConical, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatTime } from "@/lib/format";
import { setConversationBotPaused, type CaseView } from "@/lib/actions/cases";
import type { Database, ConversationStatus } from "@/lib/types/database";
import { Composer } from "./composer";
import { DemoBadge } from "./demo-badge";
import { SimulateInboundDialog } from "./simulate-inbound-dialog";
import { latestIso, memberName, type InboxConversation, type InboxMember } from "./inbox-model";
import type { CaseNote } from "./use-case-notes";

type Message = Database["public"]["Tables"]["messages"]["Row"];

type TimelineItem =
  | { kind: "message"; at: string; message: Message }
  | { kind: "note"; at: string; note: CaseNote };

const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  open: "Abierta",
  closed: "Cerrada",
  snoozed: "Pospuesta",
};

function formatDateSeparator(dateStr: string): string {
  const day = formatDate(dateStr);
  const now = Date.now();
  if (day === formatDate(now)) return "Hoy";
  if (day === formatDate(now - 24 * 60 * 60 * 1000)) return "Ayer";
  return day;
}

function MessageBubble({ message, onRetry }: { message: Message; onRetry?: (id: string) => void }) {
  const isInbound = message.direction === "inbound";
  const isBot = message.sent_by_flow_id !== null;
  const sending = !isInbound && message.status === "pending" && message.id.startsWith("optimistic-");
  const failed = !isInbound && message.status === "failed";

  return (
    <div
      className={cn(
        "flex gap-2",
        isInbound ? "justify-start" : "justify-end",
        message.id.startsWith("optimistic-") && "animate-slide-up"
      )}
    >
      {isInbound && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}

      <div className="max-w-[70%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2 text-sm",
            isInbound
              ? "rounded-tl-md bg-muted text-foreground"
              : "rounded-tr-md bg-primary text-primary-foreground",
            sending && "opacity-70",
            failed && "bg-destructive/90 ring-1 ring-destructive"
          )}
        >
          {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
          {message.attachments && (
            <div className="mt-1">
              <Paperclip className="inline h-3 w-3" />
              <span className="ml-1 text-xs opacity-70">Archivo adjunto</span>
            </div>
          )}
        </div>
        <div
          className={cn(
            "mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground",
            isInbound ? "justify-start" : "justify-end"
          )}
        >
          {isBot && (
            <Bot className="h-3 w-3" />
          )}
          {sending ? (
            <span className="inline-flex items-center gap-1">
              <Spinner className="h-3 w-3" />
              Enviando…
            </span>
          ) : failed ? (
            <span role="alert" className="inline-flex items-center gap-1.5 text-destructive">
              <AlertCircle className="h-3 w-3" />
              No se envió
              {onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(message.id)}
                  className="font-medium underline underline-offset-2 hover:no-underline"
                >
                  Reintentar
                </button>
              )}
            </span>
          ) : (
            <>
              <span>{formatTime(message.created_at)}</span>
              {!isInbound && message.status === "delivered" && <span>Entregado</span>}
            </>
          )}
        </div>
      </div>

      {!isInbound && !isBot && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      {!isInbound && isBot && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
    </div>
  );
}

/** Resalta las menciones "@Nombre" de los miembros mencionados. */
function NoteBody({ note, members }: { note: CaseNote; members: InboxMember[] }) {
  const names = note.mentions
    .map((id) => members.find((m) => m.userId === id)?.name)
    .filter((n): n is string => !!n)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return <p className="whitespace-pre-wrap">{note.body}</p>;

  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = note.body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-semibold text-amber-900 dark:text-amber-200">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function NoteBubble({ note, members }: { note: CaseNote; members: InboxMember[] }) {
  return (
    <div className="flex justify-center">
      <div className="w-full max-w-[85%] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
        <div className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-800 dark:text-amber-300">
          <StickyNote className="h-3 w-3" />
          <span>Nota interna</span>
          <span>·</span>
          <span>{note.author_id ? memberName(members, note.author_id) : "Sistema"}</span>
          <span>·</span>
          <span>{formatTime(note.created_at)}</span>
        </div>
        <NoteBody note={note} members={members} />
      </div>
    </div>
  );
}

export function MessageThread({
  conversation,
  messages: initialMessages,
  loading = false,
  caseSlot,
  notes = [],
  members = [],
  noteCase = null,
  me,
  teamName = null,
  workspaceName = "",
  onNoteAdded,
  onCaseActivity,
  isDemo = false,
  canSimulate = false,
}: {
  conversation: InboxConversation | null;
  messages: Message[];
  loading?: boolean;
  /** Tarjeta de gestión, debajo de la cabecera. */
  caseSlot?: ReactNode;
  notes?: CaseNote[];
  members?: InboxMember[];
  /** Gestión activa (para notas, la ventana de WhatsApp y las respuestas guardadas). */
  noteCase?: CaseView | null;
  me: { userId: string; name: string };
  teamName?: string | null;
  workspaceName?: string;
  onNoteAdded?: (note: CaseNote) => void;
  /** Se envió algo al cliente: la gestión cambia (sellos, espera). */
  onCaseActivity?: () => void;
  /** Conversación de un canal de prueba (lib/demo.ts): etiqueta "Prueba". */
  isDemo?: boolean;
  /** Administrador: botón "Simular mensaje del cliente" (solo con isDemo). */
  canSimulate?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const conversationId = conversation?.id ?? null;

  const updateConversationStatus = useCallback(async (status: ConversationStatus) => {
    if (!conversation || statusUpdating) return;
    setStatusUpdating(status);
    try {
      const { error } = await createClient()
        .from("conversations")
        .update({ status })
        .eq("id", conversation.id);
      if (error) throw error;
      router.refresh();
      toast.success(status === "closed" ? "Conversación cerrada" : status === "snoozed" ? "Conversación pospuesta" : "Conversación reabierta");
    } catch {
      toast.error("No se pudo actualizar el estado de la conversación");
    } finally {
      setStatusUpdating(null);
    }
  }, [conversation, statusUpdating, router, toast]);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // Pausar o reanudar el bot (solo quien puede editar la gestión activa). El valor
  // local cubre el tiempo hasta que llega la actualización de la conversación.
  const [botBusy, setBotBusy] = useState(false);
  const [botPausedLocal, setBotPausedLocal] = useState<boolean | null>(null);
  const serverBotPaused = conversation?.is_automation_paused ?? false;
  useEffect(() => {
    setBotPausedLocal(null);
  }, [conversationId, serverBotPaused]);
  const botPaused = botPausedLocal ?? serverBotPaused;
  const canToggleBot = !!noteCase && noteCase.status === "open" && noteCase.permissions.canEdit;

  const toggleBotPaused = useCallback(async () => {
    if (!conversationId || !noteCase || botBusy) return;
    const next = !botPaused;
    setBotBusy(true);
    try {
      const result = await setConversationBotPaused(noteCase.id, conversationId, next);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        setBotPausedLocal(result.paused);
        toast.success(result.paused ? "Bot en pausa en este chat" : "Bot reanudado en este chat");
        onCaseActivity?.();
      }
    } catch {
      toast.error("No se pudo cambiar el estado del bot");
    } finally {
      setBotBusy(false);
    }
  }, [conversationId, noteCase, botBusy, botPaused, onCaseActivity, toast]);

  const refetchMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const res = await fetch(`/api/v1/messages?conversationId=${conversationId}`);
      if (res.ok) {
        const freshMessages: Message[] = await res.json();
        setMessages((prev) => {
          const optimistic = prev.filter((m) => m.id.startsWith("optimistic-"));
          return [...freshMessages, ...optimistic];
        });
      }
    } catch (err) {
      console.error("Failed to refresh messages:", err);
    }
  }, [conversationId]);

  // Mensajes y notas intercalados por fecha.
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...messages.map((message) => ({ kind: "message" as const, at: message.created_at, message })),
      ...notes.map((note) => ({ kind: "note" as const, at: note.created_at, note })),
    ];
    return items
      .map((item, index) => ({ item, index, t: new Date(item.at).getTime() || 0 }))
      .sort((a, b) => a.t - b.t || a.index - b.index)
      .map(({ item }) => item);
  }, [messages, notes]);

  // Auto-scroll to bottom when messages or notes change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timeline.length]);

  // Listen for conversation updates (last_message_at changes when a new message arrives)
  // and re-fetch messages from Zernio API.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationId}`,
        },
        () => void refetchMessages()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, refetchMessages]);

  const lastInboundMessageAt = useMemo(() => {
    let latest: string | null = null;
    for (const m of messages) {
      if (m.direction === "inbound" && !m.id.startsWith("optimistic-")) latest = latestIso(latest, m.created_at);
    }
    return latest;
  }, [messages]);

  async function handleSend(text: string) {
    if (!conversation) return;

    // Optimistic update: add a temporary message immediately
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      conversation_id: conversation.id,
      direction: "outbound",
      text,
      attachments: null,
      quick_reply_payload: null,
      postback_payload: null,
      callback_data: null,
      platform_message_id: null,
      sent_by_flow_id: null,
      sent_by_node_id: null,
      sent_by_user_id: null,
      status: "pending",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    await deliver(optimisticId, text);
  }

  /** Reintenta un mensaje que falló: vuelve a "Enviando…" y lo manda otra vez. */
  async function handleRetry(messageId: string) {
    const failed = messages.find((m) => m.id === messageId);
    if (!failed?.text || failed.status !== "failed") return;
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, status: "pending" as const } : m)));
    await deliver(messageId, failed.text);
  }

  async function deliver(optimisticId: string, text: string) {
    if (!conversation) return;
    try {
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, text }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `No se pudo enviar (${res.status})`);
      }

      const confirmedMessage: Message = await res.json();

      // Replace optimistic message with confirmed one
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? confirmedMessage : m))
      );
      onCaseActivity?.();
    } catch (err) {
      console.error("Failed to send message:", err);
      // Mark optimistic message as failed
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId ? { ...m, status: "failed" as const } : m
        )
      );
      toast.error(err instanceof Error ? err.message : "No se pudo enviar el mensaje");
    }
  }

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-sm font-medium text-muted-foreground">
          Selecciona una conversación
        </h3>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Elige una conversación de la lista para ver los mensajes
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            {conversation.contacts?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={conversation.contacts.avatar_url}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                {conversation.contacts?.display_name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-background">
              <PlatformIcon
                platform={conversation.platform}
                className="h-2.5 w-2.5"
                size={10}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">
              {conversation.contacts?.display_name ?? "Desconocido"}
            </p>
            {isDemo && <DemoBadge />}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDemo && canSimulate && (
            <button
              onClick={() => setSimulateOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-violet-200 px-2 py-1 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-50 dark:border-violet-900/60 dark:text-violet-300 dark:hover:bg-violet-950/40"
            >
              <FlaskConical className="h-3 w-3" />
              Simular mensaje del cliente
            </button>
          )}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
              conversation.status === "open"
                ? "bg-green-100 text-green-700"
                : conversation.status === "snoozed"
                ? "bg-yellow-100 text-yellow-700"
                : "bg-muted text-muted-foreground"
            )}
          >
            {CONVERSATION_STATUS_LABELS[conversation.status]}
          </span>
          {canToggleBot ? (
            <button
              onClick={() => void toggleBotPaused()}
              disabled={botBusy}
              title={
                botPaused
                  ? "El bot no responde en este chat. Reanúdalo para que vuelva a atender los mensajes del cliente."
                  : "Pausa el bot en este chat para que no responda mientras atiendes."
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
                botPaused
                  ? "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {botBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : botPaused ? <Bot className="h-3 w-3" /> : <BotOff className="h-3 w-3" />}
              {botPaused ? "Reanudar bot" : "Pausar bot"}
            </button>
          ) : (
            botPaused && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                Bot en pausa
              </span>
            )
          )}
          <div className="flex items-center gap-1">
            {conversation.status !== "closed" && (
              <button
                onClick={() => updateConversationStatus("closed")}
                disabled={!!statusUpdating}
                title="Cerrar conversación"
                aria-label="Cerrar conversación"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
              >
                {statusUpdating === "closed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
              </button>
            )}
            {conversation.status !== "snoozed" && (
              <button
                onClick={() => updateConversationStatus("snoozed")}
                disabled={!!statusUpdating}
                title="Posponer conversación"
                aria-label="Posponer conversación"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
              >
                {statusUpdating === "snoozed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
              </button>
            )}
            {conversation.status !== "open" && (
              <button
                onClick={() => updateConversationStatus("open")}
                disabled={!!statusUpdating}
                title="Reabrir conversación"
                aria-label="Reabrir conversación"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
              >
                {statusUpdating === "open" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {caseSlot}

      {/* Messages and internal notes */}
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div role="status" aria-busy="true" className="mx-auto max-w-2xl animate-fade-in space-y-4">
            <span className="sr-only">Cargando mensajes…</span>
            <Skeleton className="h-10 w-2/5 rounded-2xl" />
            <Skeleton className="ml-auto h-14 w-1/2 rounded-2xl" />
            <Skeleton className="h-10 w-1/3 rounded-2xl" />
            <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {timeline.map((item, i) => {
              const previous = timeline[i - 1];
              const showSeparator = !previous || formatDate(previous.at) !== formatDate(item.at);
              return (
                <div key={item.kind === "message" ? item.message.id : `note-${item.note.id}`}>
                  {showSeparator && (
                    <div className="my-4 flex items-center gap-3">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[11px] text-muted-foreground">
                        {formatDateSeparator(item.at)}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  {item.kind === "message" ? (
                    <MessageBubble message={item.message} onRetry={(id) => void handleRetry(id)} />
                  ) : (
                    <NoteBubble note={item.note} members={members} />
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {isDemo && canSimulate && (
        <SimulateInboundDialog
          open={simulateOpen}
          conversationId={conversation.id}
          contactName={conversation.contacts?.display_name ?? null}
          onClose={() => setSimulateOpen(false)}
          onSent={() => {
            void refetchMessages();
            onCaseActivity?.();
          }}
        />
      )}

      {/* Composer */}
      <Composer
        conversation={conversation}
        noteCase={noteCase}
        lastInboundAt={latestIso(noteCase?.lastInboundAt, lastInboundMessageAt)}
        members={members}
        me={me}
        teamName={teamName}
        workspaceName={workspaceName}
        onSendMessage={(text) => void handleSend(text)}
        onNoteAdded={(note) => onNoteAdded?.(note)}
        onTemplateSent={() => {
          void refetchMessages();
          onCaseActivity?.();
        }}
      />
    </div>
  );
}
