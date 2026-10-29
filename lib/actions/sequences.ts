"use server";

// Secuencias: solo Dueño o Administrador (docs/FASE-1-TECNICO.md 2.3); RLS
// (00019) lo exige también.

import { getWorkspace } from "@/lib/workspace";
import { revalidatePath } from "next/cache";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import { validateSequenceSteps } from "@/lib/broadcasts/sequence-step";
import { enrollInSequence } from "@/lib/sequences/enroll";
import { ensureStepIds } from "@/lib/sequences/steps";
import type { SequenceStep } from "@/lib/types/database";

const GENERIC_ERROR = "No se pudo completar la operación. Inténtalo de nuevo.";

export async function createSequence(name: string) {
  const { workspace, supabase, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  const trimmed = name.trim();
  if (!trimmed) return { error: "El nombre es obligatorio" };

  const { data, error } = await supabase
    .from("sequences")
    .insert({ workspace_id: workspace.id, name: trimmed })
    .select()
    .single();

  if (error) {
    console.error("[sequences] create", error.message);
    return { error: GENERIC_ERROR };
  }

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
  const { workspace, supabase, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  // Verificar que la secuencia pertenece al espacio de trabajo
  const { data: existing } = await supabase
    .from("sequences")
    .select("id, status, steps")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!existing) return { error: "No se encontró la secuencia" };

  // Una secuencia activa no puede tener pasos vacíos: fallaría con cada cliente sin enviar nada.
  const finalStatus = updates.status ?? existing.status;
  const finalSteps = updates.steps ?? ((existing.steps as unknown as SequenceStep[]) || []);
  if (finalStatus === "active") {
    const problem = validateSequenceSteps(finalSteps);
    if (problem) return { error: problem };
  }

  // Cada paso lleva un id estable: las inscripciones activas lo usan para seguir
  // en su paso aunque se agreguen, quiten o reordenen pasos (R2-B3).
  const stepsWithIds = updates.steps ? ensureStepIds(updates.steps) : undefined;
  if (stepsWithIds) await stampLegacyEnrollments(supabase, sequenceId, existing.steps, stepsWithIds);

  const { data, error } = await supabase
    .from("sequences")
    .update({
      ...updates,
      steps: stepsWithIds ? JSON.parse(JSON.stringify(stepsWithIds)) : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sequenceId)
    .select()
    .single();

  if (error) {
    console.error("[sequences] update", error.message);
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/sequences");
  revalidatePath(`/dashboard/sequences/${sequenceId}`);
  return { ok: true, sequence: data };
}

export async function deleteSequence(sequenceId: string) {
  const { workspace, supabase, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  const { error } = await supabase
    .from("sequences")
    .delete()
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[sequences] delete", error.message);
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/sequences");
  return { ok: true };
}

export async function enrollContact(
  sequenceId: string,
  contactId: string,
  channelId: string
) {
  const { workspace, supabase, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  // Verificar que la secuencia pertenece al espacio de trabajo
  const { data: sequence } = await supabase
    .from("sequences")
    .select("id, steps, status")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!sequence) return { error: "No se encontró la secuencia" };
  if (sequence.status !== "active") return { error: "La secuencia no está activa" };

  // El contacto y el canal tienen que ser de este espacio de trabajo.
  const [{ data: contact }, { data: channel }] = await Promise.all([
    supabase.from("contacts").select("id, is_subscribed").eq("id", contactId).eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("channels").select("id").eq("id", channelId).eq("workspace_id", workspace.id).maybeSingle(),
  ]);
  if (!contact) return { error: "No se encontró el contacto" };
  if (contact.is_subscribed === false) return { error: "El contacto canceló su suscripción y no puede recibir la secuencia" };
  if (!channel) return { error: "No se encontró el canal" };

  const steps = (sequence.steps as unknown as SequenceStep[]) || [];
  if (steps.length === 0) return { error: "La secuencia no tiene pasos" };

  const result = await enrollInSequence(supabase, {
    workspaceId: workspace.id,
    sequenceId,
    steps,
    contactId,
    channelId,
  });
  if (!result.ok) {
    if (result.reason === "already_active") return { error: "El contacto ya está inscrito en esta secuencia" };
    console.error("[sequences] enroll", result.error);
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/dashboard/sequences/${sequenceId}`);
  return { ok: true, reactivated: result.reactivated };
}

export async function cancelEnrollment(enrollmentId: string) {
  const { workspace, supabase, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

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

  if (error) {
    console.error("[sequences] cancel enrollment", error.message);
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/dashboard/sequences/${enrollment.sequence_id}`);
  return { ok: true };
}

/**
 * Inscripciones anteriores a los ids de paso (current_step_id vacío): se les
 * sella el id del paso en el que van para que esta edición no las desordene.
 * Si los pasos viejos ya tenían id se usa ese; si no, se asume que el paso en
 * esa posición sigue siendo el mismo en la lista nueva (edición sin reordenar).
 */
async function stampLegacyEnrollments(
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"],
  sequenceId: string,
  oldSteps: unknown,
  newSteps: readonly SequenceStep[],
) {
  const { data: legacy } = await supabase
    .from("sequence_enrollments")
    .select("id, current_step_index")
    .eq("sequence_id", sequenceId)
    .eq("status", "active")
    .is("current_step_id", null);
  if (!legacy || legacy.length === 0) return;
  const old = (Array.isArray(oldSteps) ? oldSteps : []) as SequenceStep[];
  for (const e of legacy) {
    const id = old[e.current_step_index]?.id ?? newSteps[e.current_step_index]?.id ?? null;
    if (!id) continue;
    await supabase.from("sequence_enrollments").update({ current_step_id: id }).eq("id", e.id);
  }
}
