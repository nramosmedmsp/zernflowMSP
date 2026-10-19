"use client";

// Teléfono del cliente: la conversación tal como la vería en el canal elegido.

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ExternalLink, FileText, Paperclip, Send, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatTime } from "@/lib/format";
import { LAB_CHANNEL_LABELS, type ClientInput, type LabChannel, type LabMessage, type LabTrace } from "@/lib/flow-lab/types";
import { inputClass } from "@/components/inbox/ui";
import { buildThread } from "./lab-model";

const CHANNEL_HEADER: Record<LabChannel, string> = {
  whatsapp: "bg-emerald-700 text-white",
  instagram: "bg-gradient-to-r from-fuchsia-600 to-orange-500 text-white",
  facebook: "bg-blue-600 text-white",
};

const BOT_BUBBLE: Record<LabChannel, string> = {
  whatsapp: "bg-white text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50",
  instagram: "bg-muted text-foreground",
  facebook: "bg-muted text-foreground",
};

const CLIENT_BUBBLE: Record<LabChannel, string> = {
  whatsapp: "bg-emerald-200 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-50",
  instagram: "bg-violet-600 text-white",
  facebook: "bg-blue-600 text-white",
};

const OPTION_BUTTON: Record<LabChannel, string> = {
  whatsapp: "border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40",
  instagram: "border-violet-500/40 text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40",
  facebook: "border-blue-500/40 text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40",
};

