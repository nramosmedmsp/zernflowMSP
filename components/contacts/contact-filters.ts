// Filtros de la lista de contactos (pura, para probarla con vitest).

/** Valor de filtro para "sin tipo", "sin responsable" o "sin equipo". */
export const NO_VALUE_FILTER = "none";

export interface ContactFilterInput {
  search: string;
  tagId: string | null;
  /** "" = todos, "none" = sin tipo, o el id del tipo. */
  contactTypeId: string;
  ownerId: string;
  teamId: string;
}

export interface FilterableContact {
  display_name: string | null;
  email: string | null;
  phone?: string | null;
  contact_type_id: string | null;
  owner_id: string | null;
  team_id: string | null;
  contact_tags: { tag_id: string }[];
}

function matchesId(filter: string, value: string | null): boolean {
  if (!filter) return true;
  if (filter === NO_VALUE_FILTER) return value === null;
  return value === filter;
}

export function matchesContactFilters(contact: FilterableContact, f: ContactFilterInput): boolean {
  const q = f.search.trim().toLowerCase();
  if (q) {
    const name = contact.display_name?.toLowerCase() ?? "";
    const email = contact.email?.toLowerCase() ?? "";
    const phone = contact.phone?.toLowerCase() ?? "";
    if (!name.includes(q) && !email.includes(q) && !phone.includes(q)) return false;
  }
  if (f.tagId && !contact.contact_tags.some((ct) => ct.tag_id === f.tagId)) return false;
  return (
    matchesId(f.contactTypeId, contact.contact_type_id) &&
    matchesId(f.ownerId, contact.owner_id) &&
    matchesId(f.teamId, contact.team_id)
  );
}
