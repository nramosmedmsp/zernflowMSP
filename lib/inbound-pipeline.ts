// Lo que sigue a guardar un mensaje entrante (contacto y conversación ya
// guardados): motor de gestiones y flujos. Lo comparten el webhook de Zernio
// (app/api/webhooks/late/route.ts) y la simulación de mensajes de canales de
// prueba (lib/actions/demo.ts), para que se comporten igual.

import type { SupabaseClient } from "@supabase/supabase-js";
import { handleInbound } from "@/lib/cases";
import { executeFlow } from "@/lib/flow-engine/engine";
import { matchTrigger } from "@/lib/flow-engine/trigger-matcher";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;
type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];

export interface InboundPipelineInput {
  channel: ChannelRow;
  contactId: string;
  conversation: { id: string; is_automation_paused: boolean };
  /** Primer mensaje del contacto en el canal (dispara el flujo de bienvenida). */
  isFirstMessage: boolean;
  message: {
    text?: string | null;
    postbackPayload?: string;
    quickReplyPayload?: string;
    callbackData?: string;
    sender: { id: string; name: string; username?: string | null };
  };
  lateConversationId: string;
  lateAccountId: string;
  /** Fecha del mensaje (ISO); por defecto ahora. */
  at?: string;
}

export async function runInboundPipeline(supabase: Db, input: InboundPipelineInput): Promise<void> {
  const { channel, contactId, conversation, message: msg } = input;

  // ── Gestiones (docs/FASE-1-TECNICO.md 3.1) ───────────────────────────────
  // Abre o retoma la gestión del contacto y la reparte. Un fallo aquí no debe
  // impedir que corran los flujos.
  try {
    await handleInbound(supabase, {
      workspaceId: channel.workspace_id,
      contactId,
      conversationId: conversation.id,
      at: input.at ?? new Date().toISOString(),
    });
  } catch (err) {
    console.error("Case engine (handleInbound) error:", err);
  }

  // ── Flow engine ───────────────────────────────────────────────────────────

  if (conversation.is_automation_paused) return;

  const incomingMessage = {
    text: msg.text || undefined,
    postbackPayload: msg.postbackPayload || undefined,
    quickReplyPayload: msg.quickReplyPayload || undefined,
    callbackData: msg.callbackData || undefined,
    sender: {
      id: msg.sender.id,
      name: msg.sender.name,
      username: msg.sender.username || undefined,
    },
  };

  const handled = await handleGlobalKeywords(supabase, channel.workspace_id, contactId, msg.text || undefined);
  if (handled) return;

  const trigger = await matchTrigger(supabase, {
    channelId: channel.id,
    workspaceId: channel.workspace_id,
    conversationId: conversation.id,
    message: incomingMessage,
    isFirstMessage: input.isFirstMessage,
  });
  if (!trigger) return;

  try {
    await executeFlow(supabase, {
      triggerId: trigger.id,
      flowId: trigger.flow_id,
      channelId: channel.id,
      contactId,
      conversationId: conversation.id,
      workspaceId: channel.workspace_id,
      incomingMessage,
      lateConversationId: input.lateConversationId,
      lateAccountId: input.lateAccountId,
    });
  } catch (err) {
    console.error("Flow execution error:", err);
  }
}

// ── Global keywords ─────────────────────────────────────────────────────────

async function handleGlobalKeywords(
  supabase: Db,
  workspaceId: string,
  contactId: string,
  text: string | undefined,
): Promise<boolean> {
  if (!text) return false;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("global_keywords")
    .eq("id", workspaceId)
    .single();

  if (!workspace?.global_keywords) return false;

  const keywords = workspace.global_keywords as Array<{
    keyword: string;
    action?: string;
    flowId?: string;
  }>;

  const normalizedText = text.toLowerCase().trim();

  for (const kw of keywords) {
    if (normalizedText === kw.keyword.toLowerCase()) {
      if (kw.action === "unsubscribe") {
        await supabase.from("contacts").update({ is_subscribed: false }).eq("id", contactId);
        return true;
      }
      if (kw.action === "subscribe") {
        await supabase.from("contacts").update({ is_subscribed: true }).eq("id", contactId);
        return true;
      }
      return false;
    }
  }

  return false;
}