function Bubble({ message, channel, isLast, onPress, disabled }: { message: LabMessage; channel: LabChannel; isLast: boolean; onPress: (input: ClientInput) => void; disabled: boolean }) {
  const fromClient = message.author === "client";
  const optionClass = OPTION_BUTTON[channel];
  return (
    <div className={cn("flex gap-1.5", fromClient ? "justify-end" : "justify-start")}>
      {!fromClient && (
        <div className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10" title={message.author === "bot" ? "Bot" : "Asesor"}>
          {message.author === "bot" ? <Bot className="h-3.5 w-3.5 text-primary" /> : <User className="h-3.5 w-3.5 text-primary" />}
        </div>
      )}
      <div className="max-w-[82%] space-y-1">
        <div className={cn("rounded-2xl px-3 py-1.5 text-sm shadow-sm", fromClient ? cn("rounded-tr-md", CLIENT_BUBBLE[channel]) : cn("rounded-tl-md", BOT_BUBBLE[channel]), message.failed && "ring-1 ring-destructive")}>
          {message.kind === "template" && (
            <div className="mb-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              <FileText className="h-3 w-3" />
              Plantilla de WhatsApp{message.template ? ` · ${message.template.name}` : ""}
            </div>
          )}
          {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
          {message.imageUrl && (
            <p className="mt-1 flex items-center gap-1 text-xs opacity-80">
              <Paperclip className="h-3 w-3" />
              Imagen adjunta
            </p>
          )}
          {message.attachment && (
            <p className="mt-1 flex items-center gap-1 text-xs opacity-80">
              <Paperclip className="h-3 w-3" />
              Archivo adjunto ({message.attachment.type})
            </p>
          )}
          {message.carousel && message.carousel.length > 0 && (
            <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
              {message.carousel.map((card, i) => (
                <div key={i} className="w-40 flex-shrink-0 rounded-lg border border-border bg-background p-2 text-foreground">
                  <p className="text-xs font-semibold">{card.title}</p>
                  {card.subtitle && <p className="text-[11px] text-muted-foreground">{card.subtitle}</p>}
                  <div className="mt-1.5 space-y-1">
                    {card.buttons?.map((b, j) => (
                      <button
                        key={j}
                        type="button"
                        disabled={disabled || b.type === "url"}
                        onClick={() => b.payload && onPress({ kind: "button", payload: b.payload, title: b.title })}
                        className={cn("flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-60", optionClass)}
                      >
                        {b.type === "url" && <ExternalLink className="h-3 w-3" />}
                        {b.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {message.buttons && message.buttons.length > 0 && (
          <div className="space-y-1">
            {message.buttons.map((b, i) => (
              <button
                key={i}
                type="button"
                disabled={disabled || b.type === "url"}
                title={b.type === "url" ? `Abre ${b.url ?? "un enlace"}` : "Pulsar como cliente"}
                onClick={() => b.payload !== undefined && onPress({ kind: "button", payload: b.payload, title: b.title })}
                className={cn("flex w-full items-center justify-center gap-1 rounded-xl border bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-70", optionClass)}
              >
                {b.type === "url" && <ExternalLink className="h-3.5 w-3.5" />}
                {b.title}
              </button>
            ))}
          </div>
        )}
        {isLast && message.quickReplies && message.quickReplies.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {message.quickReplies.map((q, i) => (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onClick={() => onPress({ kind: "button", payload: q.payload, title: q.title, buttonType: "quick_reply" })}
                className={cn("rounded-full border bg-background px-3 py-1 text-xs font-medium disabled:opacity-60", optionClass)}
              >
                {q.title}
              </button>
            ))}
          </div>
        )}
        {message.adaptation && message.adaptation.length > 0 && <p className="text-[10px] italic text-muted-foreground">Adaptado a {LAB_CHANNEL_LABELS[channel]}: {message.adaptation.join(" ")}</p>}
        {message.failed && <p className="text-[10px] font-medium text-destructive">No se pudo enviar: {message.failed}</p>}
        <p className={cn("flex items-center gap-1 text-[10px] text-muted-foreground", fromClient ? "justify-end" : "justify-start")}>
          {message.author === "bot" && <span>{message.flowName ?? "Bot"} ·</span>}
          {message.author === "agent" && <span>{message.authorName ?? "Asesor"} ·</span>}
          <span>{formatTime(message.at)}</span>
        </p>
      </div>
    </div>
  );
}

export function Phone({
  messages,
  traces,
  channel,
  clock,
  contactName,
  botPaused,
  busy,
  onSend,
}: {
  messages: LabMessage[];
  traces: LabTrace[];
  channel: LabChannel;
  clock: string;
  contactName: string | null;
  botPaused: boolean;
  busy: boolean;
  onSend: (input: ClientInput) => void;
}) {
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const thread = useMemo(() => buildThread(messages, traces), [messages, traces]);
  const lastMessageId = messages[messages.length - 1]?.id;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, lastMessageId]);

  function submit() {
    const value = text.trim();
    if (!value) return;
    onSend({ kind: "text", text: value });
    setText("");
  }

  return (
    <div className="mx-auto flex h-[560px] w-full max-w-[400px] flex-col overflow-hidden rounded-[2rem] border-4 border-neutral-800 bg-card shadow-lg dark:border-neutral-600">
      <div className={cn("px-4 py-2.5", CHANNEL_HEADER[channel])}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{contactName ?? "Cliente"}</p>
            <p className="text-[11px] opacity-90">{LAB_CHANNEL_LABELS[channel]} · vista del cliente</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide opacity-80">Reloj simulado</p>
            <p className="text-xs font-semibold tabular-nums">{formatDateTime(clock)}</p>
          </div>
        </div>
        {botPaused && <p className="mt-1 rounded bg-black/20 px-2 py-0.5 text-[11px]">Bot en pausa: un asesor atiende esta conversación</p>}
      </div>

      <div ref={scroller} className={cn("flex-1 space-y-2 overflow-y-auto px-3 py-3", channel === "whatsapp" ? "bg-emerald-50/60 dark:bg-neutral-900" : "bg-background")}>
        {thread.length === 0 && <p className="mt-10 text-center text-xs text-muted-foreground">Escribe como cliente o pulsa un botón para empezar la prueba.</p>}
        {thread.map((item) =>
          item.kind === "separator" ? (
            <div key={item.id} className="flex justify-center">
              <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] text-muted-foreground">{item.label}</span>
            </div>
          ) : (
            <Bubble key={item.message.id} message={item.message} channel={channel} isLast={item.message.id === lastMessageId} onPress={onSend} disabled={busy} />
          ),
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t border-border bg-card p-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe como cliente…" aria-label="Mensaje del cliente" className={cn(inputClass, "rounded-full")} />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Enviar como cliente" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
