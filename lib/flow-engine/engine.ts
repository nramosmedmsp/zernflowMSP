import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, SequenceStep } from "@/lib/types/database";
import type {
  FlowNode,
  FlowEdge,
  FlowExecutionContext,
  SendMessageNodeData,
  ConditionNodeData,
  DelayNodeData,
  TagNodeData,
  SetFieldNodeData,
  HttpRequestNodeData,
  GoToFlowNodeData,
  ABSplitNodeData,
  CommentReplyNodeData,
  PrivateReplyNodeData,
  AiResponseNodeData,
  EnrollSequenceNodeData,
  HumanTakeoverNodeData,
} from "./types";
import { executeAiResponse } from "./nodes/ai-response";
import { adaptMessage } from "./platform-adapter";
import { createZernioClient } from "@/lib/zernio-client";
import { getLateApiKey } from "@/lib/workspace-secrets";
import { stampBotOutbound } from "@/lib/cases/inbound";
import { demoTemplateText, isDemoChannel } from "@/lib/demo";
import { CASE_ACTION_TYPES, type CaseActionType } from "./types";
import { CASE_EVENT_VARIABLE } from "./case-trigger-match";
import { isCaseConditionField } from "./case-conditions";
import { evaluateConditionNode } from "./condition-eval";
import { chooseABPath, delayDurationMs, selectNextEdge } from "./graph";
import { interpolateVariables } from "./interpolate";
import { MENU_VARIABLE, recordMenu } from "./menu-reply";
import { nodeKind, persistsSessionVariables } from "./node-kind";
import { cancelActiveSessions, cancelOtherWaitingSessions, findWaitingSession, smartDelayTimeoutMs } from "./waiting-session";
import { computeFlowWindowOpen, decideSendMode, messageHasContent, parseNodeTemplate, SKIP_REASON_LABELS } from "./send-mode";
import { executeCaseAction, findTargetCase, loadCaseSnapshot } from "./nodes/case-actions";
import { addSystemNote } from "@/lib/cases/changes";
import { sendFlowTemplate } from "./nodes/send-template";
import { checkHttpTarget, HTTP_NODE_TIMEOUT_MS, readTextCapped } from "./http-guard";
import { seedContactVariables } from "./contact-variables";
import { blockIfUnsubscribed, haltFlowAfterSendFailure, touchConversationAfterBotSend } from "./bot-send";
import { zernioErrorMessage, zernioFailed, zernioThrown } from "@/lib/zernio-error";
import { enrollInSequence } from "@/lib/sequences/enroll";

/** Motivo en español de un envío fallido del bot (rechazo de Zernio o error de red). */
function sendFailureReason(error: unknown): string {
  const rejected = zernioThrown(error);
  if (rejected) return zernioErrorMessage(rejected, "Zernio rechazó el mensaje");
  const message = error instanceof Error ? error.message : "";
  return message || "No se pudo enviar el mensaje";
}

export async function executeFlow(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext
) {
  // Ensure variables always exists so nodes (aiResponse, httpRequest) can write
  // outputs even when the trigger passed none (e.g. DM-triggered flows).
  context.variables ??= {};

  // Seed {{message}} from the incoming message text so the variable offered in
  // the builder resolves in production, not just in the simulator (which seeds
  // it itself). Guarded so cron resumes with an empty incomingMessage don't
  // clobber a previously stored value.
  if (context.incomingMessage.text) {
    context.variables.message ??= context.incomingMessage.text;
  }

  await seedContactVariables(supabase, context);

  // Check for active session waiting for input. Los flujos disparados por un
  // evento de gestión (startFresh) no reanudan la sesión que espera al cliente.
  const activeSession = context.startFresh
    ? null
    : await findWaitingSession(supabase, { contactId: context.contactId, channelId: context.channelId });

  if (activeSession) {
    return resumeSession(supabase, activeSession, context);
  }

  // Load flow
  const { data: flow } = await supabase
    .from("flows")
    .select("*")
    .eq("id", context.flowId)
    .eq("workspace_id", context.workspaceId)
    .eq("status", "published")
    .single();

  if (!flow) return;

  const nodes = flow.nodes as unknown as FlowNode[];
  const edges = flow.edges as unknown as FlowEdge[];

  // Get channel platform and late_account_id
  const { data: channel } = await supabase
    .from("channels")
    .select("platform, late_account_id")
    .eq("id", context.channelId)
    .single();

  context.platform = channel?.platform as FlowExecutionContext["platform"];
  if (channel?.late_account_id && !context.lateAccountId) {
    context.lateAccountId = channel.late_account_id;
  }

  // Resolve late_conversation_id from the conversation record if not already set
  if (!context.lateConversationId && context.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (conversation?.late_conversation_id) {
      context.lateConversationId = conversation.late_conversation_id;
    }
  }

  // Create session
  const { data: session } = await supabase
    .from("flow_sessions")
    .insert({
      contact_id: context.contactId,
      flow_id: context.flowId,
      channel_id: context.channelId,
      status: "active",
      variables: context.variables || {},
    })
    .select("id")
    .single();

  if (!session) return;

  // Track flow_started
  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "flow_started",
    metadata: { triggerId: context.triggerId },
  });

  // Find the trigger node (entry point)
  const triggerNode = nodes.find((n) => n.type === "trigger");
  if (!triggerNode) return;

  // Get the first connected node
  const firstEdge = edges.find((e) => e.source === triggerNode.id);
  if (!firstEdge) return;

  const startNode = nodes.find((n) => n.id === firstEdge.target);
  if (!startNode) return;

  await traverseNodes(supabase, session.id, startNode, nodes, edges, context, 0);
}

