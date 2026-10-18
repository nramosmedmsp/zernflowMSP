import type { Metadata } from "next";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { TemplatesView } from "./templates-view";

export const metadata: Metadata = { title: "Plantillas de WhatsApp" };

export default async function WhatsAppTemplatesPage() {
  const { workspace, role, supabase } = await getWorkspace();

  // Canales de WhatsApp conectados (RLS: cualquier miembro los ve).
  const { data: channels } = await supabase
    .from("channels")
    .select("id, display_name, username")
    .eq("workspace_id", workspace.id)
    .eq("platform", "whatsapp")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  return (
    <TemplatesView
      channels={(channels ?? []).map((c) => ({
        id: c.id,
        name: c.display_name || c.username || "WhatsApp",
      }))}
      canCreate={isAdminRole(role)}
    />
  );
}
