"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  X,
  Mail,
  Calendar,
  Tag,
  User,
  Hash,
  Plus,
  ExternalLink,
  Users,
  UserRound,
  Contact as ContactIcon,
  CalendarDays,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { formatDate as formatDay, formatDateTime } from "@/lib/format";
import { platformLabel } from "@/lib/platforms";
import { limaDateTimeIso } from "@/lib/cases/dates";
import { listCaseMembers, type ContactCasesView } from "@/lib/actions/cases";
import {
  addContactTag,
  removeContactTag,
  setContactOwner,
  setContactTeam,
  updateContactType,
  type ContactActionResult,
} from "@/lib/actions/contacts";
import type { Database, Platform } from "@/lib/types/database";
import { useContactCases } from "./use-contact-cases";
import { selectClass } from "./ui";
import { useToast } from "@/components/ui/toast";

type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type TagRow = Database["public"]["Tables"]["tags"]["Row"];
type CustomFieldDef =
  Database["public"]["Tables"]["custom_field_definitions"]["Row"];

interface ContactDetails {
  contact: Contact;
  tags: TagRow[];
  customFields: { definition: CustomFieldDef; value: string }[];
  channels: {
    platform: Platform;
    platform_username: string | null;
  }[];
}

interface MemberOption {
  userId: string;
  name: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Nunca";
  return formatDateTime(dateStr);
}

/** "YYYY-MM-DD" como día de Lima (al mediodía para no correrse de día). */
function formatKeyDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDay(limaDateTimeIso(date, 12)) : date;
}

async function fetchContactDetails(id: string): Promise<ContactDetails | null> {
  const supabase = createClient();

  const [contactRes, tagsRes, fieldsRes, channelsRes] = await Promise.all([
    supabase.from("contacts").select("*").eq("id", id).single(),
    supabase
      .from("contact_tags")
      .select("tag_id, tags(*)")
      .eq("contact_id", id),
    supabase
      .from("contact_custom_fields")
      .select("*, custom_field_definitions(*)")
      .eq("contact_id", id),
    supabase
      .from("contact_channels")
      .select("platform_username, channels(platform)")
      .eq("contact_id", id),
  ]);

  if (contactRes.data) {
    const tags = (tagsRes.data ?? [])
      .map((ct) => ct.tags)
      .filter(Boolean) as TagRow[];

    const customFields = (fieldsRes.data ?? [])
      .map((cf) => ({
        definition: cf.custom_field_definitions as unknown as CustomFieldDef,
        value: cf.value,
      }))
      .filter((cf) => cf.definition);

    const channels = (channelsRes.data ?? []).map((cc) => ({
      platform: (cc.channels as unknown as { platform: Platform }).platform,
      platform_username: cc.platform_username,
    }));

    return {
      contact: contactRes.data,
      tags: tags.sort((a, b) => a.name.localeCompare(b.name, "es")),
      customFields,
      channels,
    };
  }
  return null;
}

