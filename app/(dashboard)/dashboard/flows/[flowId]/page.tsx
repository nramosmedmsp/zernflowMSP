import { getWorkspace } from "@/lib/workspace";
import { notFound } from "next/navigation";
import { FlowCanvas } from "@/components/flow-builder/flow-canvas";
import { TemplateNotesBanner } from "@/components/flow-builder/template-notes-banner";

export default async function FlowEditorPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  const { workspace, supabase } = await getWorkspace();

  const { data: flow } = await supabase
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!flow) {
    notFound();
  }

  return (
    <div className="flex h-full flex-col">
      <TemplateNotesBanner flowId={flow.id} />
      <div className="min-h-0 flex-1">
        <FlowCanvas flow={flow} />
      </div>
    </div>
  );
}
