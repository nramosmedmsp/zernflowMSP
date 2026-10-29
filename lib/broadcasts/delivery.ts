// Envío de un mensaje automático a un contacto (difusiones y secuencias),
// por Zernio y con el cliente de servicio. El SDK no lanza excepciones: los
// errores llegan en `res.error` y aquí se devuelven como resultado en español
// (lo revisa lib/cases/messaging.ts). Tras cada envío exitoso se sella la
// salida del bot en la gestión abierta del contacto (stampBotOutbound).

import { stampBotOutbound } from "@/lib/cases";
import type { Db } from "@/lib/cases/io";
import { zernioMessenger, type CaseMessenger } from "@/lib/cases/messaging";
import type { TemplateMessageContent } from "@/lib/types/database";
import { phoneDigits } from "@/lib/whatsapp-templates";
import { buildContactTemplateParams, needsCustomFields } from "./variables";
import { CLOSED_WINDOW_MESSAGE, isWindowOpen, type WindowState } from "./window";

export interface DeliveryContext {
  workspaceId: string;
  contactId: string;
  channelId: string;
  channel: { late_account_id: string | null; platform: string; is_active: boolean } | null;
  conversation: { id: string; late_conversation_id: string | null } | null;
  contact: { display_name: string | null; phone: string | null; key_date: string | null } | null;
  /** contact_channels.platform_sender_id del contacto en este canal. */
  senderId: string | null;
  /** Último mensaje entrante de la conversación (ISO). */
  lastInboundAt: string | null;
  workspaceName: string | null;
}

export type DeliveryResult =
  | { ok: true; messageId: string | null; params?: string[] }
  | { ok: false; error: string };

export async function loadDeliveryContext(
  db: Db,
  ids: { workspaceId: string; contactId: string; channelId: string },
): Promise<DeliveryContext> {
  const [channel, contact, link, conversation, workspace] = await Promise.all([
    db.from("channels").select("late_account_id, platform, is_active").eq("id", ids.channelId).eq("workspace_id", ids.workspaceId).maybeSingle(),
    db.from("contacts").select("display_name, phone, key_date").eq("id", ids.contactId).eq("workspace_id", ids.workspaceId).maybeSingle(),
    db.from("contact_channels").select("platform_sender_id").eq("contact_id", ids.contactId).eq("channel_id", ids.channelId).limit(1).maybeSingle(),
    db.from("conversations").select("id, late_conversation_id, last_inbound_at").eq("contact_id", ids.contactId).eq("channel_id", ids.channelId).limit(1).maybeSingle(),
    db.from("workspaces").select("name").eq("id", ids.workspaceId).maybeSingle(),
  ]);

  return {
    ...ids,
    channel: channel.data ?? null,
    conversation: conversation.data ?? null,
    contact: contact.data ?? null,
    senderId: link.data?.platform_sender_id ?? null,
    // Sellado por el webhook con cada mensaje del cliente (00032).
    lastInboundAt: conversation.data?.last_inbound_at ?? null,
    workspaceName: workspace.data?.name ?? null,
  };
}

/** Ventana de 24 h del contacto en el canal. Sin conversación para enviar texto no hay ventana. */
export function windowStateOf(ctx: DeliveryContext, now: Date | number = Date.now()): WindowState {
  if (!ctx.conversation?.late_conversation_id) return "no_conversation";
  return isWindowOpen(ctx.lastInboundAt, now) ? "open" : "closed";
}

/** Texto libre en la conversación existente. Con `checkWindow` rechaza si pasaron más de 24 h. */
export async function sendTextToContact(
  db: Db,
  ctx: DeliveryContext,
  text: string,
  options: { messenger?: CaseMessenger; checkWindow?: boolean; now?: Date | number } = {},
): Promise<DeliveryResult> {
  if (!ctx.channel?.late_account_id) return { ok: false, error: "El canal no existe o le falta el ID de cuenta de Zernio" };
  if (!ctx.conversation?.late_conversation_id) return { ok: false, error: "El contacto no tiene una conversación en este canal" };
  if (options.checkWindow && !isWindowOpen(ctx.lastInboundAt, options.now ?? Date.now())) {
    return { ok: false, error: CLOSED_WINDOW_MESSAGE };
  }
  const sent = await (options.messenger ?? zernioMessenger(db)).sendText({
    workspaceId: ctx.workspaceId,
    lateConversationId: ctx.conversation.late_conversation_id,
    lateAccountId: ctx.channel.late_account_id,
    text,
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  await stampBotOutbound(db, { contactId: ctx.contactId });
  return { ok: true, messageId: sent.messageId };
}

async function customFieldsOf(db: Db, workspaceId: string, contactId: string): Promise<Record<string, string>> {
  const [{ data: defs }, { data: values }] = await Promise.all([
    db.from("custom_field_definitions").select("id, slug").eq("workspace_id", workspaceId),
    db.from("contact_custom_fields").select("field_id, value").eq("contact_id", contactId),
  ]);
  const slugs = new Map((defs ?? []).map((d) => [d.id, d.slug]));
  const out: Record<string, string> = {};
  for (const v of values ?? []) {
    const slug = slugs.get(v.field_id);
    if (slug) out[slug] = v.value;
  }
  return out;
}

/** Plantilla de WhatsApp hacia el teléfono del contacto (createInboxConversation), con sus variables. */
export async function sendTemplateToContact(
  db: Db,
  ctx: DeliveryContext,
  template: TemplateMessageContent,
  options: { messenger?: CaseMessenger } = {},
): Promise<DeliveryResult> {
  if (!ctx.channel?.late_account_id) return { ok: false, error: "El canal no existe o le falta el ID de cuenta de Zernio" };
  if (ctx.channel.platform !== "whatsapp") return { ok: false, error: "Las plantillas solo se pueden enviar por WhatsApp" };
  if (!ctx.contact) return { ok: false, error: "No se encontró el contacto" };

  const phone = phoneDigits(ctx.senderId) || phoneDigits(ctx.contact.phone);
  if (!phone) return { ok: false, error: "El contacto no tiene un número de WhatsApp" };

  const built = buildContactTemplateParams(template, {
    displayName: ctx.contact.display_name,
    keyDate: ctx.contact.key_date,
    workspaceName: ctx.workspaceName,
    customFields: needsCustomFields(template.params) ? await customFieldsOf(db, ctx.workspaceId, ctx.contactId) : undefined,
  });
  if (!built.ok) return { ok: false, error: built.error };

  const sent = await (options.messenger ?? zernioMessenger(db)).sendTemplate({
    workspaceId: ctx.workspaceId,
    lateAccountId: ctx.channel.late_account_id,
    phone,
    templateName: template.template_name,
    language: template.language,
    params: built.params,
  });
  if (!sent.ok) return { ok: false, error: sent.error };

  if (ctx.conversation) {
    const at = new Date().toISOString();
    await db
      .from("conversations")
      .update({ last_message_at: at, last_message_preview: `Plantilla: ${template.template_name}` })
      .eq("id", ctx.conversation.id);
  }
  await stampBotOutbound(db, { contactId: ctx.contactId });
  return { ok: true, messageId: sent.messageId, params: built.params };
}
