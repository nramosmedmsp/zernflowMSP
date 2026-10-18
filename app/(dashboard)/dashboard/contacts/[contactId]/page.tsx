import { notFound } from "next/navigation";
import Link from "next/link";
import { getWorkspace } from "@/lib/workspace";
import { listCaseMembers } from "@/lib/actions/cases";
import { isAdminRole } from "@/lib/permissions";
import {
  ArrowLeft,
  Mail,
  Phone,
  Calendar,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";
import { ContactProfile } from "@/components/contacts/contact-profile";
import { ContactTimeline } from "@/components/contacts/contact-timeline";
import { contactInitial, describeSource, keyDateLabel } from "@/components/contacts/contact-labels";
import { buildTimeline, type TimelineLookups } from "@/components/contacts/timeline";
import { formatDateTime } from "@/lib/format";
import { platformLabel } from "@/lib/platforms";

const CONVERSATION_STATUS_LABELS: Record<string, string> = {
  open: "Abierta",
  closed: "Cerrada",
  snoozed: "Pospuesta",
};

const TIMELINE_LIMIT = 200;

type Named = { id: string; name: string };

function names(rows: Named[] | null): Record<string, string> {
  return Object.fromEntries((rows ?? []).map((r) => [r.id, r.name]));
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;
  const { workspace, role, supabase } = await getWorkspace();

  const [
    contactRes,
    channelsRes,
    conversationsRes,
    customFieldsRes,
    allTagsRes,
    contactTypesRes,
    teamsRes,
    caseTypesRes,
    activityRes,
    notesRes,
    casesRes,
    membersRes,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select("*, contact_tags(tag_id, tags(*))")
      .eq("id", contactId)
      .eq("workspace_id", workspace.id)
      .single(),
    supabase
      .from("contact_channels")
      .select("*, channels(platform, username, display_name)")
      .eq("contact_id", contactId),
    supabase
      .from("conversations")
      .select("id, platform, status, last_message_at, last_message_preview")
      .eq("contact_id", contactId)
      .eq("workspace_id", workspace.id)
      .order("last_message_at", { ascending: false }),
    supabase
      .from("contact_custom_fields")
      .select("value, custom_field_definitions(name, slug, field_type)")
      .eq("contact_id", contactId),
    supabase.from("tags").select("id, name, color").eq("workspace_id", workspace.id).order("name"),
    supabase
      .from("contact_types")
      .select("id, name, archived_at")
      .eq("workspace_id", workspace.id)
      .order("position", { ascending: true }),
    supabase
      .from("teams")
      .select("id, name")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("name", { ascending: true }),
    supabase.from("case_types").select("id, name").eq("workspace_id", workspace.id),
    supabase
      .from("activity")
      .select("id, type, actor_id, case_id, from_value, to_value, meta, created_at")
      .eq("contact_id", contactId)
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(TIMELINE_LIMIT),
    supabase
      .from("case_notes")
      .select("id, case_id, author_id, body, created_at")
      .eq("contact_id", contactId)
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(TIMELINE_LIMIT),
    supabase
      .from("cases")
      .select("id, case_type_id, status, closed_at, outcome_reason_id, outcome_note, closed_by")
      .eq("contact_id", contactId)
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(100),
    listCaseMembers(),
  ]);

  if (!contactRes.data) notFound();

  const contact = contactRes.data;
  const channels = channelsRes.data ?? [];
  const conversations = conversationsRes.data ?? [];
  const customFields = customFieldsRes.data ?? [];
  const members = "members" in membersRes ? membersRes.members : [];
  const tags = contact.contact_tags
    .map((ct: { tags: unknown }) => ct.tags)
    .filter(Boolean) as { id: string; name: string; color: string | null }[];

  // Nombres para la línea de tiempo (etapas, categorías y motivos por tipo de gestión).
  const caseTypes = caseTypesRes.data ?? [];
  const typeIds = caseTypes.map((t) => t.id);
  const [stagesRes, categoriesRes, reasonsRes] = typeIds.length
    ? await Promise.all([
        supabase.from("case_stages").select("id, name").in("case_type_id", typeIds),
        supabase.from("case_categories").select("id, name").in("case_type_id", typeIds),
        supabase.from("case_outcome_reasons").select("id, name").in("case_type_id", typeIds),
      ])
    : [{ data: [] as Named[] }, { data: [] as Named[] }, { data: [] as Named[] }];

  const lookups: TimelineLookups = {
    users: Object.fromEntries(members.map((m) => [m.userId, m.name])),
    teams: names(teamsRes.data),
    caseTypes: names(caseTypes),
    stages: names(stagesRes.data),
    categories: names(categoriesRes.data),
    outcomeReasons: names(reasonsRes.data),
    contactTypes: names(contactTypesRes.data),
  };

  const timeline = buildTimeline({
    activity: activityRes.data ?? [],
    notes: notesRes.data ?? [],
    cases: casesRes.data ?? [],
    lookups,
  });

  const formatDate = (dateStr: string | null): string => (dateStr ? formatDateTime(dateStr) : "Nunca");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <Link
          href="/dashboard/contacts"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver a contactos
        </Link>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold">
            {contact.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={contact.avatar_url}
                alt={contact.display_name || "Contacto"}
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              contactInitial(contact.display_name)
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold">
              {contact.display_name ?? "Desconocido"}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {contact.email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {contact.email}
                </span>
              )}
              {contact.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {contact.phone}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Última actividad: {formatDate(contact.last_interaction_at)}
              </span>
              {contact.is_subscribed ? (
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle className="h-3 w-3" />
                  Suscrito
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  No suscrito
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            {/* Profile */}
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
                Información
              </h2>
              <ContactProfile
                contactId={contact.id}
                isAdmin={isAdminRole(role)}
                contactTypeId={contact.contact_type_id}
                ownerId={contact.owner_id}
                teamId={contact.team_id}
                keyDate={contact.key_date}
                phone={contact.phone}
                keyDateLabel={keyDateLabel(workspace.settings)}
                sourceText={describeSource(contact.source)}
                contactTypes={(contactTypesRes.data ?? []).map((t) => ({
                  id: t.id,
                  name: t.name,
                  archived: t.archived_at !== null,
                }))}
                teams={teamsRes.data ?? []}
                members={members.map((m) => ({ userId: m.userId, name: m.name }))}
                tags={tags}
                allTags={allTagsRes.data ?? []}
              />
            </div>

            {/* Connected channels */}
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
                Canales conectados
              </h2>
              {channels.length === 0 ? (
                <p className="text-sm text-muted-foreground/60">Sin canales</p>
              ) : (
                <div className="space-y-2">
                  {channels.map((cc) => {
                    const ch = cc.channels as {
                      platform?: string;
                      display_name?: string;
                      username?: string;
                    } | null;
                    return (
                      <div
                        key={cc.id}
                        className="flex items-center gap-3 rounded-lg border border-border p-3"
                      >
                        <PlatformIcon
                          platform={ch?.platform ?? ""}
                          className="h-4 w-4"
                          size={16}
                        />
                        <div>
                          <p className="text-sm font-medium">
                            {ch?.display_name ?? ch?.username ?? "Desconocido"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {ch?.platform ? platformLabel(ch.platform) : ""} ·{" "}
                            {cc.platform_username
                              ? `@${cc.platform_username}`
                              : cc.platform_sender_id}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Custom fields */}
            {customFields.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
                  Campos personalizados
                </h2>
                <div className="space-y-2">
                  {customFields.map((cf, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg border border-border p-3"
                    >
                      <span className="text-sm text-muted-foreground">
                        {(
                          cf.custom_field_definitions as { name?: string }
                        )?.name ?? "Campo"}
                      </span>
                      <span className="text-sm font-medium">{cf.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {/* Conversations */}
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
                Conversaciones
              </h2>
              {conversations.length === 0 ? (
                <p className="text-sm text-muted-foreground/60">
                  Sin conversaciones
                </p>
              ) : (
                <div className="space-y-2">
                  {conversations.map((conv) => (
                    <Link
                      key={conv.id}
                      href={`/dashboard/inbox?contact=${encodeURIComponent(contact.id)}`}
                      className="flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
                    >
                      <PlatformIcon
                        platform={conv.platform}
                        className="mt-0.5 h-4 w-4"
                        size={16}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium capitalize text-muted-foreground">
                            {platformLabel(conv.platform)} · {CONVERSATION_STATUS_LABELS[conv.status] ?? conv.status}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60">
                            {formatDate(conv.last_message_at)}
                          </p>
                        </div>
                        <p className="mt-0.5 truncate text-sm">
                          {conv.last_message_preview || "Sin mensajes"}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Timeline */}
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
                Línea de tiempo
              </h2>
              <ContactTimeline items={timeline} />
              {(activityRes.data?.length ?? 0) >= TIMELINE_LIMIT && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Se muestran los últimos {TIMELINE_LIMIT} movimientos.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
