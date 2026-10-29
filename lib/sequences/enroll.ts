// Inscribir a un contacto en una secuencia (desde la pantalla y desde un flujo).
// Un contacto puede volver a entrar cuando su inscripción anterior terminó o
// se canceló: se reactiva esa misma fila (la tabla tiene UNIQUE(secuencia, contacto)).

import type { Db } from "@/lib/cases/io";
import type { Json, SequenceStep } from "@/lib/types/database";
import { loadStepSchedule } from "./schedule";
import { stepDueAt } from "./steps";

export type EnrollResult =
  | { ok: true; reactivated: boolean }
  | { ok: false; reason: "already_active" | "no_steps" | "error"; error?: string };

export async function enrollInSequence(
  db: Db,
  p: { workspaceId: string; sequenceId: string; steps: readonly SequenceStep[]; contactId: string; channelId: string; now?: Date },
): Promise<EnrollResult> {
  if (p.steps.length === 0) return { ok: false, reason: "no_steps" };
  const now = p.now ?? new Date();
  const first = p.steps[0];
  const schedule = await loadStepSchedule(db, p.workspaceId);
  const fields = {
    channel_id: p.channelId,
    current_step_index: 0,
    current_step_id: first.id ?? null,
    status: "active" as const,
    enrolled_at: now.toISOString(),
    next_step_at: stepDueAt(first, now, schedule).toISOString(),
    completed_at: null,
  };

  const { data: existing, error: readError } = await db
    .from("sequence_enrollments")
    .select("id, status")
    .eq("sequence_id", p.sequenceId)
    .eq("contact_id", p.contactId)
    .maybeSingle();
  if (readError) return { ok: false, reason: "error", error: readError.message };

  if (existing) {
    if (existing.status === "active") return { ok: false, reason: "already_active" };
    // Solo si sigue sin estar activa: dos altas a la vez no la reinician dos veces.
    const { data: updated, error } = await db
      .from("sequence_enrollments")
      .update(fields)
      .eq("id", existing.id)
      .neq("status", "active")
      .select("id");
    if (error) return { ok: false, reason: "error", error: error.message };
    if (!updated || updated.length === 0) return { ok: false, reason: "already_active" };
    await logEnrollment(db, p, existing.id, true);
    return { ok: true, reactivated: true };
  }

  const { data: created, error } = await db
    .from("sequence_enrollments")
    .insert({ sequence_id: p.sequenceId, contact_id: p.contactId, ...fields })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, reason: "already_active" };
    return { ok: false, reason: "error", error: error.message };
  }
  await logEnrollment(db, p, created?.id ?? null, false);
  return { ok: true, reactivated: false };
}

async function logEnrollment(
  db: Db,
  p: { workspaceId: string; sequenceId: string; contactId: string },
  enrollmentId: string | null,
  reactivated: boolean,
): Promise<void> {
  const { error } = await db.from("activity").insert({
    workspace_id: p.workspaceId,
    type: reactivated ? "sequence_reenrolled" : "sequence_enrolled",
    contact_id: p.contactId,
    meta: { sequence_id: p.sequenceId, enrollment_id: enrollmentId } as unknown as Json,
  });
  if (error) console.error("[sequences] activity", error.message);
}
