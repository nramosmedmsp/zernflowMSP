// Reúne todo lo que el CRM guarda de un contacto para exportarlo
// (lib/contact-export.ts lo convierte en una página imprimible). Servidor, con
// el cliente de servicio; el permiso (Dueño o Administrador) lo comprueba la
// ruta. Los mensajes de los canales reales viven en Zernio: se leen de allí (con
// tope) y se unen a los que el CRM guarda; si Zernio no responde, la página lo
// dice en vez de fallar.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTimeline, type TimelineLookups } from "@/components/contacts/timeline";
import { describeSource, keyDateLabel } from "@/components/contacts/contact-labels";
import { isDemoChannel } from "@/lib/demo";
import { mapZernioMessage, sortMessages, type InboxMessage, type ZernioListMessage } from "@/lib/inbox-messages";
import { platformLabel } from "@/lib/platforms";
import { displayName } from "@/lib/team-rules";
import { getLateApiKey } from "@/lib/workspace-secrets";
import { consentForExport, type ContactExport, type ExportConversation } from "@/lib/contact-export";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/** Mensajes que se piden a Zernio por conversación (páginas de 100). */
export const EXPORT_MAX_MESSAGES = 2000;
const PAGE = 100;

const CONVERSATION_STATUS: Record<string, string> = { open: "Abierta", closed: "Cerrada", snoozed: "Pospuesta" };
const CASE_STATUS: Record<string, string> = {
  scheduled: "Programada",
  open: "Abierta",
  won: "Ganada",
  lost: "Perdida",
  resolved: "Resuelta",
  cancelled: "Cancelada",
};
const CASE_ORIGIN: Record<string, string> = { inbound: "Mensaje del cliente", proactive: "Proactiva", manual: "Manual" };
const BROADCAST_STATUS: Record<string, string> = {
  pending: "Pendiente",
  sending: "Enviándose",
  sent: "Enviada",
  failed: "No se pudo enviar",
  skipped: "No se envió (baja o sin consentimiento)",
};
const ENROLLMENT_STATUS: Record<string, string> = {
  active: "Activa",
  completed: "Terminada",
  cancelled: "Cancelada",
  paused: "En pausa",
};

type Named = { id: string; name: string };
const names = (rows: Named[] | null | undefined): Record<string, string> =>
  Object.fromEntries((rows ?? []).map((r) => [r.id, r.name]));

async function userNames(db: Db, ids: Iterable<string | null | undefined>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of new Set([...ids].filter((x): x is string => !!x))) {
    try {
      const { data } = await db.auth.admin.getUserById(id);
      out[id] = data?.user
        ? displayName({ id: data.user.id, email: data.user.email ?? "", user_metadata: data.user.user_metadata })
        : "Persona del equipo";
    } catch {
      out[id] = "Persona del equipo";
    }
  }
  return out;
}

async function zernioMessages(
  apiKey: string,
  accountId: string,
  lateConversationId: string,
  conversationId: string,
): Promise<{ messages: InboxMessage[]; truncated: boolean }> {
  const { createZernioClient } = await import("@/lib/zernio-client");
  const zernio = createZernioClient(apiKey);
  const all: InboxMessage[] = [];
  let cursor: string | undefined;
  for (;;) {
    const res = await zernio.messages.getInboxConversationMessages({
      path: { conversationId: lateConversationId },
      query: { accountId, limit: PAGE, sortOrder: "desc", cursor },
    });
    if (res.error) throw new Error("Zernio no devolvió los mensajes");
    const data = res.data as
      | { messages?: ZernioListMessage[]; data?: ZernioListMessage[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } }
      | undefined;
    for (const raw of data?.messages ?? data?.data ?? []) {
      const m = mapZernioMessage(raw, conversationId);
      if (m) all.push(m);
    }
    const next = data?.pagination?.nextCursor ?? null;
    if (!data?.pagination?.hasMore || !next) return { messages: all, truncated: false };
    if (all.length >= EXPORT_MAX_MESSAGES) return { messages: all, truncated: true };
    cursor = next;
  }
}

