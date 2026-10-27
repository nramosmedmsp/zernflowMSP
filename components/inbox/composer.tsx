"use client";

// Caja de texto del chat: mensajes al cliente o notas internas (interruptor
// "Nota interna"), menciones con @, respuestas guardadas con / (en cualquier
// parte del texto o con el botón Respuestas), fotos y PDF (botón Adjuntar,
// arrastrar o pegar), borradores por chat, corrector del navegador y revisión
// al enviar, cuenta regresiva de la ventana de 24 horas de WhatsApp y bloqueo
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
import { applySuggestions, reviewOutgoing, type Suggestion } from "@/lib/send-review";
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
import { SendReviewPopover } from "./send-review-popover";
import { AttachmentTray } from "./attachment-tray";
import { useAttachments } from "./use-attachments";

const REVIEW_OFF_KEY = "zf:send-review:off:";

function reviewDisabled(userId: string): boolean {
  try {
    return window.localStorage.getItem(REVIEW_OFF_KEY + userId) === "1";
  } catch {
    return false;
  }
}

interface Review {
  text: string;
  suggestions: Suggestion[];
  unresolved: string[];
  chosen: Set<string>;
}

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
  const [review, setReview] = useState<Review | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [dragging, setDragging] = useState(false);
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

  // El tamaño de la caja sigue al texto (también con el borrador inicial).
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, []);
  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  const blocked = !noteMode && now !== null && outsideWhatsAppWindow(conversation.platform, lastInboundAt, now);
  const windowChip = !noteMode && now !== null ? whatsAppWindowChip(conversation.platform, lastInboundAt, now) : null;
  const replyOpen = (browsing || (!!slash && !replyDismissed)) && !review && (noteMode || !blocked);
  const mentionOptions = noteMode && mention ? filterMembers(members, mention.query) : [];
  const mentionOpen = mentionOptions.length > 0;

  function setInput(value: string) {
    setTexts((prev) => ({ ...prev, [mode]: value }));
    setDraftSaved(false);
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
    setReview(null);
    setWarning(null);
    setSlash(null);
    onSendMessage(text, attachments.take());
    textareaRef.current?.focus();
  }

  const hasFiles = !noteMode && attachments.items.length > 0;
  const canSubmit = (!!input.trim() || hasFiles) && !savingNote && !(hasFiles && attachments.preparing);

  async function handleSubmit() {
    const text = input.trim();
    if (!canSubmit) return;
    setError(null);
    setWarning(null);

    if (!noteMode) {
      if (blocked) return;
      // Revisión al enviar: solo aparece si encuentra algo (lib/send-review.ts).
      if (text && !reviewDisabled(me.userId)) {
        const result = reviewOutgoing(text);
        if (result.suggestions.length > 0 || result.unresolved.length > 0) {
          setReview({ text, ...result, chosen: new Set(result.suggestions.map((s) => s.id)) });
          return;
        }
      }
      sendMessage(text);
      return;
    }

    if (!noteCase || savingNote || !text) return;
    setSavingNote(true);
    try {
      const mentions = mentionedIds(text, picked);
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Con el buscador abierto, Enter elige una respuesta (lo maneja el buscador).
      if (replyOpen) return;
      void handleSubmit();
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
                setReview(null);
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
            {review && (
              <SendReviewPopover
                suggestions={review.suggestions}
                unresolved={review.unresolved}
                chosen={review.chosen}
                onToggle={(id) =>
                  setReview((r) => {
                    if (!r) return r;
                    const chosen = new Set(r.chosen);
                    if (chosen.has(id)) chosen.delete(id);
                    else chosen.add(id);
                    return { ...r, chosen };
                  })
                }
                onApply={() => sendMessage(applySuggestions(review.text, review.suggestions.filter((s) => review.chosen.has(s.id))))}
                onSendAsIs={() => sendMessage(review.text)}
                onCancel={() => {
                  setReview(null);
                  textareaRef.current?.focus();
                }}
                onDisable={() => {
                  try {
                    window.localStorage.setItem(REVIEW_OFF_KEY + me.userId, "1");
                  } catch {
                    // Sin almacenamiento: la revisión sigue activa.
                  }
                  sendMessage(review.text);
                  toast.success("Listo: ya no revisaremos la ortografía al enviar en este equipo.");
                }}
              />
            )}
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
            <textarea
              ref={textareaRef}
              value={input}
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
              rows={1}
              spellCheck
              lang="es-PE"
              autoCapitalize="sentences"
              autoCorrect="on"
              className={cn(
                "w-full resize-none rounded-lg border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2",
                noteMode
                  ? "border-amber-300 focus:ring-amber-400 dark:border-amber-800"
                  : "border-input focus:ring-ring",
              )}
              style={{ maxHeight: 150 }}
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
