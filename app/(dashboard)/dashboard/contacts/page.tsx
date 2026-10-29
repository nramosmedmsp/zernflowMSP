import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { listCaseMembers } from "@/lib/actions/cases";
import {
  applyContactListQuery,
  contactListHref,
  contactListSelect,
  contactPageCount,
  parseContactListParams,
  type ContactQueryBuilder,
} from "@/components/contacts/contact-list-query";
import { ContactsView, type ContactWithTags } from "./contacts-view";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseContactListParams(await searchParams);
  const { workspace, supabase, role, user } = await getWorkspace();

  // Cliente del usuario: la RLS decide qué contactos ve. El filtrado, el orden
  // y la paginación ocurren en la base.
  const base = supabase
    .from("contacts")
    .select(contactListSelect(params), { count: "exact" })
    .eq("workspace_id", workspace.id);
  const listQuery = applyContactListQuery(base as unknown as ContactQueryBuilder, params);

  const [contactsRes, tagsRes, typesRes, teamsRes, membersRes] = await Promise.all([
    listQuery as unknown as PromiseLike<{ data: unknown[] | null; count: number | null; error: unknown }>,
    supabase.from("tags").select("*").eq("workspace_id", workspace.id).order("name"),
    supabase
      .from("contact_types")
      .select("id, name, color, archived_at")
      .eq("workspace_id", workspace.id)
      .order("position", { ascending: true }),
    supabase
      .from("teams")
      .select("id, name")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("name", { ascending: true }),
    listCaseMembers(),
  ]);

  const total = contactsRes.count ?? 0;
  const pages = contactPageCount(total);
  // Página fuera de rango (p. ej. tras filtrar): lleva a la última.
  if (params.page > pages) redirect(contactListHref({ ...params, page: pages }));

  const members = "members" in membersRes ? membersRes.members : [];
  // Un asesor solo ve sus contactos: no se le ofrecen otras personas como responsable.
  const supervises = !!members.find((m) => m.userId === user.id)?.teams.some((t) => t.role === "supervisor");
  const ownerOptions = isAdminRole(role) || supervises ? members : members.filter((m) => m.userId === user.id);

  return (
    <ContactsView
      contacts={(contactsRes.data ?? []) as unknown as ContactWithTags[]}
      total={total}
      params={params}
      tags={tagsRes.data ?? []}
      contactTypes={(typesRes.data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        archived: t.archived_at !== null,
      }))}
      teams={teamsRes.data ?? []}
      members={members.map((m) => ({ userId: m.userId, name: m.name }))}
      ownerOptions={ownerOptions.map((m) => ({ userId: m.userId, name: m.name }))}
      workspaceId={workspace.id}
      canImport={isAdminRole(role)}
    />
  );
}
