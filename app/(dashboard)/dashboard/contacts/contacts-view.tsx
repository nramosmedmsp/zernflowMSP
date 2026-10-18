"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Users,
  Mail,
  Calendar,
  CheckCircle,
  XCircle,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, formatRelative } from "@/lib/format";
import { NO_VALUE_FILTER } from "@/components/contacts/contact-filters";
import {
  CONTACTS_PAGE_SIZE,
  CONTACT_SORTS,
  CONTACT_SORT_LABELS,
  contactListHref,
  contactPageCount,
  defaultDirFor,
  hasContactFilters,
  type ContactListParams,
  type ContactSort,
} from "@/components/contacts/contact-list-query";
import {
  SegmentBuilder,
  createEmptyFilter,
  type SegmentFilter,
} from "@/components/segment-builder";
import type { Database } from "@/lib/types/database";

type Tag = Database["public"]["Tables"]["tags"]["Row"];
export type ContactWithTags = Database["public"]["Tables"]["contacts"]["Row"] & {
  contact_tags: {
    tag_id: string;
    tags: Tag | null;
  }[];
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Nunca";
  return formatRelative(dateStr);
}

interface ContactTypeOption {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
}

const FILTER_SELECT_CLASS =
  "rounded-lg border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const SEARCH_DEBOUNCE_MS = 350;

