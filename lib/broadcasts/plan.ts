// Plan de envío de una difusión: a quién le llega y a quién no (y por qué).
// Lo usan la vista previa ("recibirán N, quedan fuera M") y el envío, para que
// ambos cuenten exactamente lo mismo. Servidor, cliente de servicio.

import type { Db } from "@/lib/cases/io";
import { pageAll, selectInChunks } from "./db";
import type { ParsedBroadcastContent } from "./content";
import {
  planTemplateRecipients,
  planTextRecipients,
  type ChannelInfo,
  type ContactCandidate,
} from "./recipients";
import { resolveSegmentContacts, type SegmentContactRow } from "./resolve";
import type { SegmentFilter } from "./segment";
import { buildContactTemplateParams, needsCustomFields } from "./variables";
import { windowCutoffIso } from "./window";

export interface BroadcastPlan {
  kind: "text" | "template";
  /** Contactos suscritos que cumplen el filtro. */
  segmentTotal: number;
  recipients: { contactId: string; channelId: string }[];
  excluded: {
    /** Texto: sin conversación en un canal activo. */
    noConversation: number;
    /** Texto: pasaron más de 24 h desde su último mensaje. */
    closedWindow: number;
    /** Plantilla: sin teléfono de WhatsApp (o sin canal de WhatsApp). */
    noPhone: number;
    /** Plantilla: una variable queda vacía para ese contacto. */
    emptyVariable: number;
  };
}

async function loadChannels(db: Db, workspaceId: string): Promise<ChannelInfo[]> {
  const { data, error } = await db.from("channels").select("id, platform, is_active").eq("workspace_id", workspaceId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ id: c.id, platform: c.platform, isActive: c.is_active }));
}

async function loadCandidates(
  db: Db,
  workspaceId: string,
  contacts: SegmentContactRow[],
  withConversations: boolean,
  now: number,
): Promise<ContactCandidate[]> {
  const ids = contacts.map((c) => c.id);
  const wanted = new Set(ids);

  const links = await selectInChunks(ids, (part) =>
    db.from("contact_channels").select("contact_id, channel_id, platform_sender_id").in("contact_id", part),
  );
  const linksByContact = new Map<string, { channelId: string; senderId: string | null }[]>();
  for (const l of links) {
    const list = linksByContact.get(l.contact_id) ?? [];
    list.push({ channelId: l.channel_id, senderId: l.platform_sender_id });
    linksByContact.set(l.contact_id, list);
  }

  const convsByContact = new Map<string, { id: string; channelId: string; lateConversationId: string | null }[]>();
  const lastInbound = new Map<string, string>();
  if (withConversations) {
    const conversations = await pageAll<{ id: string; contact_id: string; channel_id: string; late_conversation_id: string | null }>(
      (from, to) =>
        db
          .from("conversations")
          .select("id, contact_id, channel_id, late_conversation_id")
          .eq("workspace_id", workspaceId)
          .order("id")
          .range(from, to),
    );
    const relevant = conversations.filter((c) => wanted.has(c.contact_id));
    for (const c of relevant) {
      const list = convsByContact.get(c.contact_id) ?? [];
      list.push({ id: c.id, channelId: c.channel_id, lateConversationId: c.late_conversation_id });
      convsByContact.set(c.contact_id, list);
    }

    // Mensajes entrantes de las últimas 24 h: basta el más reciente de cada conversación.
    const cutoff = windowCutoffIso(now);
    const convIds = relevant.map((c) => c.id);
    for (let i = 0; i < convIds.length; i += 200) {
      const part = convIds.slice(i, i + 200);
      const inbound = await pageAll<{ conversation_id: string; created_at: string }>((from, to) =>
        db
          .from("messages")
          .select("conversation_id, created_at")
          .eq("direction", "inbound")
          .gte("created_at", cutoff)
          .in("conversation_id", part)
          .order("created_at", { ascending: false })
          .range(from, to),
      );
      for (const m of inbound) {
        const prev = lastInbound.get(m.conversation_id);
        if (!prev || m.created_at > prev) lastInbound.set(m.conversation_id, m.created_at);
      }
    }
  }

  return contacts.map((c) => ({
    id: c.id,
    phone: c.phone,
    links: linksByContact.get(c.id) ?? [],
    conversations: (convsByContact.get(c.id) ?? []).map((conv) => ({
      channelId: conv.channelId,
      lateConversationId: conv.lateConversationId,
      lastInboundAt: lastInbound.get(conv.id) ?? null,
    })),
  }));
}

export async function planBroadcast(
  db: Db,
  workspaceId: string,
  content: ParsedBroadcastContent,
  filter: SegmentFilter | null,
  now: number = Date.now(),
): Promise<BroadcastPlan> {
  const contacts = await resolveSegmentContacts(db, workspaceId, filter);
  const channels = await loadChannels(db, workspaceId);
  const candidates = await loadCandidates(db, workspaceId, contacts, content.kind === "text", now);

  const excluded = { noConversation: 0, closedWindow: 0, noPhone: 0, emptyVariable: 0 };

  if (content.kind === "text") {
    const plan = planTextRecipients(candidates, channels, now);
    excluded.noConversation = plan.excluded.noConversation;
    excluded.closedWindow = plan.excluded.closedWindow;
    return { kind: "text", segmentTotal: contacts.length, recipients: plan.recipients, excluded };
  }

  const plan = planTemplateRecipients(candidates, channels);
  excluded.noPhone = plan.excluded.noPhone + plan.excluded.noWhatsAppChannel;

  // Contactos para los que alguna variable quedaría vacía: no se les envía.
  const byId = new Map(contacts.map((c) => [c.id, c]));
  let customByContact = new Map<string, Record<string, string>>();
  if (needsCustomFields(content.params) && plan.recipients.length > 0) {
    customByContact = await loadCustomFields(db, workspaceId, plan.recipients.map((r) => r.contactId));
  }
  const { data: workspace } = await db.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();

  const recipients: BroadcastPlan["recipients"] = [];
  for (const r of plan.recipients) {
    const contact = byId.get(r.contactId);
    const built = buildContactTemplateParams(content, {
      displayName: contact?.display_name,
      keyDate: contact?.key_date,
      workspaceName: workspace?.name,
      customFields: customByContact.get(r.contactId),
    });
    if (built.ok) recipients.push({ contactId: r.contactId, channelId: r.channelId });
    else excluded.emptyVariable++;
  }
  return { kind: "template", segmentTotal: contacts.length, recipients, excluded };
}

async function loadCustomFields(db: Db, workspaceId: string, contactIds: string[]): Promise<Map<string, Record<string, string>>> {
  const { data: defs } = await db.from("custom_field_definitions").select("id, slug").eq("workspace_id", workspaceId);
  const slugs = new Map((defs ?? []).map((d) => [d.id, d.slug]));
  const rows = await selectInChunks(contactIds, (part) =>
    db.from("contact_custom_fields").select("contact_id, field_id, value").in("contact_id", part),
  );
  const out = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const slug = slugs.get(row.field_id);
    if (!slug) continue;
    const fields = out.get(row.contact_id) ?? {};
    fields[slug] = row.value;
    out.set(row.contact_id, fields);
  }
  return out;
}
