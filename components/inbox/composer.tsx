"use client";

// Caja de texto del chat: mensajes al cliente o notas internas (interruptor
// "Nota interna"), menciones con @, respuestas guardadas con / (en cualquier
// parte del texto o con el botón Respuestas), fotos y PDF (botón Adjuntar,
// arrastrar o pegar), borradores por chat, corrector con subrayado en la caja y
// revisión al enviar en un solo lugar (franja de abajo), cuenta regresiva de la ventana de 24 horas de WhatsApp y bloqueo
// fuera de ella con "Usar plantilla".

import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Check, FileText, Loader2, Lock, Paperclip, Send, StickyNote, Timer, Zap } from "lucide-react";
import { addCaseNote, type CaseView } from "@/lib/actions/cases";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/format";
import { firstName } from "@/lib/names";
import { readDraft, writeDraft, type DraftMode } from "@/lib/drafts";
import { replaceRange, slashQueryAt } from "@/lib/saved-replies";
import {
  applyReviewItems,
  buildReviewItems,
  safeReviewItems,
  underlineMarks,
  type ReviewItem,
  type TextRange,
} from "@/lib/review-items";
import { acceptFor, canSendAttachments } from "@/lib/chat-media";
import type { OutboxAttachment } from "@/lib/inbox-outbox";
import { useToast } from "@/components/ui/toast";
import { SavedReplyPicker, type PickedReply } from "@/components/composer/saved-reply-picker";
import { TemplatePicker } from "@/components/composer/template-picker";
import {
  filterMembers,
  mentionQueryAt,
  mentionedIds,
  outsideWhatsAppWindow,
  whatsAppWindowChip,
  type InboxConversation,
  type InboxMember,
} from "./inbox-model";
import type { CaseNote } from "./use-case-notes";
import { draftStorage, notifyDraftsChanged } from "./use-drafts";
import { useNow } from "./use-now";
import { AttachmentTray } from "./attachment-tray";
import { useAttachments } from "./use-attachments";
import { addOrRequestStoreWord, useSpellcheck } from "./spell/use-spellcheck";
import { HighlightedTextarea, type TextMark } from "./spell/highlighted-textarea";
import { ReviewStrip } from "./spell/review-strip";

const REVIEW_OFF_KEY = "zf:send-review:off:";

/** Alto de la caja de texto: unas 3 líneas al empezar, hasta unas 10. */
const COMPOSER_MIN_HEIGHT = 84;
const COMPOSER_MAX_HEIGHT = 240;

function reviewDisabled(userId: string): boolean {
  try {
    return window.localStorage.getItem(REVIEW_OFF_KEY + userId) === "1";
  } catch {
    return false;
  }
}

/** Cuánto se ve en verde lo recién corregido. */
const FIXED_FLASH_MS = 1500;

/**
 * Se monta una vez por chat (la vista usa key por conversación): el texto
 * arranca con el borrador guardado de ese chat.
 */
