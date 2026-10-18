// Respuesta fuera de horario (docs/FASE-2-TECNICO.md 3.2). La llama
// handleInbound: si la respuesta está activa y el mensaje llega con el equipo
// de la gestión cerrado, se envía el texto en la misma conversación (la
// ventana de 24 h está abierta porque el cliente acaba de escribir), una vez
// por gestión o de nuevo si pasaron `min_hours_between` horas.

import { formatOpening, isWithinHours } from "@/lib/business-hours";
import { messagePreview } from "@/lib/message-preview";
import { applyReplyVariables } from "@/lib/saved-replies";
import { loadAssignmentContext, type AssignmentContextCache } from "./assign";
import { nextOpeningFor, scheduleForTeam } from "./hours";
import { botOutboundPatch } from "./rules";
import { loadCase, logActivity, type Db } from "./io";
import { zernioMessenger, type CaseMessenger } from "./messaging";

export type OffHoursReplyOutcome =
  | { status: "sent"; text: string }
  | {
      status: "skipped";
      reason: "disabled" | "not_open" | "within_hours" | "already_sent" | "no_conversation" | "race";
    }
  | { status: "failed"; error: string };

const HOUR_MS = 3_600_000;

/**
 * Reemplaza {apertura} (próxima apertura, p. ej. "lunes 9:00") y las
 * variables de las respuestas guardadas: {nombre}, {empresa} y {sede}.
 */
export function renderOffHoursReply(
  text: string,
  vars: { contactName?: string | null; workspaceName?: string | null; teamName?: string | null; opening: Date | null; now: Date },
): string {
  const apertura = vars.opening ? formatOpening(vars.opening, vars.now) : "pronto";
  return applyReplyVariables(text.replace(/\{apertura\}/gi, apertura), {
    contactName: vars.contactName ?? undefined,
    workspaceName: vars.workspaceName ?? undefined,
    teamName: vars.teamName ?? undefined,
  }).trim();
}

/** ¿Toca enviar? (sin E/S): nunca enviada, o pasaron las horas mínimas. */
export function offHoursReplyDue(lastSentAt: string | null, minHoursBetween: number | null, at: string): boolean {
  if (!lastSentAt) return true;
  if (!minHoursBetween) return false;
  return new Date(at).getTime() - new Date(lastSentAt).getTime() >= minHoursBetween * HOUR_MS;
}

export async function sendOffHoursReply(
  db: Db,
  params: {
    caseId: string;
    conversationId?: string | null;
    at: string;
    messenger?: CaseMessenger;
    cache?: AssignmentContextCache;
  },
): Promise<OffHoursReplyOutcome> {
  const row = await loadCase(db, params.caseId);
  if (!row || row.status !== "open") return { status: "skipped", reason: "not_open" };

  const ctx = await loadAssignmentContext(db, row.workspace_id, params.cache);
  const reply = ctx.hours.offHoursReply;
  if (!reply?.enabled || !reply.text) return { status: "skipped", reason: "disabled" };

  const schedule = scheduleForTeam(ctx.hours, row.team_id);
  if (isWithinHours(params.at, schedule.hours, schedule.holidays)) {
    return { status: "skipped", reason: "within_hours" };
  }
  const previous = row.off_hours_reply_sent_at;
  if (!offHoursReplyDue(previous, reply.min_hours_between, params.at)) {
    return { status: "skipped", reason: "already_sent" };
  }

  if (!params.conversationId) return { status: "skipped", reason: "no_conversation" };
  const { data: conversation } = await db
    .from("conversations")
    .select("id, channel_id, late_conversation_id")
    .eq("id", params.conversationId)
    .eq("contact_id", row.contact_id)
    .maybeSingle();
  if (!conversation?.late_conversation_id) return { status: "skipped", reason: "no_conversation" };
  const [{ data: channel }, { data: contact }] = await Promise.all([
    db.from("channels").select("late_account_id").eq("id", conversation.channel_id).maybeSingle(),
    db.from("contacts").select("display_name").eq("id", row.contact_id).maybeSingle(),
  ]);
  if (!channel?.late_account_id) return { status: "skipped", reason: "no_conversation" };

  // Reclamo condicional: dos mensajes seguidos no envían dos respuestas.
  let claim = db.from("cases").update({ off_hours_reply_sent_at: params.at }).eq("id", row.id);
  claim = previous ? claim.eq("off_hours_reply_sent_at", previous) : claim.is("off_hours_reply_sent_at", null);
  const { data: claimed, error: claimError } = await claim.select("id");
  if (claimError) {
    console.error("[cases] off hours claim", claimError.message);
    return { status: "failed", error: claimError.message };
  }
  if (!claimed || claimed.length === 0) return { status: "skipped", reason: "race" };

  const now = new Date(params.at);
  const text = renderOffHoursReply(reply.text, {
    contactName: contact?.display_name,
    workspaceName: ctx.hours.workspaceName,
    teamName: row.team_id ? ctx.hours.teamNames.get(row.team_id) : null,
    opening: nextOpeningFor(ctx.hours, row.team_id, now),
    now,
  });

  const messenger = params.messenger ?? zernioMessenger(db);
  const sent = await messenger.sendText({
    workspaceId: row.workspace_id,
    lateConversationId: conversation.late_conversation_id,
    lateAccountId: channel.late_account_id,
    text,
  });
  if (!sent.ok) {
    // Se libera el sello para que el próximo mensaje lo intente de nuevo.
    await db
      .from("cases")
      .update({ off_hours_reply_sent_at: previous })
      .eq("id", row.id)
      .eq("off_hours_reply_sent_at", params.at);
    console.error("[cases] off hours reply", sent.error);
    return { status: "failed", error: sent.error };
  }

  // Salida del bot: sella last_outbound_at sin tocar la espera del cliente.
  const { error: stampError } = await db.from("cases").update(botOutboundPatch(params.at)).eq("id", row.id);
  if (stampError) console.error("[cases] off hours stamp", stampError.message);
  await db
    .from("conversations")
    .update({ last_message_at: params.at, last_message_preview: messagePreview(text) })
    .eq("id", conversation.id);
  await logActivity(db, {
    workspace_id: row.workspace_id,
    type: "off_hours_reply_sent",
    case_id: row.id,
    contact_id: row.contact_id,
    conversation_id: conversation.id,
    meta: { text, message_id: sent.messageId, previous_sent_at: previous },
  });
  return { status: "sent", text };
}
