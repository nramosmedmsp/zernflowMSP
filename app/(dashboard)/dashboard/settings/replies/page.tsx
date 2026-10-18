import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { listSavedReplies } from "@/lib/actions/saved-replies";
import { RepliesView } from "./replies-view";

export const metadata: Metadata = { title: "Respuestas guardadas" };

export default async function RepliesSettingsPage() {
  const { workspace, supabase } = await getWorkspace();
  const result = await listSavedReplies();

  if ("error" in result) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-8 py-6">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/settings"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Volver a Configuración"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-2xl font-bold">Respuestas guardadas</h1>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-md px-8 text-center text-sm text-muted-foreground">{result.error}</p>
      </div>
    );
  }

  // Campos personalizados para el botón de variables (`{campo:slug}`).
  const { data: fields } = await supabase
    .from("custom_field_definitions")
    .select("name, slug")
    .eq("workspace_id", workspace.id)
    .order("name", { ascending: true });

  return <RepliesView data={result.data} customFields={fields ?? []} />;
}