const MAX_TRAVERSAL_DEPTH = 50;

// Thrown before resumeSession advances current_node_id, so callers may retry
// without cancelling the session.
export class FlowLoadError extends Error {}

export async function resumeSession(
  supabase: SupabaseClient<Database>,
  session: Database["public"]["Tables"]["flow_sessions"]["Row"],
  context: FlowExecutionContext
) {
  const { data: flow, error: flowError } = await supabase
    .from("flows")
    .select("*")
    .eq("id", session.flow_id)
    .single();

  if (!flow) {
    // postgrest-js swallows transient failures into { data: null, error }, it
    // does not throw. Only PGRST116 (zero rows) means the flow row is genuinely
    // gone; anything else is a transient DB/network blip, so throw and let the
    // caller recover (cron retry with backoff, or the contact's next message on
    // the webhook path) instead of permanently cancelling the session.
    if (flowError && flowError.code !== "PGRST116") {
      throw new FlowLoadError(
        `flow ${session.flow_id} could not be loaded: ${flowError.message}`
      );
    }
    await cancelUnresumableSession(
      supabase,
      session.id,
      `flow ${session.flow_id} no longer exists`
    );
    return;
  }

  const nodes = flow.nodes as unknown as FlowNode[];
  const edges = flow.edges as unknown as FlowEdge[];

  const { data: channel } = await supabase
    .from("channels")
    .select("platform, late_account_id")
    .eq("id", context.channelId)
    .single();

  context.platform = channel?.platform as FlowExecutionContext["platform"];
  if (channel?.late_account_id && !context.lateAccountId) {
    context.lateAccountId = channel.late_account_id;
  }

  // Resolve late_conversation_id if not set
  if (!context.lateConversationId && context.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (conversation?.late_conversation_id) {
      context.lateConversationId = conversation.late_conversation_id;
    }
  }

  context.variables = (session.variables as Record<string, string>) || {};
  await seedContactVariables(supabase, context);

  // The resume is driven by a fresh reply; make {{message}} reflect it. Un clic
  // en un botón sin texto guarda su carga (payload) como respuesta.
  const reply =
    context.incomingMessage.text ||
    context.incomingMessage.quickReplyPayload ||
    context.incomingMessage.postbackPayload ||
    context.incomingMessage.callbackData;
  if (reply) {
    context.variables.message = reply;
  }

  // Update session
  await supabase
    .from("flow_sessions")
    .update({ waiting_for_input: false, waiting_until: null })
    .eq("id", session.id);

  // Continue from current node
  const currentNode = nodes.find((n) => n.id === session.current_node_id);
  if (!currentNode) {
    // The flow was edited and the paused-on node removed; the session can
    // never advance, so settle it instead of leaving it active forever.
    await cancelUnresumableSession(
      supabase,
      session.id,
      `node ${session.current_node_id} no longer exists in flow ${session.flow_id}`
    );
    return;
  }

  // Get next node after the current one
  const nextEdge = edges.find((e) => e.source === currentNode.id);
  if (!nextEdge) {
    await completeSession(supabase, session.id);
    return;
  }

  const nextNode = nodes.find((n) => n.id === nextEdge.target);
  if (!nextNode) {
    await completeSession(supabase, session.id);
    return;
  }

  await traverseNodes(supabase, session.id, nextNode, nodes, edges, context, 0);
}

