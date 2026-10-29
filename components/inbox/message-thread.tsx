"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { Bot, BotOff, Check, CheckCheck, Paperclip, User, MessageSquare, Loader2, StickyNote, FlaskConical, AlertCircle, ArrowDown, Reply } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatPhoneDisplay, formatRelative, formatTime } from "@/lib/format";
import { platformLabel } from "@/lib/platforms";
import { linkify } from "@/lib/linkify";
import type { InboxMessage } from "@/lib/inbox-messages";
import type { OutboxAttachment } from "@/lib/inbox-outbox";
import { setConversationBotPaused, type CaseView } from "@/lib/actions/cases";
import { Composer } from "./composer";
import { DemoBadge } from "./demo-badge";
import { SimulateInboundDialog } from "./simulate-inbound-dialog";
import { latestIso, memberName, messageAuthor, sequenceOriginName, waitingText, type InboxConversation, type InboxMember } from "./inbox-model";
import type { CaseNote } from "./use-case-notes";
import { useThreadMessages } from "./use-thread-messages";
import { useNow } from "./use-now";
import { MessageMedia } from "./message-media";
import { MediaLightbox, type LightboxImage } from "./media-lightbox";

type TimelineItem =
  | { kind: "message"; at: string; message: InboxMessage }
  | { kind: "note"; at: string; note: CaseNote };

/** Distancia al final (px) para considerar que el asesor está leyendo lo último. */
const NEAR_BOTTOM_PX = 120;

function formatDateSeparator(dateStr: string): string {
  const day = formatDate(dateStr);
  const now = Date.now();
  if (day === formatDate(now)) return "Hoy";
  if (day === formatDate(now - 24 * 60 * 60 * 1000)) return "Ayer";
  return day;
}

/** Texto con enlaces clicables (solo http/https). */
function MessageText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {linkify(text).map((part, i) =>
        part.type === "link" ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
            {part.value}
          </a>
        ) : (
          part.value
        ),
      )}
    </p>
  );
}

