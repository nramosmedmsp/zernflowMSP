import { getWorkspace } from "@/lib/workspace";
import { canManageTeam } from "@/lib/team-rules";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  const { workspace, role } = await getWorkspace();

  return (
    <SettingsView
      canManageTeam={canManageTeam(role)}
      workspace={{
        id: workspace.id,
        name: workspace.name,
        hasApiKey: !!workspace.late_api_key_encrypted,
        hasAiKey: !!workspace.ai_api_key,
        globalKeywords: (workspace.global_keywords as string[]) ?? [],
      }}
    />
  );
}