async function cancelUnresumableSession(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  reason: string
) {
  console.error(`Cancelling flow session ${sessionId}: ${reason}`);
  const { error } = await supabase
    .from("flow_sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId);
  if (error) {
    // postgrest swallows network failures into { error }, so an unchecked
    // cancel can silently no-op and strand the session as active forever.
    // current_node_id has not advanced, so FlowLoadError lets callers retry
    // and re-attempt the cancel.
    throw new FlowLoadError(
      `session ${sessionId} could not be cancelled (${reason}): ${error.message}`
    );
  }
}

async function traverseNodes(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  node: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
  context: FlowExecutionContext,
  depth: number = 0
) {
  if (depth >= MAX_TRAVERSAL_DEPTH) {
    console.error(`Flow traversal exceeded max depth (${MAX_TRAVERSAL_DEPTH}), stopping. Flow: ${context.flowId}`);
    await completeSession(supabase, sessionId);
    return;
  }
  // Update current node
  await supabase
    .from("flow_sessions")
    .update({ current_node_id: node.id })
    .eq("id", sessionId);

  // Track analytics
  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "node_executed",
    metadata: { nodeId: node.id, nodeType: node.type },
  });

  // Execute the node
  const result = await executeNode(supabase, node, context, sessionId);

  // Persist variables written by output-producing nodes so they survive
  // pauses (resumeSession reloads them from the session row). Los nodos de
  // gestión guardan case_id (la gestión que abrieron).
  if (persistsSessionVariables(node)) {
    await supabase
      .from("flow_sessions")
      .update({ variables: (context.variables ?? {}) as Json })
      .eq("id", sessionId);
  }

  // If the node pauses execution (delay, wait for input, human takeover), stop
  if (result === "pause") return;

  // Comentario → DM: solo el primer mensaje salió (como respuesta privada); lo
  // que sigue espera a que el cliente conteste por mensaje directo. Si no hay
  // nada después, el flujo termina aquí.
  if (result === WAIT_FOR_REPLY) {
    const after = selectNextEdge(edges, node.id);
    if (!after || !nodes.some((n) => n.id === after.target)) {
      await completeSession(supabase, sessionId);
      return;
    }
    await waitForCustomerReply(supabase, sessionId, node.id, context, COMMENT_DM_WAIT_MS);
    return;
  }

  // Find next node(s)
  // Condition/split nodes specify which handle to follow ("handle:<nombre>").
  const handle =
    result && typeof result === "string" && result.startsWith("handle:") ? result.replace("handle:", "") : undefined;
  const nextEdge = selectNextEdge(edges, node.id, handle);

  if (!nextEdge) {
    await completeSession(supabase, sessionId);
    return;
  }

  const nextNode = nodes.find((n) => n.id === nextEdge!.target);
  if (!nextNode) {
    await completeSession(supabase, sessionId);
    return;
  }

  // Continue to next node
  await traverseNodes(supabase, sessionId, nextNode, nodes, edges, context, depth + 1);
}

/** Señal de executeSendMessage: salió el primer mensaje como respuesta privada y el resto espera al cliente. */
const WAIT_FOR_REPLY = "wait_for_reply";
/** Cuánto espera un flujo de comentario la respuesta del cliente al primer DM. */
const COMMENT_DM_WAIT_MS = 24 * 60 * 60 * 1000;

async function waitForCustomerReply(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  nodeId: string,
  context: FlowExecutionContext,
  waitMs: number,
): Promise<void> {
  await supabase
    .from("flow_sessions")
    .update({
      waiting_for_input: true,
      waiting_until: new Date(Date.now() + waitMs).toISOString(),
      current_node_id: nodeId,
    })
    .eq("id", sessionId);
  // Una sola espera por contacto y canal (M-6): la respuesta del cliente
  // debe retomar la última pregunta, no una vieja que quedó colgada.
  await cancelOtherWaitingSessions(supabase, { sessionId, contactId: context.contactId, channelId: context.channelId });
}

async function executeNode(
  supabase: SupabaseClient<Database>,
  node: FlowNode,
  context: FlowExecutionContext,
  sessionId: string
): Promise<string | void> {
  const kind = nodeKind(node);
  if ((CASE_ACTION_TYPES as readonly string[]).includes(kind)) {
    return executeCaseAction(
      supabase,
      kind as CaseActionType,
      node.data as unknown as Record<string, unknown>,
      context
    );
  }
  switch (kind) {
    case "sendMessage":
      return executeSendMessage(supabase, node.data as SendMessageNodeData, context, sessionId);
    case "condition":
      return executeCondition(supabase, node.data as ConditionNodeData, context);
    case "delay":
      return executeDelay(supabase, node.data as DelayNodeData, sessionId, node.id, context);
    case "addTag":
    case "removeTag":
      return executeTag(supabase, node.data as Partial<TagNodeData>, kind === "addTag", context);
    case "setCustomField":
      return executeSetField(supabase, node.data as SetFieldNodeData, context);
    case "httpRequest":
      return executeHttpRequest(supabase, node.data as HttpRequestNodeData, context);
    case "goToFlow":
      return executeGoToFlow(supabase, node.data as GoToFlowNodeData, context, sessionId);
    case "humanTakeover":
      return executeHumanTakeover(supabase, node.data as HumanTakeoverNodeData, context, sessionId);
    case "subscribe":
    case "unsubscribe":
      return executeSubscription(supabase, kind, context);
    case "commentReply":
      return executeCommentReply(supabase, node.data as CommentReplyNodeData, context);
    case "privateReply":
      return executePrivateReply(supabase, node.data as PrivateReplyNodeData, context);
    case "aiResponse":
      return executeAiResponse(supabase, node.data as AiResponseNodeData, context, sessionId);
    case "abSplit":
      return executeABSplit(node.data as ABSplitNodeData);
    case "smartDelay":
      // Espera la siguiente respuesta del cliente. `waiting_until` marca cuándo
      // vence: pasado ese momento, un mensaje nuevo ya no retoma esta sesión.
      await waitForCustomerReply(
        supabase,
        sessionId,
        node.id,
        context,
        smartDelayTimeoutMs(node.data as { timeout?: unknown; timeoutUnit?: unknown }),
      );
      return "pause";
    case "enrollSequence":
      return executeEnrollSequence(supabase, node.data as EnrollSequenceNodeData, context);
    default:
      return;
  }
}