export function ContactPanel({
  contactId,
  workspaceId,
  onClose,
  cases: providedCases,
  members: providedMembers,
  onContactChanged,
}: {
  contactId: string | null;
  workspaceId: string;
  onClose: () => void;
  /** Vista de getContactCases si ya la tiene quien abre el panel (la bandeja). */
  cases?: ContactCasesView | null;
  members?: MemberOption[];
  /** Se cambió el tipo, el responsable o el equipo. */
  onContactChanged?: () => void;
}) {
  const [loadedDetails, setDetails] = useState<ContactDetails | null>(null);
  const [notFoundId, setNotFoundId] = useState<string | null>(null);
  const [workspaceTags, setWorkspaceTags] = useState<TagRow[]>([]);
  const [addingTag, setAddingTag] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [loadedMembers, setLoadedMembers] = useState<MemberOption[]>([]);

  // Sin datos de la bandeja, el panel los pide por su cuenta.
  const own = useContactCases(providedCases === undefined ? contactId : null);
  const caseData = providedCases === undefined ? own.data : providedCases;
  const members = providedMembers ?? loadedMembers;

  useEffect(() => {
    if (providedMembers) return;
    let cancelled = false;
    void listCaseMembers().then((r) => {
      if (!cancelled && "members" in r) setLoadedMembers(r.members.map((m) => ({ userId: m.userId, name: m.name })));
    });
    return () => {
      cancelled = true;
    };
  }, [providedMembers]);

  const loadContact = useCallback(async (id: string) => {
    const details = await fetchContactDetails(id);
    if (details) setDetails(details);
    else setNotFoundId(id);
  }, []);

  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    void fetchContactDetails(contactId).then((details) => {
      if (cancelled) return;
      if (details) setDetails(details);
      else setNotFoundId(contactId);
    });
    return () => {
      cancelled = true;
    };
  }, [contactId, workspaceId]);

  // Etiquetas existentes del espacio (crearlas es de administradores, en Configuración).
  useEffect(() => {
    let cancelled = false;
    void createClient()
      .from("tags")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setWorkspaceTags(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!contactId) return null;

  const details =
    loadedDetails?.contact.id === contactId ? loadedDetails : null;
  const cases = caseData && caseData.contact.id === contactId ? caseData : null;
  const isAdmin = !!cases?.me.isAdmin;

  /** Cambia un dato del contacto con la acción de servidor (valida permisos y registra la actividad). */
  async function updateContact(key: string, action: (contactId: string) => Promise<ContactActionResult>) {
    if (!details) return;
    setSaving(key);
    setError(null);
    let result: ContactActionResult;
    try {
      result = await action(details.contact.id);
    } catch {
      result = { error: "No se pudo guardar el cambio. Inténtalo de nuevo." };
    }
    setSaving(null);
    if ("error" in result) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success("Contacto actualizado");
    await loadContact(details.contact.id);
    onContactChanged?.();
    if (providedCases === undefined) void own.reload();
  }

  async function addTag(tagId: string) {
    if (!details || !tagId) return;
    setSaving("tags");
    setError(null);
    let result: ContactActionResult;
    try {
      result = await addContactTag(details.contact.id, tagId);
    } catch {
      result = { error: "No se pudo agregar la etiqueta." };
    }
    setSaving(null);
    setAddingTag(false);
    if ("error" in result) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success("Etiqueta agregada");
    await loadContact(details.contact.id);
  }

  async function removeTag(tagId: string) {
    if (!details) return;
    setSaving("tags");
    setError(null);
    let result: ContactActionResult;
    try {
      result = await removeContactTag(details.contact.id, tagId);
    } catch {
      result = { error: "No se pudo quitar la etiqueta." };
    }
    setSaving(null);
    if ("error" in result) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success("Etiqueta quitada");
    await loadContact(details.contact.id);
  }

  const contact = details?.contact;
  const ownerId = contact?.owner_id ?? null;
  const teamId = contact?.team_id ?? null;
  const ownerName = ownerId ? members.find((m) => m.userId === ownerId)?.name ?? "Otra persona" : "Sin responsable";
  const teamName = teamId ? cases?.teams.find((t) => t.id === teamId)?.name ?? "Equipo archivado" : "Sin equipo";
  const contactTypes = cases?.contactTypes ?? [];
  const currentType = contactTypes.find((t) => t.id === contact?.contact_type_id) ?? null;
  const availableTags = workspaceTags.filter((t) => !details?.tags.some((x) => x.id === t.id));

  return (
    <div className="animate-slide-in-right flex h-full w-80 flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <h3 className="text-sm font-semibold">Información del contacto</h3>
        <button
          onClick={onClose}
          aria-label="Cerrar panel"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!details && notFoundId !== contactId ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : details && contact ? (
        <div className="flex-1 overflow-y-auto">
          {/* Profile section */}
          <div className="flex flex-col items-center border-b border-border p-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xl font-semibold">
              {contact.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contact.avatar_url}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                contact.display_name?.[0]?.toUpperCase() ?? "?"
              )}
            </div>
            <p className="mt-3 text-sm font-semibold">
              {contact.display_name ?? "Desconocido"}
            </p>
            {contact.email && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {contact.email}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              {currentType && (
                <span
                  className="rounded-full border border-border px-2.5 py-0.5 text-[10px] font-medium"
                  style={
                    currentType.color
                      ? { backgroundColor: `${currentType.color}20`, borderColor: `${currentType.color}40`, color: currentType.color }
                      : undefined
                  }
                >
                  {currentType.name}
                </span>
              )}
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                  contact.is_subscribed
                    ? "bg-green-100 text-green-700"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {contact.is_subscribed ? "Suscrito" : "No suscrito"}
              </span>
            </div>
            <Link
              href={`/dashboard/contacts/${contact.id}`}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Ver ficha completa
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          {/* Details */}
          <div className="space-y-4 p-4">
            {error && <p className="text-xs text-destructive">{error}</p>}

            {/* Contact type */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <ContactIcon className="h-3 w-3" />
                Tipo de contacto
                {saving === "type" && <Loader2 className="h-3 w-3 animate-spin" />}
              </h4>
              {contactTypes.length > 0 ? (
                <select
                  value={contact.contact_type_id ?? ""}
                  disabled={saving !== null}
                  onChange={(e) => void updateContact("type", (id) => updateContactType(id, e.target.value || null))}
                  className={cn(selectClass, "mt-1 w-full text-sm")}
                  aria-label="Tipo de contacto"
                >
                  <option value="">Sin tipo</option>
                  {contactTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 text-sm">{currentType?.name ?? "Sin tipo"}</p>
              )}
            </div>

            {/* Owner */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <UserRound className="h-3 w-3" />
                Responsable
                {saving === "owner" && <Loader2 className="h-3 w-3 animate-spin" />}
              </h4>
              {isAdmin ? (
                <select
                  value={ownerId ?? ""}
                  disabled={saving !== null}
                  onChange={(e) => void updateContact("owner", (id) => setContactOwner(id, e.target.value || null))}
                  className={cn(selectClass, "mt-1 w-full text-sm")}
                  aria-label="Responsable del contacto"
                >
                  <option value="">Sin responsable</option>
                  {ownerId && !members.some((m) => m.userId === ownerId) && (
                    <option value={ownerId}>{ownerName}</option>
                  )}
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 text-sm">{ownerName}</p>
              )}
            </div>

            {/* Team */}
            {(isAdmin ? (cases?.teams.length ?? 0) > 0 : !!teamId) && (
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <Users className="h-3 w-3" />
                  Equipo
                  {saving === "team" && <Loader2 className="h-3 w-3 animate-spin" />}
                </h4>
                {isAdmin ? (
                  <select
                    value={teamId ?? ""}
                    disabled={saving !== null}
                    onChange={(e) => void updateContact("team", (id) => setContactTeam(id, e.target.value || null))}
                    className={cn(selectClass, "mt-1 w-full text-sm")}
                    aria-label="Equipo del contacto"
                  >
                    <option value="">Sin equipo</option>
                    {teamId && !cases?.teams.some((t) => t.id === teamId) && (
                      <option value={teamId}>{teamName}</option>
                    )}
                    {cases?.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1 text-sm">{teamName}</p>
                )}
              </div>
            )}

            {/* Key date */}
            {(contact.key_date || cases?.keyDateLabel) && (
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <CalendarDays className="h-3 w-3" />
                  {cases?.keyDateLabel ?? "Fecha clave"}
                </h4>
                <p className="mt-1 text-sm">
                  {contact.key_date ? formatKeyDate(contact.key_date) : "Sin fecha"}
                </p>
              </div>
            )}

            {/* Connected platforms */}
            {details.channels.length > 0 && (
              <div>
                <h4 className="text-xs font-medium uppercase text-muted-foreground">
                  Plataformas
                </h4>
                <div className="mt-2 space-y-1.5">
                  {details.channels.map((ch, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm"
                    >
                      <PlatformIcon
                        platform={ch.platform}
                        className="h-3.5 w-3.5"
                        size={14}
                      />
                      <span className="capitalize text-muted-foreground">
                        {platformLabel(ch.platform)}
                      </span>
                      {ch.platform_username && (
                        <span className="truncate text-foreground">
                          @{ch.platform_username}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Email */}
            {contact.email && (
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  Correo electrónico
                </h4>
                <p className="mt-1 text-sm">{contact.email}</p>
              </div>
            )}

            {/* Last interaction */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <Calendar className="h-3 w-3" />
                Última interacción
              </h4>
              <p className="mt-1 text-sm">
                {formatDate(contact.last_interaction_at)}
              </p>
            </div>

            {/* Joined */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <User className="h-3 w-3" />
                Creado
              </h4>
              <p className="mt-1 text-sm">
                {formatDate(contact.created_at)}
              </p>
            </div>

            {/* Tags */}
            <div>
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <Tag className="h-3 w-3" />
                  Etiquetas
                  {saving === "tags" && <Loader2 className="h-3 w-3 animate-spin" />}
                </h4>
                {availableTags.length > 0 && !addingTag && (
                  <button
                    onClick={() => setAddingTag(true)}
                    disabled={saving !== null}
                    className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="h-3 w-3" />
                    Agregar
                  </button>
                )}
              </div>
              {addingTag && (
                <select
                  autoFocus
                  defaultValue=""
                  onChange={(e) => void addTag(e.target.value)}
                  onBlur={() => setAddingTag(false)}
                  className={cn(selectClass, "mt-2 w-full text-sm")}
                  aria-label="Agregar etiqueta"
                >
                  <option value="" disabled>
                    Elige una etiqueta
                  </option>
                  {availableTags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              {details.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {details.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="group inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
                      style={
                        tag.color
                          ? {
                              backgroundColor: `${tag.color}20`,
                              borderColor: `${tag.color}40`,
                              color: tag.color,
                            }
                          : undefined
                      }
                    >
                      {tag.name}
                      <button
                        onClick={() => void removeTag(tag.id)}
                        disabled={saving !== null}
                        aria-label={`Quitar la etiqueta ${tag.name}`}
                        className="rounded-full opacity-60 hover:opacity-100 disabled:opacity-30"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                !addingTag && <p className="mt-1 text-xs text-muted-foreground">Sin etiquetas</p>
              )}
            </div>

            {/* Custom fields */}
            {details.customFields.length > 0 && (
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <Hash className="h-3 w-3" />
                  Campos personalizados
                </h4>
                <div className="mt-2 space-y-2">
                  {details.customFields.map((cf) => (
                    <div key={cf.definition.id}>
                      <p className="text-xs text-muted-foreground">
                        {cf.definition.name}
                      </p>
                      <p className="text-sm">{cf.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Contacto no encontrado
        </div>
      )}
    </div>
  );
}
