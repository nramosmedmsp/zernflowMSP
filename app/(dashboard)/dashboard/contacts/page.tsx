import { getWorkspace } from "@/lib/workspace";
import { listCaseMembers } from "@/lib/actions/cases";
import { ContactsView } from "./contacts-view";

export default async function ContactsPage() {
  const { workspace, supabase } = await getWorkspace();

  const [contactsRes, tagsRes, typesRes, teamsRes, membersRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("*, contact_tags(tag_id, tags(*))")
      .eq("workspace_id", workspace.id)
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .limit(500),
    supabase
      .from("tags")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("name"),
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

  const members = "members" in membersRes ? membersRes.members : [];

  return (
    <ContactsView
      contacts={contactsRes.data ?? []}
      tags={tagsRes.data ?? []}
      contactTypes={(typesRes.data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        archived: t.archived_at !== null,
      }))}
      teams={teamsRes.data ?? []}
      members={members.map((m) => ({ userId: m.userId, name: m.name }))}
      workspaceId={workspace.id}
    />
  );
}