async function sendFirstMessageAsPrivateReply(
  supabase: SupabaseClient<Database>,
  zernio: ReturnType<typeof createZernioClient>,
  data: SendMessageNodeData,
  context: FlowExecutionContext,
  lateAccountId: string
): Promise<boolean> {
  const first = data.messages[0];
  if (!first) return true;

  const text = interpolateVariables(
    adaptMessage(first, context.platform ?? "instagram").text,
    context.variables || {},
    { blankUnknown: true },
  );

  try {
    await zernio.comments.sendPrivateReplyToComment({
      path: {
        postId: String(context.variables!.post_id),
        commentId: String(context.variables!.comment_id),
      },
      body: { accountId: lateAccountId, message: text },
    });

    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "sent",
    });

    await touchConversationAfterBotSend(supabase, context.conversationId, text);
    await stampFlowOutbound(supabase, context);

    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "message_sent",
    });
  } catch (error) {
    console.error("Failed to send comment-context message as private reply:", error);
    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "failed",
      error_text: error instanceof Error ? error.message : null,
    });
    await touchConversationAfterBotSend(supabase, context.conversationId, null);
    return false;
  }

  if (data.messages.length > 1) {
    console.warn(
      "Comment flow Send Message node had multiple messages; only the first was sent (one private reply per comment)."
    );
  }
  return true;
}

/**
 * Sella la salida del bot en la gestión. Los flujos de "cliente sin responder"
 * no la sellan: su propio mensaje reiniciaría la cuenta del cron y el flujo se
 * repetiría cada N minutos.
 */
async function stampFlowOutbound(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext
) {
  if (context.variables?.[CASE_EVENT_VARIABLE] === "client_no_reply") return;
  await stampBotOutbound(supabase, { contactId: context.contactId });
}

/**
 * Ventana de 24 h de WhatsApp. Si el flujo nació de un mensaje del cliente está
 * abierta; si no (evento, espera que se reanuda), se mira el último mensaje
 * entrante de sus gestiones.
 */
async function isFlowWindowOpen(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext
): Promise<boolean> {
  const incoming = context.incomingMessage;
  // Con un mensaje del cliente la ventana está abierta: sin consultar la base.
  if (computeFlowWindowOpen(incoming, null)) return true;
  const { data } = await supabase
    .from("cases")
    .select("last_inbound_at")
    .eq("contact_id", context.contactId)
    .not("last_inbound_at", "is", null)
    .order("last_inbound_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return computeFlowWindowOpen(incoming, data?.last_inbound_at);
}

/** Envía la plantilla del nodo y deja el mensaje y la analítica registrados. */
async function sendTemplateFromNode(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext,
  template: NonNullable<ReturnType<typeof parseNodeTemplate>>,
  lateAccountId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  let text = `Plantilla: ${template.template_name}`;
  const result = await sendFlowTemplate(supabase, context, template, lateAccountId);
  // Canal de prueba (lib/demo.ts): se guarda el texto de la plantilla con sus variables.
  if (result.ok && isDemoChannel(lateAccountId)) text = demoTemplateText(template.template_name, result.params);
  if (!result.ok) {
    console.error("Failed to send template:", result.error);
    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "failed",
      error_text: result.error,
    });
    await touchConversationAfterBotSend(supabase, context.conversationId, null);
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "message_failed",
      metadata: { error: result.error, template: template.template_name },
    });
    return { ok: false, error: result.error };
  }

  await supabase.from("messages").insert({
    conversation_id: context.conversationId,
    direction: "outbound",
    text,
    sent_by_flow_id: context.flowId,
    platform_message_id: result.messageId,
    status: "sent",
  });
  await touchConversationAfterBotSend(supabase, context.conversationId, text);
  await stampFlowOutbound(supabase, context);
  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "message_sent",
    metadata: { template: template.template_name },
  });
  return { ok: true };
}