/** ✓ enviado, ✓✓ entregado, ✓✓ azul leído. */
function DeliveryTicks({ status }: { status: InboxMessage["status"] }) {
  if (status === "read") {
    return (
      <span title="Leído" aria-label="Leído" className="inline-flex text-sky-500">
        <CheckCheck className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === "delivered") {
    return (
      <span title="Entregado" aria-label="Entregado" className="inline-flex">
        <CheckCheck className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === "sent") {
    return (
      <span title="Enviado" aria-label="Enviado" className="inline-flex">
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  }
  return null;
}

function MessageBubble({
  message,
  author,
  onRetry,
  onOpenImage,
}: {
  message: InboxMessage;
  /** Quién lo envió ("Tú", "Ana", "Bot · Bienvenida"); null si no se sabe. */
  author: string | null;
  onRetry?: (clientId: string) => void;
  onOpenImage: (image: LightboxImage) => void;
}) {
  const isInbound = message.direction === "inbound";
  const media = message.media ?? [];
  // Archivos sin el detalle de la bandeja (envíos del bot o canales de prueba).
  const bareAttachment = media.length === 0 && Array.isArray(message.attachments) && message.attachments.length > 0;
  const isBot = message.sent_by_flow_id !== null || sequenceOriginName(message.sent_by_node_id) !== null;
  // Envíos de la bandeja que aún no llegan a la lista de Zernio (lib/inbox-outbox.ts).
  const outboxId = message.id.startsWith("outbox-") ? message.id.slice("outbox-".length) : null;
  const sending = !isInbound && message.status === "pending" && !!outboxId;
  // No salió de la bandeja (se puede reintentar) o la plataforma no lo entregó (no).
  const failed = !isInbound && message.status === "failed";

  return (
    <div
      className={cn(
        "flex gap-2",
        isInbound ? "justify-start" : "justify-end",
        outboxId && "animate-slide-up"
      )}
    >
      {isInbound && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}

      <div className="min-w-0 max-w-[70%]">
        <div
          className={cn(
            "rounded-2xl text-sm",
            media.length > 0 ? "p-1" : "px-4 py-2",
            isInbound
              ? "rounded-tl-md bg-muted text-foreground"
              : "rounded-tr-md bg-primary text-primary-foreground",
            sending && "opacity-70",
            failed && outboxId && "bg-destructive/90 ring-1 ring-destructive"
          )}
        >
          {message.story && (
            <p
              className={cn(
                "mb-0.5 flex items-center gap-1 text-[11px] font-medium",
                isInbound ? "text-muted-foreground" : "opacity-80",
                media.length > 0 && "px-3 pt-1",
              )}
            >
              <Reply className="h-3 w-3" />
              {message.story === "mention" ? "Te mencionó en su historia" : "Respondió a tu historia"}
            </p>
          )}
          {media.length > 0 && <MessageMedia media={media} inbound={isInbound} onOpenImage={onOpenImage} />}
          {message.text && (
            <div className={cn(media.length > 0 && "px-3 pb-1 pt-1.5")}>
              <MessageText text={message.text} />
            </div>
          )}
          {bareAttachment && (
            <div className={cn("flex items-center gap-1 text-xs opacity-70", message.text && "mt-1")}>
              <Paperclip className="h-3 w-3" />
              Archivo adjunto
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
          ) : failed && outboxId ? (
            <span role="alert" className="inline-flex items-center gap-1.5 text-destructive">
              <AlertCircle className="h-3 w-3" />
              No se envió
              {onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(outboxId)}
                  className="font-medium underline underline-offset-2 hover:no-underline"
                >
                  Reintentar
                </button>
              )}
            </span>
          ) : failed ? (
            <span role="alert" className="inline-flex flex-wrap items-center justify-end gap-1 text-destructive">
              <AlertCircle className="h-3 w-3" />
              {message.error ? `No se entregó: ${message.error}.` : "No se entregó."}
            </span>
          ) : (
            <>
              {author && <span className="font-medium">{author} ·</span>}
              <span>{formatTime(message.created_at)}</span>
              {!isInbound && <DeliveryTicks status={message.status} />}
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
  if (names.length === 0) return <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{note.body}</p>;

  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = note.body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return (
    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
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

function itemKey(item: TimelineItem): string {
  return item.kind === "message" ? item.message.id : `note-${item.note.id}`;
}

/**
 * Chat abierto. La vista lo monta de nuevo al cambiar de conversación (key),
 * así su estado nunca se mezcla con el de otro chat.
 */
export function MessageThread({
  conversation,
  outbox = [],
  initialUnread = 0,
  onSend,
  onRetry,
  onServerMessages,
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
  isAdmin = false,
}: {
  conversation: InboxConversation | null;
  /** Envíos de la bandeja de este chat que aún no aparecen en la lista de Zernio. */
  outbox?: InboxMessage[];
  /** No leídos al abrir el chat: marca dónde empiezan los mensajes nuevos. */
  initialUnread?: number;
  onSend?: (text: string, attachments: OutboxAttachment[]) => void;
  onRetry?: (clientId: string) => void;
  /** Llegó la lista del servidor: la bandeja de salida quita lo que ya aparece. */
  onServerMessages?: (messages: InboxMessage[]) => void;
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
  /** Dueño o Administrador (diccionario de la tienda). */
  isAdmin?: boolean;
}) {
  const toast = useToast();
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const conversationId = conversation?.id ?? null;
  const thread = useThreadMessages(conversationId);
  const serverMessages = thread.messages;

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

  // La bandeja de salida quita los envíos que ya aparecen en la lista del servidor.
  useEffect(() => {
    if (thread.status === "ready") onServerMessages?.(serverMessages);
  }, [serverMessages, thread.status, onServerMessages]);

  // Mensajes (del servidor y en envío) y notas intercalados por fecha.
  const timeline = useMemo<TimelineItem[]>(() => {
    // Un envío confirmado que ya llegó en la lista del servidor no se muestra dos veces.
    const serverIds = new Set(serverMessages.map((m) => m.id));
    const pending = outbox.filter((m) => !m.platform_message_id || !serverIds.has(m.platform_message_id));
    const items: TimelineItem[] = [
      ...serverMessages.map((message) => ({ kind: "message" as const, at: message.created_at, message })),
      ...pending.map((message) => ({ kind: "message" as const, at: message.created_at, message })),
      ...notes.map((note) => ({ kind: "note" as const, at: note.created_at, note })),
    ];
    return items
      .map((item, index) => ({ item, index, t: new Date(item.at).getTime() || 0 }))
      .sort((a, b) => a.t - b.t || a.index - b.index)
      .map(({ item }) => item);
  }, [serverMessages, outbox, notes]);

  // Dónde empiezan los no leídos: se fija con la primera carga y no se mueve.
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const unreadFixed = useRef(false);
  useEffect(() => {
    if (unreadFixed.current || thread.status !== "ready") return;
    unreadFixed.current = true;
    if (initialUnread <= 0) return;
    const inbound = serverMessages.filter((m) => m.direction === "inbound");
    const first = inbound[Math.max(0, inbound.length - initialUnread)];
    if (first) setFirstUnreadId(first.id);
  }, [thread.status, serverMessages, initialUnread]);

  // Desplazamiento: abre al final sin animación; baja solo si el asesor ya
  // estaba al final (o si envió él); si está leyendo arriba, cuenta lo nuevo.
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const edges = useRef<{ first: string | null; last: string | null; count: number } | null>(null);
  const olderAnchor = useRef<{ height: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || thread.status !== "ready") return;
    const lastItem = timeline[timeline.length - 1];
    const next = { first: timeline[0] ? itemKey(timeline[0]) : null, last: lastItem ? itemKey(lastItem) : null, count: timeline.length };
    const prev = edges.current;
    edges.current = next;
    if (!prev) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    // Se cargaron mensajes anteriores: mantiene a la vista lo que se estaba leyendo.
    if (olderAnchor.current && next.first !== prev.first) {
      const anchor = olderAnchor.current;
      olderAnchor.current = null;
      el.scrollTop = el.scrollHeight - anchor.height + anchor.top;
      return;
    }
    if (next.last === prev.last) return;
    const mine =
      lastItem?.kind === "note" ||
      (lastItem?.kind === "message" && lastItem.message.id.startsWith("outbox-"));
    if (nearBottom.current || mine) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else if (next.count > prev.count) {
      setNewBelow((n) => n + (next.count - prev.count));
    }
  }, [timeline, thread.status]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    nearBottom.current = near;
    setShowJump(!near);
    if (near) setNewBelow(0);
  }, []);

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setNewBelow(0);
  }, []);

  const { loadOlder } = thread;
  const handleLoadOlder = useCallback(async () => {
    const el = scrollRef.current;
    if (el) olderAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
    await loadOlder();
    // Si no llegó nada nuevo, el ancla no se usa.
    requestAnimationFrame(() => requestAnimationFrame(() => (olderAnchor.current = null)));
  }, [loadOlder]);

  // Debajo del nombre: canal, teléfono o @usuario y cuánto lleva esperando.
  const [channelInfo, setChannelInfo] = useState<{ senderId: string | null; username: string | null } | null>(null);
  const contactIdOfChat = conversation?.contact_id ?? null;
  const channelIdOfChat = conversation?.channel_id ?? null;
  useEffect(() => {
    if (!contactIdOfChat || !channelIdOfChat) return;
    let cancelled = false;
    void createClient()
      .from("contact_channels")
      .select("platform_sender_id, platform_username")
      .eq("contact_id", contactIdOfChat)
      .eq("channel_id", channelIdOfChat)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setChannelInfo({ senderId: data.platform_sender_id, username: data.platform_username });
      });
    return () => {
      cancelled = true;
    };
  }, [contactIdOfChat, channelIdOfChat]);
  const handle =
    formatPhoneDisplay(conversation?.contacts?.phone) ||
    (conversation?.platform === "whatsapp" ? formatPhoneDisplay(channelInfo?.senderId) : "") ||
    (channelInfo?.username ? `@${channelInfo.username}` : "");
  const now = useNow();
  const waiting =
    noteCase?.waitingSince && now !== null ? waitingText(formatRelative(noteCase.waitingSince, new Date(now))) : "";

  const lastInboundMessageAt = useMemo(() => {
    let latest: string | null = null;
    for (const m of serverMessages) {
      if (m.direction === "inbound") latest = latestIso(latest, m.created_at);
    }
    return latest;
  }, [serverMessages]);

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
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium">
                {conversation.contacts?.display_name ?? "Desconocido"}
              </p>
              {isDemo && <DemoBadge />}
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {platformLabel(conversation.platform)}
              {handle && ` · ${handle}`}
              {waiting && (
                <>
                  {" · "}
                  <span className="font-medium text-amber-700 dark:text-amber-400">{waiting}</span>
                </>
              )}
            </p>
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
        </div>
      </div>

      {caseSlot}

      {/* Messages and internal notes */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto p-4">
          {thread.status === "loading" ? (
            <div role="status" aria-busy="true" className="mx-auto max-w-2xl animate-fade-in space-y-4">
              <span className="sr-only">Cargando mensajes…</span>
              <Skeleton className="h-10 w-2/5 rounded-2xl" />
              <Skeleton className="ml-auto h-14 w-1/2 rounded-2xl" />
              <Skeleton className="h-10 w-1/3 rounded-2xl" />
              <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
            </div>
          ) : thread.status === "error" ? (
            <div role="alert" className="mx-auto flex max-w-sm flex-col items-center gap-2 py-12 text-center">
              <AlertCircle className="h-8 w-8 text-destructive/70" />
              <p className="text-sm text-muted-foreground">{thread.error}</p>
              <button
                onClick={() => void thread.refresh()}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Reintentar
              </button>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-4">
              {thread.hasOlder && (
                <div className="flex justify-center">
                  <button
                    onClick={() => void handleLoadOlder()}
                    disabled={thread.loadingOlder}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
                  >
                    {thread.loadingOlder && <Loader2 className="h-3 w-3 animate-spin" />}
                    Cargar mensajes anteriores
                  </button>
                </div>
              )}
              {timeline.map((item, i) => {
                const previous = timeline[i - 1];
                const showSeparator = !previous || formatDate(previous.at) !== formatDate(item.at);
                const key = itemKey(item);
                return (
                  <div key={key}>
                    {showSeparator && (
                      <div className="my-4 flex items-center gap-3">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-[11px] text-muted-foreground">
                          {formatDateSeparator(item.at)}
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    {key === firstUnreadId && (
                      <div className="my-3 flex items-center gap-3">
                        <div className="h-px flex-1 bg-primary/40" />
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          {initialUnread === 1 ? "1 mensaje no leído" : `${initialUnread} mensajes no leídos`}
                        </span>
                        <div className="h-px flex-1 bg-primary/40" />
                      </div>
                    )}
                    {item.kind === "message" ? (
                      <MessageBubble
                        message={item.message}
                        author={messageAuthor(item.message, members, me.userId)}
                        onRetry={onRetry}
                        onOpenImage={setLightbox}
                      />
                    ) : (
                      <NoteBubble note={item.note} members={members} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {showJump && thread.status === "ready" && (
          <button
            onClick={jumpToBottom}
            className="animate-fade-in absolute bottom-3 right-4 inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-md hover:bg-accent"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Ir al final
            {newBelow > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{newBelow}</span>
            )}
          </button>
        )}
      </div>

      <MediaLightbox image={lightbox} onClose={closeLightbox} />

      {isDemo && canSimulate && (
        <SimulateInboundDialog
          open={simulateOpen}
          conversationId={conversation.id}
          contactName={conversation.contacts?.display_name ?? null}
          onClose={() => setSimulateOpen(false)}
          onSent={() => {
            void thread.refresh();
            onCaseActivity?.();
          }}
        />
      )}

      {/* Composer */}
      <Composer
        conversation={conversation}
        noteCase={noteCase}
        // La ventana de 24 h es de ESTE chat: no la del último mensaje de la gestión (que puede venir de Instagram).
        lastInboundAt={latestIso(conversation.last_inbound_at, lastInboundMessageAt)}
        members={members}
        me={me}
        teamName={teamName}
        workspaceName={workspaceName}
        isAdmin={isAdmin}
        onSendMessage={(text, attachments) => onSend?.(text, attachments)}
        onNoteAdded={(note) => onNoteAdded?.(note)}
        onTemplateSent={() => {
          void thread.refresh();
          onCaseActivity?.();
        }}
      />
    </div>
  );
}
