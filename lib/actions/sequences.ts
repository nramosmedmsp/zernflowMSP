"use server";

import { getWorkspace } from "@/lib/workspace";
import { revalidatePath } from "next/cache";
import type { SequenceStep } from "@/lib/types/database";

export async function createSequence(name: string) {
  const { workspace, supabase } = await getWorkspace();

  const trimmed = name.trim();
  if (!trimmed) return { error: "El nombre es obligatorio" };

  const { data, error } = await supabase
    .from("sequences")
    .insert({ workspace_id: workspace.id, name: trimmed })
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/dashboard/sequences");
  return { ok: true, sequence: data };
}

export async function updateSequence(
  sequenceId: string,
  updates: {
    name?: string;
    description?: string | null;
    steps?: SequenceStep[];
    status?: "draft" | "active" | "paused";
  }
) {
  const { workspace, supabase } = await getWorkspace();

  // Verificar que la secuencia pertenece al espacio de trabajo
  const { data: existing } = await supabase
    .from("sequences")
    .select("id")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!existing) return { error: "No se encontró la secuencia" };

  const { data, error } = await supabase
    .from("sequences")
    .update({
      ...updates,
      steps: updates.steps ? JSON.parse(JSON.stringify(updates.steps)) : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sequenceId)
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/dashboard/sequences");
  revalidatePath(`/dashboard/sequences/${sequenceId}`);
  return { ok: true, sequence: data };
}

export async function deleteSequence(sequenceId: string) {
  const { workspace, supabase } = await getWorkspace();

  const { error } = await supabase
    .from("sequences")
    .delete()
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/sequences");
  return { ok: true };
}

export async function enrollContact(
  sequenceId: string,
  contactId: string,
  channelId: string
) {
  const { workspace, supabase } = await getWorkspace();

  // Verificar que la secuencia pertenece al espacio de trabajo
  const { data: sequence } = await supabase
    .from("sequences")
    .select("id, steps, status")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!sequence) return { error: "No se encontró la secuencia" };
  if (sequence.status !== "active") return { error: "La secuencia no está activa" };

  const steps = (sequence.steps as unknown as SequenceStep[]) || [];
  if (steps.length === 0) return { error: "La secuencia no tiene pasos" };

  // Calcular next_step_at según el primer paso
  let nextStepAt: string;
  const firstStep = steps[0];
  if (firstStep.type === "delay" && firstStep.delayMinutes) {
    nextStepAt = new Date(
      Date.now() + firstStep.delayMinutes * 60 * 1000
    ).toISOString();
  } else {
    // Paso de mensaje: se ejecuta de inmediato
    nextStepAt = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("sequence_enrollments")
    .insert({
      sequence_id: sequenceId,
      contact_id: contactId,
      channel_id: channelId,
      next_step_at: nextStepAt,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "El contacto ya está inscrito en esta secuencia" };
    }
    return { error: error.message };
  }

  revalidatePath(`/dashboard/sequences/${sequenceId}`);
  return { ok: true, enrollment: data };
}

export async function cancelEnrollment(enrollmentId: string) {
  const { workspace, supabase } = await getWorkspace();

  // Verificar que la inscripción pertenece a una secuencia de este espacio de trabajo
  const { data: enrollment } = await supabase
    .from("sequence_enrollments")
    .select("id, sequence_id, sequences!inner(workspace_id)")
    .eq("id", enrollmentId)
    .single();

  if (!enrollment) return { error: "No se encontró la inscripción" };

  const seq = enrollment.sequences as unknown as { workspace_id: string };
  if (seq.workspace_id !== workspace.id) {
    return { error: "No se encontró la inscripción" };
  }

  const { error } = await supabase
    .from("sequence_enrollments")
    .update({ status: "cancelled" })
    .eq("id", enrollmentId);

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/sequences/${enrollment.sequence_id}`);
  return { ok: true };
}
