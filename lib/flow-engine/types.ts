import type { NodeType, Platform } from "@/lib/types/database";
import type { NodeTemplate } from "./send-mode";

/**
 * Nodos de gestión (fase 2). El constructor los guarda como nodo `action` con
 * `data.actionType` igual a uno de estos valores; el motor acepta también el
 * tipo directo.
 */
export type CaseActionType = "classifyCase" | "changeStage" | "assignTeam" | "distributeCase";

export const CASE_ACTION_TYPES: readonly CaseActionType[] = [
  "classifyCase",
  "changeStage",
  "assignTeam",
  "distributeCase",
];

export interface FlowNode {
  id: string;
  type: NodeType | CaseActionType;
  data: NodeData;
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export type NodeData =
  | TriggerNodeData
  | SendMessageNodeData
  | ConditionNodeData
  | DelayNodeData
  | TagNodeData
  | SetFieldNodeData
  | HttpRequestNodeData
  | GoToFlowNodeData
  | HumanTakeoverNodeData
  | ABSplitNodeData
  | SmartDelayNodeData
  | SubscribeNodeData
  | CommentReplyNodeData
  | PrivateReplyNodeData
  | AiResponseNodeData
  | EnrollSequenceNodeData
  | ClassifyCaseNodeData
  | ChangeStageNodeData
  | AssignTeamNodeData
  | DistributeCaseNodeData;

export interface TriggerNodeData {
  triggerType: string;
  keywords?: Array<{
    value: string;
    matchType: "exact" | "contains" | "startsWith";
  }>;
  payload?: string;
}

export interface SendMessageNodeData {
  /**
   * Plantilla de WhatsApp para cuando la ventana de 24 h está cerrada. Las
   * variables admiten {nombre}, {fecha_clave}, {empresa}, {sede} y
   * {campo:slug}.
   */
  template?: NodeTemplate;
  messages: Array<{
    text?: string;
    imageUrl?: string;
    quickReplies?: Array<{ title: string; payload: string }>;
    buttons?: Array<{
      title: string;
      type: "postback" | "url";
      payload?: string;
      url?: string;
    }>;
    carousel?: {
      elements: Array<{
        imageUrl?: string;
        title: string;
        subtitle?: string;
        buttons?: Array<{
          type: "postback" | "url";
          title: string;
          payload?: string;
          url?: string;
        }>;
      }>;
    };
  }>;
}

export interface ConditionNodeData {
  conditions: Array<{
    field: string;
    operator: "equals" | "not_equals" | "contains" | "exists" | "gt" | "lt";
    value: string;
  }>;
  logic: "and" | "or";
}

export interface DelayNodeData {
  duration: number;
  unit: "seconds" | "minutes" | "hours" | "days";
}

export interface TagNodeData {
  action: "add" | "remove";
  tagName: string;
}

export interface SetFieldNodeData {
  fieldSlug: string;
  value: string;
}

export interface HttpRequestNodeData {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  responseVariable?: string;
}

export interface GoToFlowNodeData {
  flowId: string;
  returnAfter: boolean;
}

export interface HumanTakeoverNodeData {
  message?: string;
}

export interface ABSplitNodeData {
  paths: Array<{ name: string; weight: number }>;
}

export interface SmartDelayNodeData {
  timeout: number;
  timeoutUnit: "minutes" | "hours" | "days";
}

export interface SubscribeNodeData {
  action: "subscribe" | "unsubscribe";
}

export interface CommentReplyNodeData {
  /** Text to reply to the comment with. Supports {{variable}} interpolation. */
  text: string;
}

export interface PrivateReplyNodeData {
  /** Text to send as a private DM to the commenter. Supports {{variable}} interpolation. */
  text: string;
  imageUrl?: string;
}

export interface AiResponseNodeData {
  label?: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  contextMessages: number;
  /**
   * The generated text is always stored in the ai_response variable. When false,
   * the node ONLY stores it (no send), so a later Send Message node can use
   * {{ai_response}} without double-sending. Defaults to true for back-compat.
   */
  sendDirectly?: boolean;
}

export interface EnrollSequenceNodeData {
  /** The ID of the sequence to enroll the contact into */
  sequenceId: string;
}

/** Clasificar gestión: tipo (y etapa opcional) de la gestión abierta del contacto. */
export interface ClassifyCaseNodeData {
  caseTypeId?: string;
  /** Solo para mostrar en el lienzo y el simulador. */
  caseTypeName?: string;
  stageId?: string;
  stageName?: string;
}

/** Cambiar etapa: etapa abierta del tipo actual de la gestión. */
export interface ChangeStageNodeData {
  stageId?: string;
  stageName?: string;
}

/**
 * Asignar a equipo: `fixed` mueve la gestión al equipo elegido; `reroute`
 * vuelve a calcular el equipo según el tipo de gestión y el contacto. En ambos
 * casos, sin responsable, se aplica el reparto del equipo.
 */
export interface AssignTeamNodeData {
  mode?: "fixed" | "reroute";
  teamId?: string;
  teamName?: string;
}

/** Repartir a asesor: aplica el reparto del equipo actual. */
export interface DistributeCaseNodeData {
  /** Repartir de nuevo aunque ya tenga responsable. */
  replaceAssignee?: boolean;
}

export interface FlowExecutionContext {
  triggerId: string;
  flowId: string;
  channelId: string;
  contactId: string;
  conversationId: string;
  workspaceId: string;
  /** The Zernio API conversation ID (from conversations.late_conversation_id) */
  lateConversationId?: string;
  /** The Zernio API account ID (from channels.late_account_id) */
  lateAccountId?: string;
  incomingMessage: {
    text?: string;
    postbackPayload?: string;
    quickReplyPayload?: string;
    callbackData?: string;
    sender?: { id: string; name?: string; username?: string };
  };
  variables?: Record<string, string>;
  platform?: Platform;
  /**
   * Flujo disparado por un evento (no por un mensaje): empieza una sesión
   * nueva en vez de reanudar la que espera una respuesta del cliente.
   */
  startFresh?: boolean;
}