export async function loadContactExport(
  db: Db,
  params: { workspaceId: string; contactId: string; actorId: string },
): Promise<ContactExport | null> {
  const { workspaceId, contactId } = params;
  const { data: contact } = await db
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!contact) return null;

  const [
    workspace,
    channelLinks,
    conversations,
    fields,
    contactTags,
    contactTypes,
    teams,
    caseTypes,
    activity,
    notes,
    cases,
    recipients,
    enrollments,
  ] = await Promise.all([
    db.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
    db.from("contact_channels").select("platform_sender_id, platform_username, channels(platform, username, display_name)").eq("contact_id", contactId),
    db.from("conversations").select("id, channel_id, platform, status, late_conversation_id, channels(late_account_id, display_name, username)").eq("contact_id", contactId).eq("workspace_id", workspaceId),
    db.from("contact_custom_fields").select("value, custom_field_definitions(name)").eq("contact_id", contactId),
    db.from("contact_tags").select("tags(name)").eq("contact_id", contactId),
    db.from("contact_types").select("id, name").eq("workspace_id", workspaceId),
    db.from("teams").select("id, name").eq("workspace_id", workspaceId),
    db.from("case_types").select("id, name").eq("workspace_id", workspaceId),
    db.from("activity").select("id, type, actor_id, case_id, from_value, to_value, meta, created_at").eq("contact_id", contactId).eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1000),
    db.from("case_notes").select("id, case_id, author_id, body, created_at").eq("contact_id", contactId).eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
    db.from("cases").select("id, case_type_id, stage_id, status, origin, opened_at, closed_at, closed_by, outcome_reason_id, outcome_note, next_action_at, next_action_note, created_at").eq("contact_id", contactId).eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
    db.from("broadcast_recipients").select("status, sent_at, broadcasts(name)").eq("contact_id", contactId),
    db.from("sequence_enrollments").select("status, enrolled_at, sequences(name)").eq("contact_id", contactId),
  ]);

  const typeIds = (caseTypes.data ?? []).map((t) => t.id);
  const [stages, categories, reasons] = typeIds.length
    ? await Promise.all([
        db.from("case_stages").select("id, name").in("case_type_id", typeIds),
        db.from("case_categories").select("id, name").in("case_type_id", typeIds),
        db.from("case_outcome_reasons").select("id, name").in("case_type_id", typeIds),
      ])
    : [{ data: [] as Named[] }, { data: [] as Named[] }, { data: [] as Named[] }];

  const convRows = conversations.data ?? [];
  const convIds = convRows.map((c) => c.id);
  const [localMessages, media] = convIds.length
    ? await Promise.all([
        db.from("messages").select("*").in("conversation_id", convIds).order("created_at", { ascending: true }),
        db.from("message_media").select("conversation_id, platform_message_id, file_name, kind, status").in("conversation_id", convIds),
      ])
    : [{ data: [] }, { data: [] }];

  const ownerIds = [
    contact.owner_id,
    contact.marketing_set_by,
    ...(activity.data ?? []).map((a) => a.actor_id),
    ...(notes.data ?? []).map((n) => n.author_id),
    ...(localMessages.data ?? []).map((m) => m.sent_by_user_id),
  ];
  const users = await userNames(db, ownerIds);
  const person = (id: string | null | undefined) => (id ? (users[id] ?? "Persona del equipo") : null);

  // ── Conversaciones y mensajes ──────────────────────────────────────────
  const filesByMessage = new Map<string, string[]>();
  for (const m of media.data ?? []) {
    const key = `${m.conversation_id}:${m.platform_message_id}`;
    const list = filesByMessage.get(key) ?? [];
    list.push(m.file_name || (m.status === "expired" ? "archivo vencido" : m.kind));
    filesByMessage.set(key, list);
  }
  const apiKey = await getLateApiKey(workspaceId, db).catch(() => null);
  const notices: string[] = [];
  const exportedConversations: ExportConversation[] = [];

  for (const conv of convRows) {
    const channel = conv.channels as { late_account_id: string | null; display_name: string | null; username: string | null } | null;
    const local = (localMessages.data ?? []).filter((m) => m.conversation_id === conv.id);
    const merged = new Map<string, InboxMessage>();
    let warning: string | null = null;

    for (const row of local) merged.set(row.platform_message_id ?? row.id, { ...row, error: null, story: null } as unknown as InboxMessage);

    if (conv.late_conversation_id && channel?.late_account_id && !isDemoChannel(channel.late_account_id)) {
      if (!apiKey) {
        warning = "No se pudieron leer los mensajes de WhatsApp/Instagram porque falta la clave de Zernio. Solo se muestran los que guarda el CRM.";
      } else {
        try {
          const remote = await zernioMessages(apiKey, channel.late_account_id, conv.late_conversation_id, conv.id);
          for (const m of remote.messages) merged.set(m.platform_message_id ?? m.id, { ...(merged.get(m.platform_message_id ?? m.id) ?? {}), ...m });
          if (remote.truncated) warning = `Solo se incluyen los ${EXPORT_MAX_MESSAGES} mensajes más recientes de esta conversación.`;
        } catch (err) {
          console.error("[contact-export] Zernio:", err instanceof Error ? err.message : err);
          warning = "No se pudieron leer los mensajes desde Zernio en este momento. Solo se muestran los que guarda el CRM; vuelve a generar la copia más tarde para incluir todos.";
        }
      }
    }

    const flowIds = new Set(local.filter((m) => m.sent_by_flow_id).map((m) => m.platform_message_id ?? m.id));
    const authors = new Map(local.map((m) => [m.platform_message_id ?? m.id, m.sent_by_user_id]));
    const messages = sortMessages([...merged.values()]).map((m) => {
      const key = m.platform_message_id ?? m.id;
      const authorId = authors.get(key) ?? m.sent_by_user_id;
      const who =
        m.direction === "inbound"
          ? "Cliente"
          : flowIds.has(key) || m.sent_by_flow_id
            ? "Asistente automático"
            : authorId
              ? `Tienda (${person(authorId)})`
              : "Tienda";
      return {
        at: m.created_at,
        who,
        text: m.text ?? "",
        files: filesByMessage.get(`${conv.id}:${key}`) ?? [],
      };
    });
    exportedConversations.push({
      platform: platformLabel(conv.platform),
      channel: channel?.display_name || channel?.username || "Canal",
      status: CONVERSATION_STATUS[conv.status] ?? conv.status,
      messages,
      warning,
    });
  }

  // ── Gestiones, notas e historial ───────────────────────────────────────
  const stageNames = names(stages.data);
  const reasonNames = names(reasons.data);
  const typeNames = names(caseTypes.data);
  const lookups: TimelineLookups = {
    users,
    teams: names(teams.data),
    caseTypes: typeNames,
    stages: stageNames,
    categories: names(categories.data),
    outcomeReasons: reasonNames,
    contactTypes: names(contactTypes.data),
  };
  const history = buildTimeline({
    activity: activity.data ?? [],
    notes: notes.data ?? [],
    cases: cases.data ?? [],
    lookups,
  })
    .filter((i) => i.kind !== "note")
    .map((i) => ({ at: i.at, title: i.title, detail: i.detail, actor: i.actor }));

  const exportedCases = (cases.data ?? []).map((g) => ({
    type: (g.case_type_id && typeNames[g.case_type_id]) || "Sin clasificar",
    status: CASE_STATUS[g.status] ?? g.status,
    origin: CASE_ORIGIN[g.origin] ?? g.origin,
    openedAt: g.opened_at,
    closedAt: g.closed_at,
    stage: (g.stage_id && stageNames[g.stage_id]) || null,
    outcome: (g.outcome_reason_id && reasonNames[g.outcome_reason_id]) || null,
    outcomeNote: g.outcome_note,
    nextActionAt: g.next_action_at,
    nextActionNote: g.next_action_note,
    notes: (notes.data ?? [])
      .filter((n) => n.case_id === g.id)
      .map((n) => ({ at: n.created_at, author: person(n.author_id) ?? "Sistema", body: n.body })),
  }));

  notices.push(
    "Esta copia reúne lo que guarda el CRM de la tienda. Los mismos mensajes también existen en la cuenta de WhatsApp o Instagram de la tienda y en Zernio, el servicio que conecta esas cuentas.",
  );

  return {
    generatedAt: new Date().toISOString(),
    generatedBy: person(params.actorId) ?? "una persona del equipo",
    businessName: workspace.data?.name ?? "La tienda",
    contact: {
      name: contact.display_name,
      phone: contact.phone,
      email: contact.email,
      type: (contact.contact_type_id && lookups.contactTypes[contact.contact_type_id]) || null,
      origin: describeSource(contact.source),
      keyDateLabel: keyDateLabel(workspace.data?.settings),
      keyDate: contact.key_date,
      owner: person(contact.owner_id),
      team: (contact.team_id && lookups.teams[contact.team_id]) || null,
      createdAt: contact.created_at,
      lastInteractionAt: contact.last_interaction_at,
      tags: (contactTags.data ?? []).flatMap((t) => {
        const tag = t.tags as { name: string } | null;
        return tag ? [tag.name] : [];
      }),
      customFields: (fields.data ?? []).map((f) => ({
        name: (f.custom_field_definitions as { name?: string } | null)?.name ?? "Campo",
        value: f.value,
      })),
    },
    consent: consentForExport({
      status: contact.marketing_status,
      at: contact.marketing_status_at,
      source: contact.marketing_source,
      setBy: person(contact.marketing_set_by),
      note: contact.marketing_note,
    }),
    channels: (channelLinks.data ?? []).map((l) => {
      const ch = l.channels as { platform?: string; username?: string | null; display_name?: string | null } | null;
      return {
        platform: ch?.platform ? platformLabel(ch.platform) : "—",
        account: ch?.display_name || ch?.username || "—",
        identifier: l.platform_username ? `@${l.platform_username}` : (l.platform_sender_id ?? "—"),
      };
    }),
    conversations: exportedConversations,
    cases: exportedCases,
    broadcasts: (recipients.data ?? []).map((r) => ({
      name: (r.broadcasts as { name?: string } | null)?.name ?? "Difusión",
      at: r.sent_at,
      status: BROADCAST_STATUS[r.status] ?? r.status,
    })),
    sequences: (enrollments.data ?? []).map((e) => ({
      name: (e.sequences as { name?: string } | null)?.name ?? "Secuencia",
      status: ENROLLMENT_STATUS[e.status] ?? e.status,
      enrolledAt: e.enrolled_at,
    })),
    history,
    notices,
  };
}
