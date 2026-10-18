import { getWorkspace } from "@/lib/workspace";
import { notFound } from "next/navigation";
import { SequenceEditor } from "@/components/sequences/sequence-editor";
import { EnrollmentList } from "@/components/sequences/enrollment-list";
import type { SequenceStep } from "@/lib/types/database";

export default async function SequenceDetailPage({
  params,
}: {
  params: Promise<{ sequenceId: string }>;
}) {
  const { sequenceId } = await params;
  const { workspace, supabase } = await getWorkspace();

  const { data: sequence } = await supabase
    .from("sequences")
    .select("*")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!sequence) {
    notFound();
  }

  const { data: enrollments } = await supabase
    .from("sequence_enrollments")
    .select("*, contacts(display_name, email)")
    .eq("sequence_id", sequenceId)
    .order("enrolled_at", { ascending: false });

  // Pasos que fallaron (p. ej. ventana de 24 h cerrada sin plantilla): el último por inscripción.
  const { data: failures } = await supabase
    .from("activity")
    .select("created_at, meta")
    .eq("workspace_id", workspace.id)
    .eq("type", "sequence_step_failed")
    .eq("meta->>sequence_id", sequenceId)
    .order("created_at", { ascending: false })
    .limit(500);
  const lastFailure = new Map<string, { stepIndex: number; reason: string; at: string }>();
  for (const f of failures ?? []) {
    const meta = f.meta as { enrollment_id?: string; step_index?: number; reason?: string } | null;
    if (!meta?.enrollment_id || lastFailure.has(meta.enrollment_id)) continue;
    lastFailure.set(meta.enrollment_id, {
      stepIndex: meta.step_index ?? 0,
      reason: meta.reason ?? "",
      at: f.created_at,
    });
  }

  return (
    <div className="flex h-full flex-col">
      <SequenceEditor
        workspaceId={workspace.id}
        sequence={{
          id: sequence.id,
          name: sequence.name,
          description: sequence.description,
          status: sequence.status as "draft" | "active" | "paused",
          steps: (sequence.steps as unknown as SequenceStep[]) || [],
        }}
      />
      <div className="border-t border-border">
        <EnrollmentList
          enrollments={
            (enrollments ?? []).map((e) => ({
              id: e.id,
              contactName:
                (e.contacts as { display_name: string | null; email: string | null } | null)
                  ?.display_name ||
                (e.contacts as { display_name: string | null; email: string | null } | null)
                  ?.email ||
                "Desconocido",
              currentStepIndex: e.current_step_index,
              status: e.status as "active" | "completed" | "cancelled",
              enrolledAt: e.enrolled_at,
              lastFailure: lastFailure.get(e.id) ?? null,
            }))
          }
        />
      </div>
    </div>
  );
}
