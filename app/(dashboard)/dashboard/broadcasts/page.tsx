import { getWorkspace } from "@/lib/workspace";
import { BroadcastsView } from "./broadcasts-view";

export default async function BroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, supabase } = await getWorkspace();

  const { data: broadcasts } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  // Un aviso (por ejemplo, «Una difusión se pausó sola») abre directamente esa difusión.
  const wanted = (await searchParams).broadcast;
  const initialSelectedId =
    typeof wanted === "string" && (broadcasts ?? []).some((b) => b.id === wanted) ? wanted : null;

  return (
    <BroadcastsView
      broadcasts={broadcasts ?? []}
      workspaceId={workspace.id}
      initialSelectedId={initialSelectedId}
    />
  );
}