export function Composer({
  conversation,
  noteCase,
  lastInboundAt,
  members,
  me,
  teamName,
  workspaceName,
  onSendMessage,
  onNoteAdded,
  onTemplateSent,
  isAdmin = false,
}: {
  conversation: InboxConversation;
  /** Gestión a la que se agregan las notas (abierta o programada). */
  noteCase: CaseView | null;
  /** Último mensaje del cliente (gestión o mensajes de Zernio). */
  lastInboundAt: string | null;
  members: InboxMember[];
  me: { userId: string; name: string };
  teamName: string | null;
  workspaceName: string;
  onSendMessage: (text: string, attachments: OutboxAttachment[]) => void;
  onNoteAdded: (note: CaseNote) => void;
  onTemplateSent: () => void;
  /** Dueño o Administrador: agrega palabras al diccionario; los demás las piden. */
  isAdmin?: boolean;
}) {
  const scope = { userId: me.userId, workspaceId: conversation.workspace_id };
  const [texts, setTexts] = useState<Record<DraftMode, string>>(() => ({
    message: readDraft(draftStorage(), scope, conversation.id, "message"),
    note: readDraft(draftStorage(), scope, conversation.id, "note"),
  }));
  const [noteMode, setNoteMode] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
  const [replyDismissed, setReplyDismissed] = useState(false);
  /** Respuestas abiertas con el botón (con buscador propio, sin escribir "/"). */
  const [browsing, setBrowsing] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  /** Modo revisión: se intentó enviar con cosas por revisar; la franja pasa a ser el panel. */
  const [reviewMode, setReviewMode] = useState(false);
  /** Sube con cada Enter que no envía por haber cosas pendientes (sacude el panel). */
  const [nudge, setNudge] = useState(0);
  /** Lo recién corregido, resaltado un momento en la caja. */
  const [fixed, setFixed] = useState<TextRange[] | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** Lo que el asesor eligió ignorar en este mensaje (clave de cada ítem de la revisión). */
  const [ignoredWords, setIgnoredWords] = useState<ReadonlySet<string>>(() => new Set());
  /** Hay una revisión al enviar en curso (para no lanzar dos). */
  const checking = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const now = useNow();
  const toast = useToast();
  const showError = useCallback((message: string) => toast.error(message), [toast]);
  const attachments = useAttachments(conversation.platform, showError);
  const canAttach = canSendAttachments(conversation.platform);

  const mode: DraftMode = noteMode ? "note" : "message";
  const input = texts[mode];
  const contactId = conversation.contact_id;
  const contactName = conversation.contacts?.display_name ?? undefined;
  const canNote = !!noteCase && noteCase.permissions.canNote;
  const spell = useSpellcheck({ text: input, enabled: true, workspaceId: conversation.workspace_id, ignored: ignoredWords });
  // Una sola lista de cosas por revisar, en vivo: la caja la subraya y la franja la muestra.
  const items = buildReviewItems(input, spell.issues, ignoredWords);
  const marks: TextMark[] = [...underlineMarks(items), ...(fixed ?? []).map((r) => ({ ...r, tone: "fixed" as const }))];

  // Campos personalizados del contacto para las variables de las respuestas guardadas.
  useEffect(() => {
    let cancelled = false;
    void createClient()
      .from("contact_custom_fields")
      .select("value, custom_field_definitions(slug)")
      .eq("contact_id", contactId)
      .then(({ data }) => {
        if (cancelled) return;
        const fields: Record<string, string> = {};
        for (const row of data ?? []) {
          const def = row.custom_field_definitions as unknown as { slug: string } | null;
          if (def?.slug) fields[def.slug] = row.value;
        }
        setCustomFields(fields);
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  // Guarda el borrador un momento después de dejar de escribir, y al salir del
  // chat (el guardado pendiente no se pierde al cambiar de conversación).
  const { userId, workspaceId } = scope;
  const conversationId = conversation.id;
  const saveDraft = useCallback(
    (draftMode: DraftMode, text: string) => {
      writeDraft(draftStorage(), { userId, workspaceId }, conversationId, draftMode, text);
      notifyDraftsChanged();
    },
    [userId, workspaceId, conversationId],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft(mode, input);
      setDraftSaved(!!input.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [input, mode, saveDraft]);
  const latestTexts = useRef(texts);
  useEffect(() => {
    latestTexts.current = texts;
  }, [texts]);
  useEffect(
    () => () => {
      saveDraft("message", latestTexts.current.message);
      saveDraft("note", latestTexts.current.note);
    },
    [saveDraft],
  );

  // Lo recién corregido se apaga solo.
  useEffect(() => {
    if (!fixed) return;
    const timer = setTimeout(() => setFixed(null), FIXED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [fixed]);

  const blocked = !noteMode && now !== null && outsideWhatsAppWindow(conversation.platform, lastInboundAt, now);
  const windowChip = !noteMode && now !== null ? whatsAppWindowChip(conversation.platform, lastInboundAt, now) : null;
  const replyOpen = (browsing || (!!slash && !replyDismissed)) && (noteMode || !blocked);
  const mentionOptions = noteMode && mention ? filterMembers(members, mention.query) : [];
  const mentionOpen = mentionOptions.length > 0;

  function setInput(value: string) {
    setTexts((prev) => ({ ...prev, [mode]: value }));
    setDraftSaved(false);
    setFixed(null);
    // Caja vacía: se sale de la revisión y se olvida lo ignorado.
    if (!value.trim()) {
      setReviewMode(false);
      setIgnoredWords((prev) => (prev.size > 0 ? new Set() : prev));
    }
  }

  function updateInput(value: string, caret: number) {
    setInput(value);
    const nextSlash = slashQueryAt(value, caret);
    if (!nextSlash) setReplyDismissed(false);
    setSlash(nextSlash);
    setMention(noteMode ? mentionQueryAt(value, caret) : null);
    setMentionIndex(0);
  }

  function placeCaret(pos: number) {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function pickMention(member: InboxMember) {
    if (!mention) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? input.length;
    const { value, caret: pos } = replaceRange(input, mention.start, caret, `@${member.name} `);
    setInput(value);
    setPicked((prev) => new Map(prev).set(member.userId, member.name));
    setMention(null);
    placeCaret(pos);
  }

  /** Pega la respuesta en lugar de "/búsqueda", sin borrar el resto del texto. */
  function pickReply({ text, empty, attachment }: PickedReply) {
    // El archivo de la respuesta queda listo para salir (solo en mensajes).
    if (attachment && !noteMode) attachments.addReplyFile(attachment);
    const caret = textareaRef.current?.selectionStart ?? input.length;
    // Con el botón se pega donde estaba el cursor; con "/" reemplaza "/búsqueda".
    const start = browsing ? caret : (slash?.start ?? caret);
    const { value, caret: pos } = replaceRange(input, start, Math.max(start, caret), text);
    setInput(value);
    setSlash(null);
    setBrowsing(false);
    setReplyDismissed(false);
    setWarning(
      empty.length > 0
        ? `${empty.length === 1 ? "La variable" : "Las variables"} ${empty.join(", ")} no ${empty.length === 1 ? "tiene" : "tienen"} dato y se ${empty.length === 1 ? "quitó" : "quitaron"}. Revisa el texto antes de enviar.`
        : null,
    );
    placeCaret(pos);
  }

  /** Botón Respuestas: abre (o cierra) la lista completa con su buscador. */
  function toggleReplies() {
    setSlash(null);
    setBrowsing((v) => !v);
  }

  const closeReplies = useCallback(() => {
    if (browsing) {
      setBrowsing(false);
      textareaRef.current?.focus();
    } else {
      setReplyDismissed(true);
    }
  }, [browsing]);

  function sendMessage(text: string) {
    setTexts((prev) => ({ ...prev, message: "" }));
    saveDraft("message", "");
    setReviewMode(false);
    setFixed(null);
    setWarning(null);
    setSlash(null);
    setIgnoredWords(new Set());
    onSendMessage(text, attachments.take());
    textareaRef.current?.focus();
  }

  // ── Revisión (franja de abajo y subrayado de la caja) ──
  /** Corrige en la caja (una sugerencia u otra) y resalta lo cambiado un momento. */
  function applyItems(list: ReviewItem[], choice?: string) {
    const applied = applyReviewItems(input, list, choice);
    if (applied.changed.length === 0) return;
    setInput(applied.text);
    setFixed(applied.changed);
    placeCaret(applied.caret);
  }

  /** Administradores: la agrega. Los demás: la pide (y se ignora en este mensaje). */
  async function addToDictionary(item: ReviewItem) {
    const result = await addOrRequestStoreWord(conversation.workspace_id, item.from);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    if (result.status === "approved") {
      toast.success(`«${item.from}» se agregó al diccionario de la tienda.`);
      return;
    }
    setIgnoredWords((prev) => new Set(prev).add(item.key));
    toast.success(`Pediste agregar «${item.from}». Un administrador lo revisará.`);
  }

  function ignoreItem(item: ReviewItem) {
    setIgnoredWords((prev) => new Set(prev).add(item.key));
    textareaRef.current?.focus();
  }

  /** "Corregir las seguras y enviar": las dudosas quedan como están. */
  function sendWithSafeFixes() {
    if (!canSubmit || blocked) return;
    sendMessage(applyReviewItems(input, safeReviewItems(items)).text.trim());
  }

  /** "No volver a revisar en este equipo": se apaga la revisión y el mensaje sale como está. */
  function disableReview() {
    try {
      window.localStorage.setItem(REVIEW_OFF_KEY + me.userId, "1");
    } catch {
      // Sin almacenamiento: la revisión sigue activa.
    }
    toast.success("Listo: ya no revisaremos la ortografía al enviar en este equipo.");
    void handleSubmit({ asIs: true });
  }

  const hasFiles = !noteMode && attachments.items.length > 0;
  const canSubmit = (!!input.trim() || hasFiles) && !savingNote && !(hasFiles && attachments.preparing);

  /**
   * Enter y el botón Enviar hacen lo mismo. En un mensaje: sin nada por revisar
   * (o con la revisión apagada) sale; con algo, no sale y se pasa al modo
   * revisión. `asIs` (Ctrl+Enter, "Enviar así") envía siempre. Las notas
   * internas nunca se frenan.
   */
  async function handleSubmit({ asIs = false }: { asIs?: boolean } = {}) {
    const text = input.trim();
    if (!canSubmit) return;
    setError(null);
    setWarning(null);

    if (!noteMode) {
      if (blocked) return;
      // Sin texto (solo archivos) no hay nada que revisar.
      if (!text || asIs || reviewDisabled(me.userId)) {
        sendMessage(text);
        return;
      }
      if (checking.current) return;
      checking.current = true;
      try {
        const found = buildReviewItems(input, await spell.checkNow(input), ignoredWords);
        // Si siguió escribiendo mientras se revisaba, no sale lo anterior.
        if (latestTexts.current.message !== input) return;
        if (found.length > 0) {
          if (reviewMode) setNudge((n) => n + 1);
          else setReviewMode(true);
          return;
        }
      } finally {
        checking.current = false;
      }
      sendMessage(text);
      return;
    }

    if (!noteCase || savingNote || !text) return;
    setSavingNote(true);
    try {
      const mentions = mentionedIds(text, picked, members.filter((m) => m.userId !== me.userId));
      const result = await addCaseNote(noteCase.id, text, mentions, conversation.id);
      if ("error" in result) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Nota guardada");
      onNoteAdded({
        id: result.noteId,
        workspace_id: conversation.workspace_id,
        case_id: noteCase.id,
        contact_id: contactId,
        conversation_id: conversation.id,
        author_id: me.userId,
        body: text,
        mentions,
        created_at: new Date().toISOString(),
      });
      if (result.notNotified.length > 0) {
        const names = result.notNotified.map((id) => members.find((m) => m.userId === id)?.name ?? "una persona");
        setWarning(
          `${names.join(", ")} ${names.length === 1 ? "no puede" : "no pueden"} ver este contacto, así que no se ${names.length === 1 ? "le notificó" : "les notificó"}.`,
        );
      }
      setTexts((prev) => ({ ...prev, note: "" }));
      saveDraft("note", "");
      setPicked(new Map());
    } catch {
      setError("No se pudo guardar la nota. Inténtalo de nuevo.");
      toast.error("No se pudo guardar la nota. Inténtalo de nuevo.");
    } finally {
      setSavingNote(false);
    }
  }

  const acceptsFiles = canAttach && !noteMode;

  function addFiles(list: FileList | File[] | null | undefined) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (!acceptsFiles) {
      toast.error(noteMode ? "Las notas internas no llevan archivos." : "Este canal no permite enviar archivos.");
      return;
    }
    void attachments.add(files);
  }

  function hasDraggedFiles(e: DragEvent) {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter que confirma una tilde o un carácter compuesto (teclados con teclas
    // muertas o IME): no envía.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (replyOpen && e.key === "Escape") {
      e.preventDefault();
      setReplyDismissed(true);
      return;
    }
    if (e.key === "Escape" && reviewMode) {
      e.preventDefault();
      setReviewMode(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Con el buscador abierto, Enter elige una respuesta (lo maneja el buscador).
      if (replyOpen) return;
      // Ctrl+Enter / Cmd+Enter: enviar así, sin revisar.
      void handleSubmit({ asIs: e.ctrlKey || e.metaKey });
    }
  }

  if (blocked) {
    const who = firstName(contactName) || "El cliente";
    return (
      <div className="border-t border-border p-4">
        <div className="mx-auto max-w-2xl space-y-2">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <Lock className="h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>
                {lastInboundAt ? (
                  <>
                    {who} escribió por última vez el{" "}
                    <span className="font-semibold">
                      {formatDate(lastInboundAt)} a las {formatTime(lastInboundAt)}
                    </span>
                    . Pasadas 24 horas, WhatsApp solo permite enviar una plantilla aprobada.
                  </>
                ) : (
                  "Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite enviar una plantilla aprobada."
                )}
              </p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                Tus respuestas guardadas vuelven a funcionar cuando el cliente te escriba.
              </p>
            </div>
            <button
              onClick={() => setTemplateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <FileText className="h-4 w-4" />
              Usar plantilla
            </button>
          </div>
          {canNote && (
            <button
              onClick={() => setNoteMode(true)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <StickyNote className="h-3.5 w-3.5" />
              Escribir una nota interna
              <span className="text-muted-foreground/70">(en las notas también funciona /)</span>
            </button>
          )}
        </div>
        <TemplatePicker
          conversationId={conversation.id}
          open={templateOpen}
          onClose={() => setTemplateOpen(false)}
          onSent={() => {
            setTemplateOpen(false);
            onTemplateSent();
          }}
          contactName={contactName}
        />
      </div>
    );
  }

  return (
    <div
      className={cn("relative border-t border-border p-4", noteMode && "bg-amber-50/60 dark:bg-amber-950/20")}
      onDragOver={(e) => {
        if (!acceptsFiles || !hasDraggedFiles(e)) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!acceptsFiles || !hasDraggedFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-1 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary">
          Suelta aquí la foto o el PDF
        </div>
      )}
      <div className="mx-auto max-w-2xl space-y-2">
        <div className="flex items-center justify-between">
          <label
            className={cn(
              "inline-flex cursor-pointer items-center gap-2 text-xs",
              !canNote && "cursor-not-allowed opacity-50",
            )}
            title={canNote ? undefined : "Abre una gestión para escribir notas internas"}
          >
            <button
              type="button"
              role="switch"
              aria-checked={noteMode}
              disabled={!canNote}
              onClick={() => {
                setNoteMode((v) => !v);
                setMention(null);
                setSlash(null);
                setBrowsing(false);
                setReviewMode(false);
                setError(null);
                setWarning(null);
                textareaRef.current?.focus();
              }}
              className={cn(
                "relative h-4 w-7 rounded-full transition-colors",
                noteMode ? "bg-amber-500" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
                  noteMode ? "left-3.5" : "left-0.5",
                )}
              />
            </button>
            <span className={cn("font-medium", noteMode && "text-amber-800 dark:text-amber-300")}>Nota interna</span>
          </label>
          {noteMode ? (
            <span className="text-[11px] text-amber-800 dark:text-amber-300">
              Solo la ve tu equipo. Usa @ para mencionar.
            </span>
          ) : (
            windowChip && (
              <span
                title="Tiempo para responder sin plantilla: WhatsApp permite mensajes libres hasta 24 horas después del último mensaje del cliente."
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  windowChip.urgent
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Timer className="h-3 w-3" />
                {windowChip.text}
              </span>
            )
          )}
        </div>

        {!noteMode && (
          <AttachmentTray items={attachments.items} preparing={attachments.preparing} onRemove={attachments.remove} />
        )}

        <div className="relative flex items-end gap-2">
          <div className="relative flex-1">
            {replyOpen && (
              <SavedReplyPicker
                open={replyOpen}
                query={slash?.query ?? ""}
                onSelect={pickReply}
                onClose={closeReplies}
                searchable={browsing}
                context={{
                  contactName,
                  agentName: me.name,
                  teamName: teamName ?? undefined,
                  workspaceName,
                  customFields,
                  caseTypeId: noteCase?.caseTypeId ?? null,
                }}
              />
            )}
            {mentionOpen && (
              <div className="animate-pop-in absolute bottom-full left-0 z-30 mb-1 w-64 rounded-lg border border-border bg-card p-1 shadow-lg">
                {mentionOptions.map((m, i) => (
                  <button
                    key={m.userId}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickMention(m);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs",
                      i === mentionIndex ? "bg-accent" : "hover:bg-accent/60",
                    )}
                  >
                    <span className="truncate">{m.name}</span>
                    {m.availability === "away" && <span className="text-[10px] text-muted-foreground">Ausente</span>}
                  </button>
                ))}
              </div>
            )}
            <HighlightedTextarea
              ref={textareaRef}
              value={input}
              marks={marks}
              minHeight={COMPOSER_MIN_HEIGHT}
              maxHeight={COMPOSER_MAX_HEIGHT}
              onChange={(e) => updateInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                if (e.clipboardData.files.length === 0) return;
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }}
              onClick={(e) => {
                const caret = e.currentTarget.selectionStart ?? input.length;
                setSlash(slashQueryAt(input, caret));
                if (noteMode) setMention(mentionQueryAt(input, caret));
              }}
              placeholder={
                noteMode ? "Escribe una nota interna..." : hasFiles ? "Agrega un comentario (opcional)..." : "Escribe un mensaje..."
              }
              rows={3}
              spellCheck={false}
              lang="es-PE"
              autoCapitalize="sentences"
              autoCorrect="on"
              className={cn(
                "w-full resize-none rounded-lg border px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2",
                noteMode
                  ? "border-amber-300 focus:ring-amber-400 dark:border-amber-800"
                  : "border-input focus:ring-ring",
              )}
            />
          </div>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            aria-label={noteMode ? "Guardar nota interna" : "Enviar mensaje"}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
              canSubmit
                ? noteMode
                  ? "bg-amber-500 text-white hover:bg-amber-600"
                  : "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground",
            )}
          >
            {savingNote ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : noteMode ? (
              <StickyNote className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <ReviewStrip
          items={items}
          reviewing={reviewMode && !noteMode}
          nudge={nudge}
          canAddWords={isAdmin}
          onPick={(item, word) => applyItems([item], word)}
          onApplySafe={() => applyItems(safeReviewItems(items))}
          onAdd={(item) => void addToDictionary(item)}
          onIgnore={ignoreItem}
          onSendAsIs={() => void handleSubmit({ asIs: true })}
          onApplySafeAndSend={sendWithSafeFixes}
          onDisable={disableReview}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleReplies}
              data-replies-toggle
              aria-expanded={browsing}
              title="Ver y elegir respuestas guardadas (también escribiendo /)"
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
                browsing && "bg-accent text-foreground",
              )}
            >
              <Zap className="h-3.5 w-3.5" />
              Respuestas
            </button>
            {!noteMode && (
              <>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canAttach}
                  title={
                    canAttach
                      ? "Adjuntar foto o PDF (también puedes arrastrarlo o pegarlo con Ctrl+V)"
                      : "Este canal no permite enviar archivos"
                  }
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Adjuntar
                </button>
                {canAttach && (
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={acceptFor(conversation.platform)}
                    className="hidden"
                    onChange={(e) => {
                      addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                )}
              </>
            )}
          </div>
          {draftSaved && input.trim() && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Check className="h-3 w-3" />
              Borrador guardado
            </span>
          )}
        </div>
        {warning && <p className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