async function executeSendMessage(
  supabase: SupabaseClient<Database>,
  data: SendMessageNodeData,
  context: FlowExecutionContext,
  sessionId: string
) {
  // El menú (botones o respuestas rápidas) del último mensaje queda en la
  // sesión: la respuesta numérica o con el texto de una opción retoma la espera
  // como esa opción (menu-reply.ts). Si no se envía texto, no hay menú.
  context.variables ??= {};
  const unsubscribed = await blockIfUnsubscribed(supabase, context, sessionId);
  if (unsubscribed) return unsubscribed;
  recordMenu(context.variables, data.messages);

  // Resolve late_account_id from channel if not in context
  let lateAccountId = context.lateAccountId;
  if (!lateAccountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id, platform")
      .eq("id", context.channelId)
      .single();

    if (!channel) return haltFlowAfterSendFailure(supabase, context, sessionId, "no se encontró el canal");
    lateAccountId = channel.late_account_id;
    if (!context.platform) {
      context.platform = channel.platform as FlowExecutionContext["platform"];
    }
  }

  // Canal de prueba (lib/demo.ts): no se llama a Zernio (el mensaje se guarda
  // abajo en `messages`, como siempre), así que tampoco hace falta la clave.
  const demo = isDemoChannel(lateAccountId);

  // Get workspace for API key
  let zernio: ReturnType<typeof createZernioClient> | null = null;
  if (!demo) {
    const lateApiKey = await getLateApiKey(context.workspaceId, supabase);
    if (!lateApiKey) {
      return haltFlowAfterSendFailure(supabase, context, sessionId, "la clave de API de Zernio no está configurada");
    }
    zernio = createZernioClient(lateApiKey);
  }

  // Resolve late_conversation_id from conversation if not in context
  let lateConversationId = context.lateConversationId;
  if (!lateConversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (!conversation?.late_conversation_id) {
      // Comment-triggered flows have no DM conversation yet. Instagram allows
      // exactly one private reply per comment, so deliver the first message via
      // the private-reply endpoint instead of silently dropping the whole node
      // (users build comment flows with plain Send Message nodes, not Private Reply).
      if (zernio && context.variables?.comment_id && context.variables?.post_id && lateAccountId) {
        const sentOk = await sendFirstMessageAsPrivateReply(supabase, zernio, data, context, lateAccountId);
        if (!sentOk) return haltFlowAfterSendFailure(supabase, context, sessionId, "Instagram no aceptó la respuesta privada");
        // Instagram permite una sola respuesta privada por comentario: lo que sigue
        // en el flujo sale cuando el cliente conteste (R2-B10).
        return WAIT_FOR_REPLY;
      }
      console.error("No late_conversation_id found for conversation:", context.conversationId);
      return haltFlowAfterSendFailure(supabase, context, sessionId, "la conversación no tiene un ID de Zernio");
    }
    lateConversationId = conversation.late_conversation_id;
  }

  // WhatsApp (fase 2): texto o plantilla según la ventana de 24 h.
  if (context.platform === "whatsapp") {
    const template = parseNodeTemplate(data.template);
    const decision = decideSendMode({
      platform: "whatsapp",
      windowOpen: await isFlowWindowOpen(supabase, context),
      hasText: data.messages.some(messageHasContent),
      hasTemplate: !!template,
    });
    if (decision.mode === "skip") {
      delete context.variables[MENU_VARIABLE];
      const reason = SKIP_REASON_LABELS[decision.reason];
      console.warn(`[flows] mensaje no enviado (flujo ${context.flowId}): ${reason}`);
      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: context.contactId,
        event_type: "message_skipped",
        metadata: { reason: decision.reason, detail: reason },
      });
      return;
    }
    if (decision.mode === "template" && template) {
      delete context.variables[MENU_VARIABLE];
      const sentTemplate = await sendTemplateFromNode(supabase, context, template, lateAccountId);
      if (!sentTemplate.ok) return haltFlowAfterSendFailure(supabase, context, sessionId, sentTemplate.error);
      return;
    }
  }

  for (const msg of data.messages) {
    const adapted = adaptMessage(msg, context.platform!);
    const text = interpolateVariables(adapted.text, context.variables || {}, { blankUnknown: true });

    try {
      // Media (image/video/audio) is platform-agnostic, so read it from the raw
      // message. `mediaUrl` + `mediaType` supersede the legacy image-only `imageUrl`.
      const rawMsg = msg as { mediaUrl?: string; mediaType?: string; imageUrl?: string };
      const mediaUrl = rawMsg.mediaUrl || rawMsg.imageUrl;
      const mediaType = rawMsg.mediaType || (rawMsg.imageUrl ? "image" : undefined);

      const attachments = mediaUrl
        ? [{ type: mediaType || "image", url: mediaUrl }]
        : undefined;

      // Build the API body with rich messaging fields
      const body: Record<string, unknown> = {
        accountId: lateAccountId,
        message: text,
      };
      // Actually send the media to the recipient. Previously the attachment was only
      // stored locally and never included in the send body, so flow media never
      // reached the contact.
      if (mediaUrl) {
        body.attachmentUrl = mediaUrl;
        body.attachmentType = mediaType || "image";
      }

      if (adapted.buttons?.length) {
        body.buttons = adapted.buttons;
      }
      if (adapted.quickReplies?.length) {
        body.quickReplies = adapted.quickReplies;
      }
      if (adapted.template) {
        body.template = adapted.template;
      }
      if (adapted.replyMarkup) {
        body.replyMarkup = adapted.replyMarkup;
      }

      const response = zernio
        ? await zernio.messages.sendInboxMessage({
            path: { conversationId: lateConversationId },
            body: body as Parameters<typeof zernio.messages.sendInboxMessage>[0]["body"],
          })
        : null;
      // El SDK suele lanzar el error, pero una respuesta con error no es un envío.
      if (response && zernioFailed(response)) throw new Error(zernioErrorMessage(response, "Zernio rechazó el mensaje"));

      // Store outbound message
      await supabase.from("messages").insert({
        conversation_id: context.conversationId,
        direction: "outbound",
        text,
        attachments: attachments || null,
        sent_by_flow_id: context.flowId,
        sent_by_node_id: null,
        platform_message_id: response?.data?.data?.messageId || (demo ? `demo-${crypto.randomUUID()}` : null),
        status: "sent",
      });
      // Última actividad en todos los canales (no solo los de prueba): así el
      // chat abierto y la lista se refrescan con lo que contestó el bot.
      await touchConversationAfterBotSend(supabase, context.conversationId, text);

      // Gestiones: el bot solo sella la salida (no cuenta como respuesta humana).
      await stampFlowOutbound(supabase, context);

      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: context.contactId,
        event_type: "message_sent",
      });
    } catch (error) {
      console.error("Failed to send message:", error);
      const reason = sendFailureReason(error);
      await supabase.from("messages").insert({
        conversation_id: context.conversationId,
        direction: "outbound",
        text,
        sent_by_flow_id: context.flowId,
        status: "failed",
        error_text: reason,
      });
      await touchConversationAfterBotSend(supabase, context.conversationId, null);

      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: context.contactId,
        event_type: "message_failed",
        metadata: { error: error instanceof Error ? error.message : "Unknown error" },
      });
      // M-10: sin el mensaje el cliente no puede responder lo que se le pidió:
      // el flujo se detiene y queda una nota en la gestión.
      delete context.variables[MENU_VARIABLE];
      return haltFlowAfterSendFailure(supabase, context, sessionId, reason);
    }

    // Small delay between messages
    if (data.messages.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function executeCondition(
  supabase: SupabaseClient<Database>,
  data: ConditionNodeData,
  context: FlowExecutionContext
): Promise<string> {
  const { data: contact } = await supabase
    .from("contacts")
    .select("*, contact_tags(tag_id, tags(name)), contact_custom_fields(field_id, value, custom_field_definitions(slug))")
    .eq("id", context.contactId)
    .single();

  if (!contact) return "handle:false";

  // Condiciones de gestión (fase 2): tipo de contacto, tipo de gestión, etapa,
  // equipo, responsable y horario. Se cargan una sola vez si alguna las usa.
  const caseSnapshot = data.conditions.some((c) => isCaseConditionField(c.field))
    ? await loadCaseSnapshot(supabase, context, contact.contact_type_id ?? null)
    : null;

  // Lo que se sabe del contacto, una sola vez para todas las condiciones.
  const tagRows = (contact.contact_tags ?? []) as unknown as Array<{ tags: { name: string } | null }>;
  const fieldRows = (contact.contact_custom_fields ?? []) as unknown as Array<{
    value: string;
    custom_field_definitions: { slug: string } | null;
  }>;
  const facts = {
    platform: context.platform,
    isSubscribed: contact.is_subscribed,
    tags: tagRows.flatMap((ct) => (ct.tags?.name ? [ct.tags.name] : [])),
    customFields: Object.fromEntries(
      fieldRows.flatMap((f) => (f.custom_field_definitions?.slug ? [[f.custom_field_definitions.slug, f.value] as const] : [])),
    ),
    variables: context.variables ?? {},
  };

  const { passed } = evaluateConditionNode(data, facts, caseSnapshot);

  return passed ? "handle:true" : "handle:false";
}

async function executeDelay(
  supabase: SupabaseClient<Database>,
  data: DelayNodeData,
  sessionId: string,
  nodeId: string,
  context: FlowExecutionContext
) {
  const runAt = new Date(Date.now() + delayDurationMs(data.duration, data.unit)).toISOString();

  // Schedule a job to resume the flow
  await supabase.from("scheduled_jobs").insert({
    type: "resume_flow",
    payload: {
      sessionId,
      nodeId,
      flowId: context.flowId,
      channelId: context.channelId,
      contactId: context.contactId,
      conversationId: context.conversationId,
      workspaceId: context.workspaceId,
      lateConversationId: context.lateConversationId || null,
      lateAccountId: context.lateAccountId || null,
      variables: context.variables || {},
    },
    run_at: runAt,
  });

  // Update session to waiting
  await supabase
    .from("flow_sessions")
    .update({
      waiting_until: runAt,
      current_node_id: nodeId,
    })
    .eq("id", sessionId);

  return "pause";
}

async function executeTag(
  supabase: SupabaseClient<Database>,
  data: Partial<TagNodeData>,
  isAdd: boolean,
  context: FlowExecutionContext
) {
  // El lienzo no guarda data.action: agregar o quitar lo define el tipo del nodo
  // (addTag / removeTag).
  if (!data.tagName) return;
  // Find or create tag
  const { data: tag } = await supabase
    .from("tags")
    .upsert(
      { workspace_id: context.workspaceId, name: data.tagName },
      { onConflict: "workspace_id,name" }
    )
    .select("id")
    .single();

  if (!tag) return;

  if (isAdd) {
    await supabase
      .from("contact_tags")
      .upsert({ contact_id: context.contactId, tag_id: tag.id })
      .select();
  } else {
    await supabase
      .from("contact_tags")
      .delete()
      .eq("contact_id", context.contactId)
      .eq("tag_id", tag.id);
  }
}

async function executeSetField(
  supabase: SupabaseClient<Database>,
  data: SetFieldNodeData,
  context: FlowExecutionContext
) {
  // Find field definition
  const { data: fieldDef } = await supabase
    .from("custom_field_definitions")
    .select("id")
    .eq("workspace_id", context.workspaceId)
    .eq("slug", data.fieldSlug)
    .single();

  if (!fieldDef) return;

  const value = interpolateVariables(data.value, context.variables || {});

  await supabase.from("contact_custom_fields").upsert(
    {
      contact_id: context.contactId,
      field_id: fieldDef.id,
      value,
    },
    { onConflict: "contact_id,field_id" }
  );
}

async function executeHttpRequest(
  supabase: SupabaseClient<Database>,
  data: HttpRequestNodeData,
  context: FlowExecutionContext
) {
  const variables = context.variables || {};
  const failed = async (reason: string) => {
    console.error(`[flows] solicitud HTTP fallida (flujo ${context.flowId}): ${reason}`);
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "http_request_failed",
      metadata: { reason },
    });
  };

  try {
    // El texto del cliente va codificado: no puede cambiar la dirección ni romper el JSON.
    const target = await checkHttpTarget(interpolateVariables(data.url, variables, { encode: "url" }));
    if (!target.ok) return failed(target.error);
    const body = data.body ? interpolateVariables(data.body, variables, { encode: "json" }) : undefined;

    const response = await fetch(target.url, {
      method: data.method,
      headers: {
        "Content-Type": "application/json",
        ...data.headers,
      },
      body: data.method !== "GET" ? body : undefined,
      signal: AbortSignal.timeout(HTTP_NODE_TIMEOUT_MS),
      // Una redirección podría llevar a una dirección interna: no se sigue.
      redirect: "manual",
    });

    // Un 404 o un 500 no es una respuesta válida: no se guarda como si lo fuera.
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return failed(`respuesta ${response.status}`);
    }
    const responseData = await readTextCapped(response);

    // Store response in variable if configured
    if (data.responseVariable && context.variables) {
      try {
        context.variables[data.responseVariable] = JSON.parse(responseData);
      } catch {
        context.variables[data.responseVariable] = responseData;
      }
    }
  } catch (error) {
    await failed(error instanceof Error ? error.message : "error desconocido");
  }
}