export function ContactsView({
  contacts,
  total,
  params,
  tags,
  contactTypes,
  teams,
  members,
  workspaceId,
  canImport,
}: {
  contacts: ContactWithTags[];
  /** Total que cumple los filtros (todas las páginas). */
  total: number;
  params: ContactListParams;
  tags: Tag[];
  contactTypes: ContactTypeOption[];
  teams: { id: string; name: string }[];
  members: { userId: string; name: string }[];
  workspaceId: string;
  canImport: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(params.search);
  const [showSegmentBuilder, setShowSegmentBuilder] = useState(false);
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>(
    createEmptyFilter()
  );

  const typeById = new Map(contactTypes.map((t) => [t.id, t]));
  const memberName = new Map(members.map((m) => [m.userId, m.name]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  // Los filtros viven en la URL: cada cambio vuelve a pedir la lista al servidor.
  function go(patch: Partial<ContactListParams>) {
    router.replace(contactListHref({ ...params, page: 1, ...patch }));
  }

  // Búsqueda con espera, para no consultar en cada tecla.
  useEffect(() => {
    if (search.trim() === params.search) return;
    const timer = setTimeout(() => {
      router.replace(contactListHref({ ...params, search: search.trim(), page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, params, router]);


  const pages = contactPageCount(total);
  const firstShown = total === 0 ? 0 : (params.page - 1) * CONTACTS_PAGE_SIZE + 1;
  const lastShown = (params.page - 1) * CONTACTS_PAGE_SIZE + contacts.length;
  const filtersActive = hasContactFilters(params);
  const hasExtraFilters = !!(
    params.typeId ||
    params.ownerId ||
    params.teamId ||
    params.keyFrom ||
    params.keyTo
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Contactos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtersActive
                ? `${formatNumber(total)} ${total === 1 ? "contacto coincide" : "contactos coinciden"} con los filtros`
                : `${formatNumber(total)} ${total === 1 ? "contacto" : "contactos"} en tu espacio de trabajo`}
            </p>
          </div>
          {canImport && (
            <Link
              href="/dashboard/contacts/import"
              className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Upload className="h-4 w-4" />
              Importar
            </Link>
          )}
        </div>

        {/* Search and filters */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nombre, correo o teléfono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <select
            aria-label="Tipo de contacto"
            value={params.typeId}
            onChange={(e) => go({ typeId: e.target.value })}
            className={FILTER_SELECT_CLASS}
          >
            <option value="">Todos los tipos</option>
            <option value={NO_VALUE_FILTER}>Sin tipo</option>
            {contactTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.archived ? " (archivado)" : ""}
              </option>
            ))}
          </select>
          <select
            aria-label="Responsable"
            value={params.ownerId}
            onChange={(e) => go({ ownerId: e.target.value })}
            className={FILTER_SELECT_CLASS}
          >
            <option value="">Todos los responsables</option>
            <option value={NO_VALUE_FILTER}>Sin responsable</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
          {teams.length > 0 && (
            <select
              aria-label="Equipo"
              value={params.teamId}
              onChange={(e) => go({ teamId: e.target.value })}
              className={FILTER_SELECT_CLASS}
            >
              <option value="">Todos los equipos</option>
              <option value={NO_VALUE_FILTER}>Sin equipo</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Fecha clave
            <input
              type="date"
              aria-label="Fecha clave desde"
              value={params.keyFrom}
              onChange={(e) => go({ keyFrom: e.target.value })}
              className={FILTER_SELECT_CLASS}
            />
            <span>a</span>
            <input
              type="date"
              aria-label="Fecha clave hasta"
              value={params.keyTo}
              onChange={(e) => go({ keyTo: e.target.value })}
              className={FILTER_SELECT_CLASS}
            />
          </label>
          <select
            aria-label="Ordenar por"
            value={params.sort}
            onChange={(e) => go({ sort: e.target.value as ContactSort, dir: defaultDirFor(e.target.value as ContactSort) })}
            className={FILTER_SELECT_CLASS}
          >
            {CONTACT_SORTS.map((s) => (
              <option key={s} value={s}>
                Orden: {CONTACT_SORT_LABELS[s]}
              </option>
            ))}
          </select>
          {hasExtraFilters && (
            <button
              onClick={() =>
                go({ typeId: "", ownerId: "", teamId: "", keyFrom: "", keyTo: "" })
              }
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              Limpiar filtros
            </button>
          )}
          <button
            onClick={() => setShowSegmentBuilder(!showSegmentBuilder)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              showSegmentBuilder
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Filter className="h-4 w-4" />
            Segmento
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                showSegmentBuilder && "rotate-180"
              )}
            />
          </button>
        </div>

        {/* Segment builder */}
        {showSegmentBuilder && (
          <div className="mt-4">
            <SegmentBuilder
              value={segmentFilter}
              onChange={setSegmentFilter}
              workspaceId={workspaceId}
            />
          </div>
        )}

        {/* Tag pills */}
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => go({ tagId: "" })}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                params.tagId === ""
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              Todas
            </button>
            {tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => go({ tagId: tag.id === params.tagId ? "" : tag.id })}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  params.tagId === tag.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                )}
                style={
                  tag.color && params.tagId !== tag.id
                    ? {
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }
                    : undefined
                }
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Users className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              No se encontraron contactos
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Los contactos se crean automáticamente cuando alguien escribe a tus canales
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-8 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Nombre
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Tipo
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Responsable
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Equipo
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Correo electrónico
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Última interacción
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Etiquetas
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                  Suscrito
                </th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const contactTags = contact.contact_tags
                  .map((ct) => ct.tags)
                  .filter(Boolean) as Tag[];

                return (
                  <tr
                    key={contact.id}
                    className="border-b border-border transition-colors hover:bg-accent/50"
                  >
                    <td className="px-8 py-3">
                      <Link
                        href={`/dashboard/contacts/${contact.id}`}
                        className="flex items-center gap-3"
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {contact.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={contact.avatar_url}
                              alt={contact.display_name || "Contacto"}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            contact.display_name?.[0]?.toUpperCase() ?? "?"
                          )}
                        </div>
                        <span className="text-sm font-medium hover:underline">
                          {contact.display_name ?? "Desconocido"}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {contact.contact_type_id && typeById.get(contact.contact_type_id) ? (
                        <span
                          className="inline-flex rounded-full border border-border px-2 py-0.5 text-xs font-medium"
                          style={
                            typeById.get(contact.contact_type_id)?.color
                              ? {
                                  backgroundColor: `${typeById.get(contact.contact_type_id)?.color}20`,
                                  borderColor: `${typeById.get(contact.contact_type_id)?.color}40`,
                                  color: typeById.get(contact.contact_type_id)?.color ?? undefined,
                                }
                              : undefined
                          }
                        >
                          {typeById.get(contact.contact_type_id)?.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">Sin tipo</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {contact.owner_id ? (
                        (memberName.get(contact.owner_id) ?? "Alguien")
                      ) : (
                        <span className="text-xs text-muted-foreground/50">Sin responsable</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {contact.team_id ? (teamName.get(contact.team_id) ?? "—") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {contact.email ? (
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          {contact.email}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">
                          Sin correo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        suppressHydrationWarning
                        className="flex items-center gap-1.5 text-sm text-muted-foreground"
                      >
                        <Calendar className="h-3 w-3" />
                        {formatDate(contact.last_interaction_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {contactTags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {contactTags.slice(0, 3).map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex rounded-full border border-border px-2 py-0.5 text-[10px] font-medium"
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
                            </span>
                          ))}
                          {contactTags.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{contactTags.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">
                          Sin etiquetas
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {contact.is_subscribed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                          <CheckCircle className="h-3.5 w-3.5" />
                          Sí
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                          <XCircle className="h-3.5 w-3.5" />
                          No
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginación */}
      {total > 0 && (
        <div className="flex items-center justify-between border-t border-border px-8 py-3 text-sm text-muted-foreground">
          <span>
            Mostrando {formatNumber(firstShown)}–{formatNumber(lastShown)} de {formatNumber(total)}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs">
              Página {formatNumber(params.page)} de {formatNumber(pages)}
            </span>
            {params.page > 1 ? (
              <Link
                href={contactListHref({ ...params, page: params.page - 1 })}
                aria-label="Página anterior"
                className="rounded-lg border border-input p-1.5 hover:bg-accent hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
            ) : (
              <span className="rounded-lg border border-input p-1.5 opacity-40">
                <ChevronLeft className="h-4 w-4" />
              </span>
            )}
            {params.page < pages ? (
              <Link
                href={contactListHref({ ...params, page: params.page + 1 })}
                aria-label="Página siguiente"
                className="rounded-lg border border-input p-1.5 hover:bg-accent hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className="rounded-lg border border-input p-1.5 opacity-40">
                <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
