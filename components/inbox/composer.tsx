"use client";

// Caja de texto del chat: mensajes al cliente o notas internas (interruptor
// "Nota interna"), menciones con @, respuestas guardadas con / y bloqueo de
// WhatsApp fuera de la ventana de 24 horas con "Usar plantilla".

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FileText, Loader2, Lock, Send, StickyNote } from "lucide-react";
import { addCaseNote, type CaseView } from "@/lib/actions/cases";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { SavedReplyPicker } from "@/components/composer/saved-reply-picker";
import { TemplatePicker } from "@/components/composer/template-picker";
import {
  filterMembers,
  mentionQueryAt,
  mentionedIds,
  outsideWhatsAppWindow,
  type InboxConversation,
  type InboxMember,
} from "./inbox-model";
import type { CaseNote } from "./use-case-notes";
import { useNow } from "./use-now";

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
  onSendMessage: (text: string) => void;
  onNoteAdded: (note: CaseNote) => void;
  onTemplateSent: () => void;
}) {
  const [input, setInput] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [replyDismissed, setReplyDismissed] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const now = useNow();

  const contactId = conversation.contact_id;
  const contactName = conversation.contacts?.display_name ?? undefined;
  const canNote = !!noteCase && noteCase.permissions.canNote;

  // Al cambiar de chat se limpia la caja.
  useEffect(() => {
    setInput("");
    setNoteMode(false);
    setError(null);
    setWarning(null);
    setPicked(new Map());
    setMention(null);
    setTemplateOpen(false);
  }, [conversation.id]);

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

  const blocked = !noteMode && now !== null && outsideWhatsAppWindow(conversation.platform, lastInboundAt, now);
  const replyOpen = !noteMode && !blocked && input.startsWith("/") && !input.includes("\n") && !replyDismissed;
  const mentionOptions = noteMode && mention ? filterMembers(members, mention.query) : [];
  const mentionOpen = mentionOptions.length > 0;

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }

  function updateInput(value: string, caret: number) {
    setInput(value);
    if (!value.startsWith("/")) setReplyDismissed(false);
    setMention(noteMode ? mentionQueryAt(value, caret) : null);
    setMentionIndex(0);
    requestAnimationFrame(autoResize);
  }

  function pickMention(member: InboxMember) {
    if (!mention) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? input.length;
    const before = input.slice(0, mention.start);
    const after = input.slice(caret);
    const inserted = `@${member.name} `;
    const value = before + inserted + after;
    setInput(value);
    setPicked((prev) => new Map(prev).set(member.userId, member.name));
    setMention(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = before.length + inserted.length;
      el.setSelectionRange(pos, pos);
      autoResize();
    });
  }

  async function handleSubmit() {
    const text = input.trim();
    if (!text) return;
    setError(null);
    setWarning(null);

    if (!noteMode) {
      if (blocked) return;
      setInput("");
      requestAnimationFrame(autoResize);
      onSendMessage(text);
      return;
    }

    if (!noteCase || savingNote) return;
    setSavingNote(true);
    try {
      const mentions = mentionedIds(text, picked);
      const result = await addCaseNote(noteCase.id, text, mentions, conversation.id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
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
      setInput("");
      setPicked(new Map());
      requestAnimationFrame(autoResize);
    } catch {
      setError("No se pudo guardar la nota. Inténtalo de nuevo.");
    } finally {
      setSavingNote(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
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
    if (replyOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setReplyDismissed(true);
        return;
      }
      // Con el buscador abierto, Enter elige una respuesta (lo maneja el buscador), no envía "/...".
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  if (blocked) {
    return (
      <div className="border-t border-border p-4">
        <div className="mx-auto max-w-2xl space-y-2">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <Lock className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">
              Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite enviar una
              plantilla aprobada.
            </p>
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
    <div className={cn("border-t border-border p-4", noteMode && "bg-amber-50/60 dark:bg-amber-950/20")}>
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
            <span className="text-[11px] text-muted-foreground">Escribe / para usar una respuesta guardada</span>
          )}
        </div>

        <div className="relative flex items-end gap-2">
          <div className="relative flex-1">
            {replyOpen && (
              <SavedReplyPicker
                open={replyOpen}
                query={input.slice(1)}
                onSelect={(text) => {
                  setInput(text);
                  setReplyDismissed(false);
                  requestAnimationFrame(() => {
                    const el = textareaRef.current;
                    if (!el) return;
                    el.focus();
                    el.setSelectionRange(text.length, text.length);
                    autoResize();
                  });
                }}
                onClose={() => setReplyDismissed(true)}
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
              <div className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-lg border border-border bg-card p-1 shadow-lg">
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
              onClick={(e) => noteMode && setMention(mentionQueryAt(input, e.currentTarget.selectionStart ?? input.length))}
              placeholder={noteMode ? "Escribe una nota interna..." : "Escribe un mensaje..."}
              rows={1}
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
            disabled={!input.trim() || savingNote}
            aria-label={noteMode ? "Guardar nota interna" : "Enviar mensaje"}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
              input.trim() && !savingNote
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
        {warning && <p className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