/** Cuántos flujos pueden saltar uno a otro sin una espera de por medio. */
export const MAX_GOTO_CHAIN = 5;

async function executeGoToFlow(
  supabase: SupabaseClient<Database>,
  data: GoToFlowNodeData,
  context: FlowExecutionContext,
  sessionId: string
) {
  // Cadena de flujos de esta ejecución (no se guarda en la sesión: una espera
  // de por medio la reinicia, así "volver al menú" tras una respuesta sí vale).
  const chain = context.goToChain?.length ? context.goToChain : [context.flowId];
  if (!data.flowId) {
    console.error(`[flows] «Ir a flujo» sin flujo de destino (flujo ${context.flowId})`);
    await completeSession(supabase, sessionId);
    return "pause";
  }
  if (chain.includes(data.flowId) || chain.length >= MAX_GOTO_CHAIN) {
    console.warn(`[flows] «Ir a flujo» detenido por bucle: ${[...chain, data.flowId].join(" > ")}`);
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "flow_loop_blocked",
      metadata: { target: data.flowId, chain },
    });
    await supabase.from("flow_sessions").update({ status: "cancelled" }).eq("id", sessionId);
    return "pause";
  }

  // El flujo de origen termina aquí: sin esto su sesión quedaba activa para siempre.
  await completeSession(supabase, sessionId);
  // Flujo nuevo (no retoma otra espera) y solo si es de este espacio (executeFlow filtra por espacio).
  // «Volver después» no existe: el contacto sigue en el flujo de destino.
  await executeFlow(supabase, {
    ...context,
    flowId: data.flowId,
    startFresh: true,
    goToChain: [...chain, data.flowId],
  });
  return "pause";
}

