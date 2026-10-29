import { createServiceClient } from "@/lib/supabase/server";
import {
  loadDeliveryContext,
  sendTemplateToContact,
  sendTextToContact,
  windowStateOf,
  type DeliveryResult,
} from "@/lib/broadcasts/delivery";
import { decideStepSend } from "@/lib/broadcasts/sequence-step";
import { isDemoChannel } from "@/lib/demo";
import { messagePreview } from "@/lib/message-preview";
import { loadStepSchedule } from "@/lib/sequences/schedule";
import {
  SEQUENCE_ORIGIN_PREFIX,
  isSendStep,
  nextSendTime,
  resolveStepIndex,
  stepDueAt,
  type StepSchedule,
} from "@/lib/sequences/steps";
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
  const schedules = new ScheduleCache(supabase);

  for (const enrollment of enrollments) {
    try {
      // Dos pasadas del cron a la vez no deben enviar el mismo paso dos veces:
      // quien no logra tomar la inscripción la deja.
      if (!(await claimEnrollment(supabase, enrollment))) continue;
      await processEnrollment(supabase, enrollment, schedules);
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

/** Horario de atención por empresa, leído una sola vez por pasada del cron. */
class ScheduleCache {
  private cache = new Map<string, Promise<StepSchedule | null>>();
  constructor(private db: ServiceClient) {}
  get(workspaceId: string): Promise<StepSchedule | null> {
    let hit = this.cache.get(workspaceId);
    if (!hit) {
      hit = loadStepSchedule(this.db, workspaceId);
      this.cache.set(workspaceId, hit);
    }
    return hit;
  }
}

/** Una secuencia en pausa (o en borrador) no avanza: se vuelve a mirar en este tiempo. */
const PAUSED_RECHECK_MS = 5 * 60 * 1000;

async function processEnrollment(
  supabase: ServiceClient,
  enrollment: {
    id: string;
    sequence_id: string;
    contact_id: string;
    channel_id: string;
    current_step_index: number;
    current_step_id?: string | null;
    next_step_at?: string | null;
    sequences: {
      id: string;
      workspace_id: string;
      name?: string | null;
      steps: unknown;
      status: string;
    } | null;
  },
  schedules: ScheduleCache,
) {
  const sequence = enrollment.sequences;
  if (!sequence) {
    // La secuencia se borró.
    await supabase
      .from("sequence_enrollments")
      .update({ status: "cancelled", next_step_at: null })
      .eq("id", enrollment.id);
    return;
  }
  if (sequence.status !== "active") {
    // En pausa (o de vuelta a borrador): la inscripción se conserva tal cual y
    // sigue donde iba cuando la secuencia se active otra vez (R2-B1).
    await supabase
      .from("sequence_enrollments")
      .update({ next_step_at: new Date(Date.now() + PAUSED_RECHECK_MS).toISOString() })
      .eq("id", enrollment.id)
      .eq("status", "active");
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
  // Los pasos se pueden haber editado desde que la persona entró: se busca su
  // paso por id y no por posición (R2-B3).
  const stepIndex = resolveStepIndex(steps, enrollment);

  if (stepIndex >= steps.length) {
    // No more steps, complete the enrollment
    await supabase
      .from("sequence_enrollments")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        next_step_at: null,
      })
      .eq("id", enrollment.id);
    return;
  }

  const currentStep = steps[stepIndex];
  const schedule = await schedules.get(sequence.workspace_id);
  const now = new Date();

  // Fuera del horario de atención no se manda nada: el paso espera a la próxima
  // hora hábil (R2-B20). Las esperas sí corren en horas de reloj.
  if (isSendStep(currentStep)) {
    const sendAt = nextSendTime(now, schedule);
    if (sendAt.getTime() > now.getTime()) {
      await rescheduleEnrollment(supabase, enrollment.id, sendAt);
      return;
    }
  }

  // Se avanza ANTES de enviar (y se comprueba): si el avance no se pudo guardar
  // no se envía nada y no se repite el paso; si el proceso se cae a mitad de
  // envío, ese paso no se vuelve a mandar (R2-B19).
  const nextIndex = stepIndex + 1;
  const nextStep = steps[nextIndex];
  const advance =
    nextIndex >= steps.length
      ? {
          current_step_index: nextIndex,
          current_step_id: null,
          status: "completed" as const,
          completed_at: now.toISOString(),
          next_step_at: null,
        }
      : {
          current_step_index: nextIndex,
          current_step_id: nextStep.id ?? null,
          next_step_at: stepDueAt(nextStep, now, schedule).toISOString(),
        };
  const { data: advanced, error: advanceError } = await supabase
    .from("sequence_enrollments")
    .update(advance)
    .eq("id", enrollment.id)
    .eq("status", "active")
    .select("id");
  if (advanceError) throw new Error(`No se pudo avanzar la inscripción: ${advanceError.message}`);
  // La cancelaron mientras tanto: no se envía.
  if (!advanced || advanced.length === 0) return;

  if (isSendStep(currentStep)) {
    // Comportamiento ante un paso fallido (igual que antes de la fase 2): el
    // fallo se registra (activity 'sequence_step_failed' con el motivo) y la
    // inscripción SIGUE con el paso siguiente; un paso fallido no detiene ni
    // cancela la secuencia.
    await runMessageStep(supabase, {
      enrollmentId: enrollment.id,
      sequenceId: sequence.id,
      sequenceName: sequence.name ?? null,
      workspaceId: sequence.workspace_id,
      contactId: enrollment.contact_id,
      channelId: enrollment.channel_id,
      stepIndex,
      step: currentStep,
    });
  }
  // Las esperas no hacen nada: solo esperaron hasta next_step_at.
}

async function rescheduleEnrollment(supabase: ServiceClient, enrollmentId: string, at: Date): Promise<void> {
  const { error } = await supabase
    .from("sequence_enrollments")
    .update({ next_step_at: at.toISOString() })
    .eq("id", enrollmentId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
}

interface MessageStepParams {
  enrollmentId: string;
  sequenceId: string;
  sequenceName?: string | null;
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
      const shownText = result.ok && result.text ? result.text : storedText;
      // Origen visible en el chat: "Secuencia · nombre" (R2-B5).
      const origin = `${SEQUENCE_ORIGIN_PREFIX}${p.sequenceName?.trim() || "Secuencia"}`;
      if (isDemoChannel(ctx.channel) && result.ok && result.messageId) {
        // B-18: en canales de prueba el mensajero ya guardó el mensaje: solo se
        // le pone el origen, sin insertar un segundo (que se veía duplicado).
        await supabase.from("messages").update({ sent_by_node_id: origin }).eq("id", result.messageId);
      } else {
        await supabase.from("messages").insert({
          conversation_id: ctx.conversation.id,
          direction: "outbound",
          text: shownText,
          status: result.ok ? "sent" : "failed",
          platform_message_id: result.ok ? result.messageId : null,
          sent_by_node_id: origin,
        });
      }
      // La conversación sube en la lista y el chat abierto se refresca.
      const { error: touchError } = await supabase
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          ...(result.ok ? { last_message_preview: messagePreview(shownText) } : {}),
        })
        .eq("id", ctx.conversation.id);
      if (touchError) console.error("[sequences] no se pudo actualizar la conversación:", touchError.message);
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
