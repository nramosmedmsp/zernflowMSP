// Envíos automáticos del motor de gestiones (respuesta fuera de horario y
// plantilla de las proactivas) por Zernio. Se inyecta como dependencia para
// probar el motor sin red.

import { getLateApiKey } from "@/lib/workspace-secrets";
import { zernioErrorMessage, zernioFailed } from "@/lib/zernio-error";
import type { Db } from "./io";

export type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string };

export interface SendTextInput {
  workspaceId: string;
  /** conversations.late_conversation_id */
  lateConversationId: string;
  /** channels.late_account_id */
  lateAccountId: string;
  text: string;
}

export interface SendTemplateInput {
  workspaceId: string;
  lateAccountId: string;
  /** Solo dígitos, con código de país. */
  phone: string;
  templateName: string;
  language: string;
  params: string[];
}

export interface CaseMessenger {
  /** Texto libre en una conversación existente (dentro de la ventana de 24 h). */
  sendText(input: SendTextInput): Promise<SendResult>;
  /**
   * Plantilla de WhatsApp hacia un teléfono: llega aunque el contacto nunca
   * haya escrito (ver app/api/v1/templates/send/route.ts).
   */
  sendTemplate(input: SendTemplateInput): Promise<SendResult>;
}

const NO_KEY = "La clave de API de Zernio no está configurada.";

function messageIdOf(data: unknown): string | null {
  const inner = (data as { data?: { messageId?: unknown } } | null | undefined)?.data;
  return typeof inner?.messageId === "string" ? inner.messageId : null;
}

/** Envíos reales por Zernio con la clave del espacio (cliente de servicio). */
export function zernioMessenger(db: Db): CaseMessenger {
  async function client(workspaceId: string) {
    const apiKey = await getLateApiKey(workspaceId, db);
    if (!apiKey) return null;
    const { createZernioClient } = await import("@/lib/zernio-client");
    return createZernioClient(apiKey);
  }

  return {
    async sendText(input) {
      try {
        const zernio = await client(input.workspaceId);
        if (!zernio) return { ok: false, error: NO_KEY };
        const res = await zernio.messages.sendInboxMessage({
          path: { conversationId: input.lateConversationId },
          body: { accountId: input.lateAccountId, message: input.text },
        });
        if (zernioFailed(res) || !res.data) {
          return { ok: false, error: zernioErrorMessage(res, "Zernio rechazó el mensaje") };
        }
        return { ok: true, messageId: messageIdOf(res.data) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async sendTemplate(input) {
      try {
        const zernio = await client(input.workspaceId);
        if (!zernio) return { ok: false, error: NO_KEY };
        const res = await zernio.messages.createInboxConversation({
          body: {
            accountId: input.lateAccountId,
            participantId: input.phone,
            templateName: input.templateName,
            templateLanguage: input.language,
            ...(input.params.length > 0 ? { templateParams: input.params } : {}),
          },
        });
        if (zernioFailed(res)) {
          return { ok: false, error: zernioErrorMessage(res, "No se pudo enviar la plantilla") };
        }
        return { ok: true, messageId: messageIdOf(res.data) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
