"use server";

// Secuencias: solo Dueño o Administrador (docs/FASE-1-TECNICO.md 2.3); RLS
// (00019) lo exige también.

import { getWorkspace } from "@/lib/workspace";
import { auditAction } from "@/lib/audit-server";
import { revalidatePath } from "next/cache";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import { validateSequenceSteps } from "@/lib/broadcasts/sequence-step";
import { enrollInSequence } from "@/lib/sequences/enroll";
import { ENROLL_CHANNEL_NOT_CONTACT_MESSAGE, contactEnrollGate, sequenceEnrollGate } from "@/lib/sequences/enroll-gate";
import { ensureStepIds } from "@/lib/sequences/steps";
import type { SequenceStep } from "@/lib/types/database";

const GENERIC_ERROR = "No se pudo completar la operación. Inténtalo de nuevo.";

export async function createSequence(name: string) {
  const { workspace, supabase, role, user } = await getWorkspace();
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

  await auditAction({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "sequence_created",
    entity: "sequence",
    toValue: trimmed,
    meta: { name: trimmed },
  });

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
  const { workspace, supabase, role, user } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  // Verificar que la secuencia pertenece al espacio de trabajo
  const { data: existing } = await supabase
    .from("sequences")
    .select("id, name, description, status, steps")
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

  await auditSequenceChange(workspace.id, user.id, existing, updates, stepsWithIds);

  revalidatePath("/dashboard/sequences");
  revalidatePath(`/dashboard/sequences/${sequenceId}`);
  return { ok: true, sequence: data };
}

export async function deleteSequence(sequenceId: string) {
  const { workspace, supabase, role, user } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  // Se lee antes de borrar para que el registro diga cuál secuencia fue.
  const { data: before } = await supabase
    .from("sequences")
    .select("name")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  const { error } = await supabase
    .from("sequences")
    .delete()
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[sequences] delete", error.message);
    return { error: GENERIC_ERROR };
  }

  if (before) {
    await auditAction({
      workspaceId: workspace.id,
      actorId: user.id,
      action: "sequence_deleted",
      entity: "sequence",
      fromValue: before.name,
      meta: { name: before.name },
    });
  }

  revalidatePath("/dashboard/sequences");
  return { ok: true };
}

export async function enrollContact(
  sequenceId: string,
  contactId: string,
  channelId: string
) {
  const { workspace, supabase, role, user } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };

  // Verificar que la secuencia pertenece al espacio de trabajo
  const { data: sequence } = await supabase
    .from("sequences")
    .select("id, name, steps, status")
    .eq("id", sequenceId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!sequence) return { error: "No se encontró la secuencia" };
  const steps = (sequence.steps as unknown as SequenceStep[]) || [];
  const sequenceGate = sequenceEnrollGate({ status: sequence.status, stepCount: steps.length });
  if (!sequenceGate.ok) {
    return { error: sequenceGate.reason === "not_active" ? "La secuencia no está activa" : "La secuencia no tiene pasos" };
  }

  // El contacto y el canal tienen que ser de este espacio de trabajo.
  const [{ data: contact }, { data: channel }] = await Promise.all([
    supabase.from("contacts").select("id, is_subscribed, marketing_status, erased_at").eq("id", contactId).eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("channels").select("id").eq("id", channelId).eq("workspace_id", workspace.id).maybeSingle(),
  ]);
  if (!contact) return { error: "No se encontró el contacto" };
  const contactGate = contactEnrollGate(contact);
  if (!contactGate.ok) return { error: contactGate.message };
  if (!channel) return { error: "No se encontró el canal" };

  // Y el canal tiene que ser uno por el que este contacto escribió (no el de otro cliente).
  const { data: link } = await supabase
    .from("contact_channels")
    .select("id")
    .eq("contact_id", contactId)
    .eq("channel_id", channelId)
    .limit(1)
    .maybeSingle();
  if (!link) return { error: ENROLL_CHANNEL_NOT_CONTACT_MESSAGE };

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

  // Registro de cambios: quién inscribió a mano y en qué secuencia (el cliente queda en su
  // propio historial con «sequence_enrolled»; aquí no se guardan sus datos).
  await auditAction({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "sequence_contact_enrolled",
    entity: "sequence",
    toValue: sequence.name,
    meta: { name: sequence.name, reactivated: result.reactivated },
  });

  revalidatePath(`/dashboard/sequences/${sequenceId}`);
  revalidatePath(`/dashboard/contacts/${contactId}`);
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

/** Pasos sin el id estable ni el texto: solo importa si cambió la lista (para no anotar un cambio falso). */
function stepsSignature(steps: unknown): string {
  const list = (Array.isArray(steps) ? steps : []) as SequenceStep[];
  return JSON.stringify(list.map((st) => [st.type, st.content ?? null, st.delayMinutes ?? null, st.template ?? null]));
}

/**
 * Registro de cambios de una secuencia: activar o pausar, y editar nombre, descripción o pasos.
 * Del contenido solo se anota cuántos pasos había y cuántos hay (nunca el texto de un paso).
 */
async function auditSequenceChange(
  workspaceId: string,
  actorId: string,
  before: { name: string; description: string | null; status: string; steps: unknown },
  updates: { name?: string; description?: string | null; steps?: SequenceStep[]; status?: "draft" | "active" | "paused" },
  newSteps: readonly SequenceStep[] | undefined,
): Promise<void> {
  const name = updates.name?.trim() || before.name;
  const fields: string[] = [];
  if (updates.name !== undefined && updates.name.trim() !== before.name) fields.push("nombre");
  if (updates.description !== undefined && (updates.description ?? "") !== (before.description ?? "")) fields.push("descripción");
  const meta: Record<string, string | number> = { name };
  if (newSteps && stepsSignature(newSteps) !== stepsSignature(before.steps)) {
    fields.push("pasos");
    meta.steps_from = Array.isArray(before.steps) ? before.steps.length : 0;
    meta.steps_to = newSteps.length;
  }
  if (updates.status !== undefined && updates.status !== before.status) {
    const action = updates.status === "active" ? "sequence_activated" : updates.status === "paused" ? "sequence_paused" : null;
    if (action) {
      await auditAction({ workspaceId, actorId, action, entity: "sequence", fromValue: before.status, toValue: updates.status, meta: { name } });
    } else {
      fields.push("estado");
    }
  }
  if (fields.length > 0) {
    await auditAction({
      workspaceId,
      actorId,
      action: "sequence_edited",
      entity: "sequence",
      fromValue: updates.name !== undefined && updates.name.trim() !== before.name ? before.name : null,
      toValue: updates.name !== undefined && updates.name.trim() !== before.name ? updates.name.trim() : null,
      meta: { ...meta, fields: fields.join(", ") },
    });
  }
}
