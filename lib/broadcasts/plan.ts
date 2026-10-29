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

  const convsByContact = new Map<string, { id: string; channelId: string; lateConversationId: string | null; lastInboundAt: string | null }[]>();
  if (withConversations) {
    // El último mensaje del cliente vive en la conversación (conversations.last_inbound_at):
    // en los canales reales los mensajes los guarda Zernio, no la tabla `messages`.
    const conversations = await pageAll<{
      id: string;
      contact_id: string;
      channel_id: string;
      late_conversation_id: string | null;
      last_inbound_at: string | null;
    }>((from, to) =>
      db
        .from("conversations")
        .select("id, contact_id, channel_id, late_conversation_id, last_inbound_at")
        .eq("workspace_id", workspaceId)
        .order("id")
        .range(from, to),
    );
    for (const c of conversations) {
      if (!wanted.has(c.contact_id)) continue;
      const list = convsByContact.get(c.contact_id) ?? [];
      list.push({ id: c.id, channelId: c.channel_id, lateConversationId: c.late_conversation_id, lastInboundAt: c.last_inbound_at });
      convsByContact.set(c.contact_id, list);
    }
  }

  return contacts.map((c) => ({
    id: c.id,
    phone: c.phone,
    links: linksByContact.get(c.id) ?? [],
    conversations: (convsByContact.get(c.id) ?? []).map((conv) => ({
      channelId: conv.channelId,
      lateConversationId: conv.lateConversationId,
      lastInboundAt: conv.lastInboundAt,
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
  const candidates = await loadCandidates(db, workspaceId, contacts, content.kind === "text");

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
