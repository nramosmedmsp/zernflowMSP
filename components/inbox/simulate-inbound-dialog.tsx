"use client";

// "Simular mensaje del cliente" (solo administradores, solo canales de
// prueba): pide el texto (y, si se quiere, una foto, PDF o audio) y llama a la
// acción de servidor, que guarda el mensaje entrante y corre lo mismo que el
// webhook real.

import { useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { createDemoInboundUploadUrl, simulateInboundMessage, type SimulatedAttachment } from "@/lib/actions/demo";
import { createClient } from "@/lib/supabase/client";
import { CHAT_MEDIA_BUCKET, baseMime, formatFileSize } from "@/lib/chat-media";
import { ErrorText, Field, Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "./ui";

export function SimulateInboundDialog({
  open,
  conversationId,
  contactName,
  onClose,
  onSent,
}: {
  open: boolean;
  conversationId: string;
  contactName: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ready = !!text.trim() || !!file;

  async function upload(picked: File): Promise<SimulatedAttachment | { error: string }> {
    const mime = baseMime(picked.type);
    const target = await createDemoInboundUploadUrl(conversationId, { mime, size: picked.size });
    if ("error" in target) return target;
    const { error: uploadError } = await createClient()
      .storage.from(CHAT_MEDIA_BUCKET)
      .uploadToSignedUrl(target.path, target.token, picked, { contentType: mime });
    if (uploadError) return { error: "No se pudo subir el archivo." };
    return { path: target.path, name: picked.name || "archivo" };
  }

  async function submit() {
    if (sending || !ready) return;
    setSending(true);
    setError(null);
    try {
      let attachment: SimulatedAttachment | null = null;
      if (file) {
        const uploaded = await upload(file);
        if ("error" in uploaded) {
          setError(uploaded.error);
          return;
        }
        attachment = uploaded;
      }
      const res = await simulateInboundMessage(conversationId, text, attachment);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setText("");
      setFile(null);
      onSent();
      onClose();
    } catch {
      setError("No se pudo simular el mensaje. Revisa tu conexión.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Simular mensaje del cliente"
      onClose={sending ? () => {} : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={sending} className={secondaryButtonClass}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={sending || !ready}
            className={primaryButtonClass}
          >
            {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {sending ? "Simulando..." : "Simular mensaje"}
          </button>
        </>
      }
    >
      <Field
        label={`Lo que escribe ${contactName?.trim() || "el cliente"}`}
        hint="Se guarda como mensaje entrante y corre lo mismo que un mensaje real: abre o retoma la gestión, reparte, inicia la espera y activa los flujos."
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={1000}
          autoFocus
          placeholder="Hola, ¿tienen proteína Whey sabor vainilla?"
          className={inputClass}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        {file ? (
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-medium">{file.name}</span>
            <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
            <button
              type="button"
              onClick={() => setFile(null)}
              aria-label="Quitar archivo"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} className={secondaryButtonClass}>
            <Paperclip className="h-3.5 w-3.5" />
            Adjuntar foto, PDF o audio
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,audio/*"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
