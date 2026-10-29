import { createServiceClient } from "@/lib/supabase/server";
import {
  loadDeliveryContext,
  sendTemplateToContact,
  sendTextToContact,
  windowStateOf,
  type DeliveryResult,
} from "@/lib/broadcasts/delivery";
import { decideStepSend } from "@/lib/broadcasts/sequence-step";
import type { Json, SequenceStep } from "@/lib/types/database";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * Process all sequence enrollments that are due.
 * Called by the cron endpoint every 30-60 seconds.
 */
export async function processSequenceSteps() {
  const supabase = await createServiceClient();

  // Fetch enrollments that are due
  const { data: enrollments, error } = await supabase
    .from("sequence_enrollments")
    .select("*, sequences(*)")
    .eq("status", "active")
    .lte("next_step_at", new Date().toISOString())
    .limit(50);

  if (error || !enrollments) {
    console.error("Failed to fetch sequence enrollments:", error);
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const enrollment of enrollments) {
    try {
      // Dos pasadas del cron a la vez no deben enviar el mismo paso dos veces:
      // quien no logra tomar la inscripción la deja.
      if (!(await claimEnrollment(supabase, enrollment))) continue;
      await processEnrollment(supabase, enrollment);
      processed++;
    } catch (err) {
      console.error(
        `Failed to process enrollment ${enrollment.id}:`,
        err instanceof Error ? err.message : err
      );
      failed++;
    }
  }

  return { processed, failed, total: enrollments.length };
}

/** Si el proceso se cae a mitad de un paso, la inscripción vuelve a estar disponible pasado este tiempo. */
const LEASE_MS = 10 * 60 * 1000;

/**
 * Toma la inscripción con una actualización condicional: solo prospera si
 * sigue activa y con el mismo `next_step_at` con el que se leyó. Mientras dura
 * el paso, `next_step_at` queda movido al futuro (alquiler), así que otra
 * pasada del cron no la vuelve a ver como pendiente.
 */
