// Pausar o reanudar el bot en una conversación a mano (botón de la cabecera
// del chat en la bandeja). Sin validar permisos: eso lo hace la acción de
// servidor (lib/actions/cases.ts, setConversationBotPaused). El bot también se
// pausa solo cuando una persona responde (handleHumanOutbound) y se reanuda al
// quedar el contacto sin gestiones abiertas (resumeAutomationIfIdle).

import { cancelActiveSessions } from "@/lib/flow-engine/waiting-session";
import { GENERIC_ERROR, logActivity, type Db, type EngineResult } from "./io";

export async function setConversationBotPaused(
  db: Db,
  params: {
    workspaceId: string;
    conversationId: string;
    paused: boolean;
    actorId: string;
    /** Gestión desde la que se hace (queda en el registro de actividad). */
    caseId?: string | null;
  },
): Promise<EngineResult<{ paused: boolean; changed: boolean }>> {
  const { data: conversation } = await db
    .from("conversations")
    .select("id, contact_id, channel_id, is_automation_paused")
    .eq("id", params.conversationId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  if (!conversation) return { error: "Conversación no encontrada." };
  if (conversation.is_automation_paused === params.paused) {
    return { ok: true, paused: params.paused, changed: false };
  }

  const { error } = await db
    .from("conversations")
    .update({ is_automation_paused: params.paused })
    .eq("id", conversation.id)
    .eq("workspace_id", params.workspaceId);
  if (error) {
    console.error("[cases] set bot paused", error.message);
    return { error: GENERIC_ERROR };
  }

  // Pausar a mano también corta lo que el bot dejó esperando (M-11).
  if (params.paused) await cancelActiveSessions(db, { contactId: conversation.contact_id, channelIds: [conversation.channel_id] });

  await logActivity(db, {
    workspace_id: params.workspaceId,
    type: params.paused ? "automation_paused" : "automation_resumed",
    case_id: params.caseId ?? null,
    contact_id: conversation.contact_id,
    conversation_id: conversation.id,
    actor_id: params.actorId,
    from_value: params.paused ? "active" : "paused",
    to_value: params.paused ? "paused" : "active",
    meta: { source: "inbox" },
  });
  return { ok: true, paused: params.paused, changed: true };
}
