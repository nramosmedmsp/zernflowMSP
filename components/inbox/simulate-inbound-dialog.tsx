"use client";

// "Simular mensaje del cliente" (solo administradores, solo canales de
// prueba): pide el texto y llama a la acción de servidor, que guarda el
// mensaje entrante y corre lo mismo que el webhook real.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { simulateInboundMessage } from "@/lib/actions/demo";
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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (sending || !text.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await simulateInboundMessage(conversationId, text);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setText("");
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
            disabled={sending || !text.trim()}
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
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