async function claimEnrollment(supabase: ServiceClient, enrollment: { id: string; next_step_at: string | null }): Promise<boolean> {
  const { data, error } = await supabase
    .from("sequence_enrollments")
    .update({ next_step_at: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq("id", enrollment.id)
    .eq("status", "active")
    .eq("next_step_at", enrollment.next_step_at as string)
    .select("id");
  if (error) {
    console.error(`Failed to claim enrollment ${enrollment.id}:`, error.message);
    return false;
  }
  return !!data && data.length > 0;
}

async function processEnrollment(
  supabase: ServiceClient,
  enrollment: {
    id: string;
    sequence_id: string;
    contact_id: string;
    channel_id: string;
    current_step_index: number;
    next_step_at?: string | null;
    sequences: {
      id: string;
      workspace_id: string;
      steps: unknown;
      status: string;
    } | null;
  }
) {
  const sequence = enrollment.sequences;
  if (!sequence || sequence.status !== "active") {
    // Sequence was paused/deleted, cancel enrollment
    await supabase
      .from("sequence_enrollments")
      .update({ status: "cancelled" })
      .eq("id", enrollment.id);
    return;
  }

  // Un contacto que se dio de baja no recibe nada más de la secuencia.
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("is_subscribed")
    .eq("id", enrollment.contact_id)
    .eq("workspace_id", sequence.workspace_id)
    .maybeSingle();
  if (contactError) throw new Error(contactError.message);
  if (!contact || contact.is_subscribed === false) {
    await supabase.from("sequence_enrollments").update({ status: "cancelled", next_step_at: null }).eq("id", enrollment.id);
    return;
  }

  const steps = (sequence.steps as SequenceStep[]) || [];
  const stepIndex = enrollment.current_step_index;

  if (stepIndex >= steps.length) {
    // No more steps, complete the enrollment
    await supabase
      .from("sequence_enrollments")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", enrollment.id);
    return;
  }

  const currentStep = steps[stepIndex];

  if (currentStep.type === "message" || currentStep.type === "template") {
    // Comportamiento ante un paso fallido (igual que antes de la fase 2): el
    // fallo se registra (activity 'sequence_step_failed' con el motivo) y la
    // inscripción SIGUE con el paso siguiente; un paso fallido no detiene ni
    // cancela la secuencia.
    await runMessageStep(supabase, {
      enrollmentId: enrollment.id,
      sequenceId: sequence.id,
      workspaceId: sequence.workspace_id,
      contactId: enrollment.contact_id,
      channelId: enrollment.channel_id,
      stepIndex,
      step: currentStep,
    });
  }
  // Delay steps don't need action; they just waited until next_step_at

  // Advance to next step
  const nextIndex = stepIndex + 1;

  if (nextIndex >= steps.length) {
    // Completed
    await supabase
      .from("sequence_enrollments")
      .update({
        current_step_index: nextIndex,
        status: "completed",
        completed_at: new Date().toISOString(),
        next_step_at: null,
      })
      .eq("id", enrollment.id);
    return;
  }

  // Calculate next_step_at based on the next step
  const nextStep = steps[nextIndex];
  let nextStepAt: string;

  if (nextStep.type === "delay" && nextStep.delayMinutes) {
    nextStepAt = new Date(
      Date.now() + nextStep.delayMinutes * 60 * 1000
    ).toISOString();
  } else {
    // Next step is a message, execute it on the next cron tick
    nextStepAt = new Date().toISOString();
  }

  await supabase
    .from("sequence_enrollments")
    .update({
      current_step_index: nextIndex,
      next_step_at: nextStepAt,
    })
    .eq("id", enrollment.id);
}

interface MessageStepParams {
  enrollmentId: string;
  sequenceId: string;
  workspaceId: string;
  contactId: string;
  channelId: string;
  stepIndex: number;
  step: SequenceStep;
}

/**
 * Envía un paso de mensaje o de plantilla (docs/FASE-2-TECNICO.md 5). Decide
 * texto o plantilla según la ventana de 24 h (decideStepSend), revisa el
 * resultado del envío (el SDK no lanza) y, si falla, registra el motivo. Tras
 * un envío exitoso sella la salida del bot en la gestión abierta del contacto
 * (lo hace sendTextToContact / sendTemplateToContact). Nunca lanza.
 */
async function runMessageStep(supabase: ServiceClient, p: MessageStepParams): Promise<void> {
  try {
    const ctx = await loadDeliveryContext(supabase, {
      workspaceId: p.workspaceId,
      contactId: p.contactId,
      channelId: p.channelId,
    });
    const decision = decideStepSend(p.step, windowStateOf(ctx));

    if (decision.action === "fail") {
      await recordStepFailure(supabase, p, ctx.conversation?.id ?? null, decision.reason);
      return;
    }

    let result: DeliveryResult;
    let storedText: string;
    if (decision.action === "text") {
      storedText = decision.text;
      // La ventana ya se comprobó en la decisión.
      result = await sendTextToContact(supabase, ctx, decision.text);
    } else {
      storedText = `Plantilla: ${decision.template.template_name}`;
      result = await sendTemplateToContact(supabase, ctx, decision.template);
    }

    // Mensaje saliente en la conversación (si ya existe una).
    if (ctx.conversation) {
      await supabase.from("messages").insert({
        conversation_id: ctx.conversation.id,
        direction: "outbound",
        text: result.ok && result.text ? result.text : storedText,
        status: result.ok ? "sent" : "failed",
        platform_message_id: result.ok ? result.messageId : null,
      });
    }
    if (!result.ok) await recordStepFailure(supabase, p, ctx.conversation?.id ?? null, result.error);
  } catch (err) {
    console.error("Failed to send sequence step:", err);
    await recordStepFailure(supabase, p, null, "No se pudo enviar el paso por un error inesperado");
  }
}

async function recordStepFailure(
  supabase: ServiceClient,
  p: MessageStepParams,
  conversationId: string | null,
  reason: string
): Promise<void> {
  console.error(`Sequence ${p.sequenceId} step ${p.stepIndex + 1} failed for contact ${p.contactId}: ${reason}`);
  const { error } = await supabase.from("activity").insert({
    workspace_id: p.workspaceId,
    type: "sequence_step_failed",
    contact_id: p.contactId,
    conversation_id: conversationId,
    meta: {
      sequence_id: p.sequenceId,
      enrollment_id: p.enrollmentId,
      step_index: p.stepIndex,
      step_type: p.step.type,
      reason,
    } as unknown as Json,
  });
  if (error) console.error("Failed to record sequence step failure:", error.message);
}
