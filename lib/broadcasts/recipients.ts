// Selección de destinatarios de una difusión (docs/FASE-2-TECNICO.md 5). Pura:
// recibe los datos ya leídos y decide quién recibe y por qué canal.
//
// - Texto: solo contactos con una conversación en un canal activo cuya ventana
//   de 24 h esté abierta. Se cuenta cuántos quedan fuera y por qué.
// - Plantilla de WhatsApp: cualquier contacto con teléfono de WhatsApp
//   (contact_channels.platform_sender_id del canal de WhatsApp o
//   contacts.phone), aunque nunca haya escrito.

import { phoneDigits } from "@/lib/whatsapp-templates";
import { isWindowOpen } from "./window";

export interface ChannelInfo {
  id: string;
  platform: string;
  isActive: boolean;
}

export interface CandidateConversation {
  channelId: string;
  /** conversations.late_conversation_id: sin él no se puede enviar texto. */
  lateConversationId: string | null;
  /** Último mensaje entrante (ISO), o null si el contacto nunca escribió. */
  lastInboundAt: string | null;
}

export interface ContactCandidate {
  id: string;
  /** contacts.phone */
  phone: string | null;
  /** contact_channels del contacto. */
  links: { channelId: string; senderId: string | null }[];
  conversations: CandidateConversation[];
}

export interface TextRecipient {
  contactId: string;
  channelId: string;
}

export interface TextPlan {
  recipients: TextRecipient[];
  excluded: {
    /** Sin conversación en un canal activo. */
    noConversation: number;
    /** Con conversación, pero pasaron más de 24 h desde su último mensaje. */
    closedWindow: number;
  };
}

export function planTextRecipients(
  candidates: readonly ContactCandidate[],
  channels: readonly ChannelInfo[],
  now: Date | number,
): TextPlan {
  const active = new Set(channels.filter((c) => c.isActive).map((c) => c.id));
  const plan: TextPlan = { recipients: [], excluded: { noConversation: 0, closedWindow: 0 } };

  for (const contact of candidates) {
    const usable = contact.conversations.filter((c) => active.has(c.channelId) && !!c.lateConversationId);
    if (usable.length === 0) {
      plan.excluded.noConversation++;
      continue;
    }
    // La conversación con la ventana abierta y el mensaje entrante más reciente.
    let best: CandidateConversation | null = null;
    for (const conv of usable) {
      if (!isWindowOpen(conv.lastInboundAt, now)) continue;
      if (!best || new Date(conv.lastInboundAt as string).getTime() > new Date(best.lastInboundAt as string).getTime()) {
        best = conv;
      }
    }
    if (!best) {
      plan.excluded.closedWindow++;
      continue;
    }
    plan.recipients.push({ contactId: contact.id, channelId: best.channelId });
  }
  return plan;
}

export interface TemplateRecipient extends TextRecipient {
  /** Solo dígitos, con código de país. */
  phone: string;
}

export interface TemplatePlan {
  recipients: TemplateRecipient[];
  excluded: {
    /** Sin teléfono de WhatsApp. */
    noPhone: number;
    /** El espacio no tiene un canal de WhatsApp activo. */
    noWhatsAppChannel: number;
  };
}

/** Canal de WhatsApp y teléfono de un contacto: el canal donde ya escribió, o el primero activo con contacts.phone. */
export function pickWhatsAppTarget(
  contact: Pick<ContactCandidate, "phone" | "links">,
  whatsappChannels: readonly ChannelInfo[],
): { channelId: string; phone: string } | null {
  for (const link of contact.links) {
    const channel = whatsappChannels.find((c) => c.id === link.channelId);
    const phone = phoneDigits(link.senderId);
    if (channel && phone) return { channelId: channel.id, phone };
  }
  const phone = phoneDigits(contact.phone);
  if (phone && whatsappChannels.length > 0) return { channelId: whatsappChannels[0].id, phone };
  return null;
}

export function planTemplateRecipients(
  candidates: readonly ContactCandidate[],
  channels: readonly ChannelInfo[],
): TemplatePlan {
  const whatsapp = channels.filter((c) => c.isActive && c.platform === "whatsapp");
  const plan: TemplatePlan = { recipients: [], excluded: { noPhone: 0, noWhatsAppChannel: 0 } };
  if (whatsapp.length === 0) {
    plan.excluded.noWhatsAppChannel = candidates.length;
    return plan;
  }
  for (const contact of candidates) {
    const target = pickWhatsAppTarget(contact, whatsapp);
    if (!target) {
      plan.excluded.noPhone++;
      continue;
    }
    plan.recipients.push({ contactId: contact.id, channelId: target.channelId, phone: target.phone });
  }
  return plan;
}