async function executeHumanTakeover(
  supabase: SupabaseClient<Database>,
  data: HumanTakeoverNodeData | undefined,
  context: FlowExecutionContext,
  sessionId: string
) {
  // El texto del nodo queda como nota interna (sin autor: la escribe el
  // sistema) en la gestión abierta, para que el asesor la vea. Un fallo aquí no
  // debe impedir el traspaso.
  const note = data?.message ? interpolateVariables(data.message, context.variables || {}).trim() : "";
  if (note) {
    try {
      const target = await findTargetCase(supabase, context);
      if (!target) {
        console.warn(`[flows] atención humana (flujo ${context.flowId}): no hay gestión abierta, la nota no se guardó`);
      } else {
        const saved = await addSystemNote(supabase, {
          caseId: target.id,
          body: note,
          conversationId: context.conversationId,
        });
        if ("error" in saved) {
          console.error(`[flows] atención humana (flujo ${context.flowId}): no se guardó la nota: ${saved.error}`);
        }
      }
    } catch (err) {
      console.error("[flows] atención humana: error al guardar la nota", err);
    }
  }

  // Pause automation on the conversation
  await supabase
    .from("conversations")
    .update({ is_automation_paused: true })
    .eq("id", context.conversationId);

  // Mark session
  await supabase
    .from("flow_sessions")
    .update({
      human_takeover_at: new Date().toISOString(),
      status: "completed",
    })
    .eq("id", sessionId);
  // Las demás esperas del bot en este canal ya no tienen sentido (M-11).
  await cancelActiveSessions(supabase, { contactId: context.contactId, channelIds: [context.channelId] });

  return "pause";
}

