// Envío de una difusión a un destinatario (lo llama el cron por cada
// broadcast_recipients). Texto: solo si la ventana de 24 h sigue abierta al
// momento de enviar (pudo cerrarse entre el envío y el cron). Plantilla:
// siempre, por el teléfono del contacto.
//
// PRIV-05: antes de CADA envío se vuelve a mirar el consentimiento. Los
// destinatarios se fijan al lanzar la difusión; si entre tanto el cliente se dio
// de baja (o se borraron sus datos, o nunca aceptó), no sale nada y el
// destinatario queda "omitido" con el motivo.

import type { Db } from "@/lib/cases/io";
import { marketingDecision } from "@/lib/consent";
import { parseBroadcastContent } from "./content";
import { loadDeliveryContext, sendTemplateToContact, sendTextToContact, type DeliveryResult } from "./delivery";

export async function deliverBroadcast(
  db: Db,
  params: { workspaceId: string; contactId: string; channelId: string; messageContent: unknown },
): Promise<DeliveryResult> {
  const content = parseBroadcastContent(params.messageContent);
  if (!content) return { ok: false, error: "La difusión no tiene un contenido válido" };

  // Consentimiento al momento de enviar (no el de cuando se lanzó la difusión).
  const { data: contact, error: contactError } = await db
    .from("contacts")
    .select("marketing_status, erased_at")
    .eq("id", params.contactId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  // Si no se puede comprobar, no se envía (queda como fallido, con el motivo).
  if (contactError) {
    console.error("[broadcasts/deliver] consentimiento:", contactError.message);
    return { ok: false, error: "No se pudo comprobar el consentimiento del contacto. No se envió nada." };
  }
  const decision = contact && !contact.erased_at ? marketingDecision(contact) : null;
  if (!decision || !decision.ok) {
    const reason = !decision ? "unknown" : decision.reason;
    return {
      ok: false,
      skipped: true,
      error:
        reason === "opted_out"
          ? "Omitido: el cliente se dio de baja de la publicidad."
          : "Omitido: el cliente no tiene consentimiento de publicidad registrado.",
    };
  }

  const ctx = await loadDeliveryContext(db, {
    workspaceId: params.workspaceId,
    contactId: params.contactId,
    channelId: params.channelId,
  });
  if (content.kind === "text") return sendTextToContact(db, ctx, content.text, { checkWindow: true });
  return sendTemplateToContact(db, ctx, content);
}
