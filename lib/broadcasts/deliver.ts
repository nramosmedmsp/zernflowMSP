// Envío de una difusión a un destinatario (lo llama el cron por cada
// broadcast_recipients). Texto: solo si la ventana de 24 h sigue abierta al
// momento de enviar (pudo cerrarse entre el envío y el cron). Plantilla:
// siempre, por el teléfono del contacto.

import type { Db } from "@/lib/cases/io";
import { parseBroadcastContent } from "./content";
import { loadDeliveryContext, sendTemplateToContact, sendTextToContact, type DeliveryResult } from "./delivery";

export async function deliverBroadcast(
  db: Db,
  params: { workspaceId: string; contactId: string; channelId: string; messageContent: unknown },
): Promise<DeliveryResult> {
  const content = parseBroadcastContent(params.messageContent);
  if (!content) return { ok: false, error: "La difusión no tiene un contenido válido" };

  const ctx = await loadDeliveryContext(db, {
    workspaceId: params.workspaceId,
    contactId: params.contactId,
    channelId: params.channelId,
  });
  if (content.kind === "text") return sendTextToContact(db, ctx, content.text, { checkWindow: true });
  return sendTemplateToContact(db, ctx, content);
}