async function executeSubscription(
  supabase: SupabaseClient<Database>,
  action: string,
  context: FlowExecutionContext
) {
  await supabase
    .from("contacts")
    .update({ is_subscribed: action === "subscribe" })
    .eq("id", context.contactId);
}

function executeABSplit(data: ABSplitNodeData): string {
  return `handle:${chooseABPath(data.paths).name}`;
}

/**
 * Post a public reply to the comment that triggered this flow.
 * Uses the comment_id and post_id variables set by the comment processor.
 */
async function executeCommentReply(
  supabase: SupabaseClient<Database>,
  data: CommentReplyNodeData,
  context: FlowExecutionContext
) {
  const lateApiKey = await getLateApiKey(context.workspaceId, supabase);
  if (!lateApiKey) return;

  const zernio = createZernioClient(lateApiKey);

  // Resolve late_account_id
  let lateAccountId = context.lateAccountId;
  if (!lateAccountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id")
      .eq("id", context.channelId)
      .single();

    if (!channel) return;
    lateAccountId = channel.late_account_id;
  }

  const commentId = context.variables?.comment_id || context.incomingMessage.sender?.id;
  if (!commentId) return;

  const postId = context.variables?.post_id;
  if (!postId) {
    console.error("No post_id in context variables for commentReply node");
    return;
  }

  const text = interpolateVariables(data.text, context.variables || {}, { blankUnknown: true });

  try {
    await zernio.comments.replyToInboxPost({
      path: { postId },
      body: { accountId: lateAccountId, message: text, commentId },
    });
  } catch (error) {
    console.error("Failed to post comment reply:", error);
  }
}

/**
 * Send a private DM to the commenter via the Zernio API's private reply endpoint.
 * This creates a DM conversation from a comment context.
 */
async function executePrivateReply(
  supabase: SupabaseClient<Database>,
  data: PrivateReplyNodeData,
  context: FlowExecutionContext
) {
  const lateApiKey = await getLateApiKey(context.workspaceId, supabase);
  if (!lateApiKey) return;

  const zernio = createZernioClient(lateApiKey);

  // Resolve late_account_id
  let lateAccountId = context.lateAccountId;
  if (!lateAccountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id")
      .eq("id", context.channelId)
      .single();

    if (!channel) return;
    lateAccountId = channel.late_account_id;
  }

  const commentId = context.variables?.comment_id || context.incomingMessage.sender?.id;
  if (!commentId) return;

  const postId = context.variables?.post_id;
  if (!postId) {
    console.error("No post_id in context variables for privateReply node");
    return;
  }

  const text = interpolateVariables(data.text, context.variables || {}, { blankUnknown: true });

  try {
    await zernio.comments.sendPrivateReplyToComment({
      path: { postId, commentId },
      body: { accountId: lateAccountId, message: text },
    });

    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      attachments: data.imageUrl
        ? [{ type: "image", url: data.imageUrl }]
        : null,
      sent_by_flow_id: context.flowId,
      status: "sent",
    });

    await stampFlowOutbound(supabase, context);
  } catch (error) {
    console.error("Failed to send private reply:", error);
    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "failed",
    });
  }
}

async function completeSession(
  supabase: SupabaseClient<Database>,
  sessionId: string
) {
  // Only an active session can complete: a concurrent cancel (e.g. the cron's
  // stranded-session settle) must not be overwritten to completed. Zero rows
  // matched also skips the flow_completed analytics event below.
  const { data: session } = await supabase
    .from("flow_sessions")
    .update({ status: "completed" })
    .eq("id", sessionId)
    .eq("status", "active")
    .select("flow_id, contact_id, channel_id")
    .single();

  if (session) {
    const { data: flow } = await supabase
      .from("flows")
      .select("workspace_id")
      .eq("id", session.flow_id)
      .single();

    if (flow) {
      await supabase.from("analytics_events").insert({
        workspace_id: flow.workspace_id,
        flow_id: session.flow_id,
        contact_id: session.contact_id,
        event_type: "flow_completed",
      });
    }
  }
}

async function executeEnrollSequence(
  supabase: SupabaseClient<Database>,
  data: EnrollSequenceNodeData,
  context: FlowExecutionContext
) {
  if (!data.sequenceId) {
    console.error("enrollSequence node missing sequenceId");
    return;
  }

  // Verify sequence exists and is active
  const { data: sequence } = await supabase
    .from("sequences")
    .select("id, steps, status")
    .eq("id", data.sequenceId)
    .eq("workspace_id", context.workspaceId)
    .single();

  if (!sequence || sequence.status !== "active") {
    console.error("Sequence not found or not active:", data.sequenceId);
    return;
  }

  const steps = (sequence.steps as unknown as SequenceStep[]) || [];
  if (steps.length === 0) return;

  // Si ya está dentro, no pasa nada; si terminó o se canceló, vuelve a entrar.
  const result = await enrollInSequence(supabase, {
    workspaceId: context.workspaceId,
    sequenceId: data.sequenceId,
    steps,
    contactId: context.contactId,
    channelId: context.channelId,
  });
  if (!result.ok && result.reason === "error") {
    console.error("Failed to enroll contact in sequence:", result.error);
  }
}
