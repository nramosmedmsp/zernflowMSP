/**
 * Client-side flow simulator. Runs a dry-run traversal of flow nodes/edges
 * without any database writes or API calls. Used for the "Test" panel in the
 * flow builder.
 */

import type { Node, Edge } from "@xyflow/react";
import { isCaseTriggerType } from "./case-trigger-match";
import { describeContactCondition, evaluateContactCondition, type FlowCondition } from "./condition-fields";
import { interpolateVariables as interpolate } from "./interpolate";
import { nodeKind } from "./node-kind";
import {
  CASE_CONDITION_LABELS,
  evaluateCaseCondition,
  isCaseConditionField,
  type CaseConditionSnapshot,
} from "./case-conditions";
import { decideSendMode, parseNodeTemplate, previewTemplateParams, SKIP_REASON_LABELS } from "./send-mode";

// --- Types ---

export interface SimulationStep {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  result: SimulationStepResult;
}

export type SimulationStepResult =
  | {
      type: "trigger";
      matched: boolean;
      triggerType: string;
      keywords?: string[];
    }
  | {
      type: "message";
      texts: string[];
      /** Botones del mensaje; los de tipo "postback" se pueden pulsar en la prueba (envían su título). */
      buttons?: SimulatedButton[];
      quickReplies?: { title: string }[];
    }
  | { type: "reply"; text: string }
  | { type: "condition"; conditions: string[]; result: boolean; path: string }
  | { type: "delay"; duration: number; unit: string }
  | { type: "action"; actionType: string; detail: string }
  | { type: "ai_response"; mode: "skipped" | "generated"; text?: string }
  | { type: "split"; selectedPath: string; weight: number }
  | { type: "smart_delay" }
  | { type: "human_takeover"; note?: string }
  | { type: "go_to_flow"; flowId: string }
  | { type: "enroll_sequence"; sequenceId: string }
  | { type: "comment_reply"; text: string }
  | { type: "private_reply"; text: string }
  | { type: "template"; templateName: string; language: string; params: string[] }
  | { type: "message_skipped"; reason: string }
  | { type: "subscribe" | "unsubscribe" }
  | { type: "http_request"; method: string; url: string }
  | { type: "error"; message: string }
  | { type: "flow_end" };

export interface SimulatedButton {
  title: string;
  type?: "postback" | "url";
  url?: string;
}

/**
 * Dónde quedó el flujo al detenerse en una espera de respuesta. Se pasa en
 * `SimulationConfig.resume` junto con la respuesta para seguir la conversación.
 */
export interface SimulationState {
  /** Nodo de espera en el que se detuvo. */
  waitingNodeId: string;
  variables: Record<string, string>;
  caseState: CaseConditionSnapshot & { hasOpenCase: boolean };
  tags: string[];
  customFields: Record<string, string>;
  isSubscribed: boolean;
}

export interface SimulationConfig {
  /** Mensaje que inicia el flujo; con `resume`, la respuesta del cliente a la espera. */
  incomingMessage: string;
  /**
   * Respuestas del cliente a las esperas, en orden: cada Espera inteligente
   * toma la siguiente. Sin respuestas, la simulación se detiene en la espera
   * (`waiting`) y espera el siguiente mensaje.
   */
  replies?: string[];
  /** Continúa una conversación detenida en una espera (ver `SimulationResult.waiting`). */
  resume?: SimulationState;
  mockContact?: {
    tags?: string[];
    customFields?: Record<string, string>;
    isSubscribed?: boolean;
    /** Id del tipo de contacto (condición "tipo de contacto"). */
    contactTypeId?: string;
  };
  /**
   * Gestión simulada para las condiciones y los nodos de gestión. Sin indicar,
   * hay una gestión abierta sin clasificar, sin responsable y dentro de horario.
   */
  mockCase?: Partial<CaseConditionSnapshot> & { hasOpenCase?: boolean };
  /**
   * Ventana de 24 h de WhatsApp. "false" simula que está cerrada (el nodo
   * Enviar mensaje usa la plantilla o no envía); sin indicar, no se aplica.
   */
  windowOpen?: boolean;
}

export interface SimulationResult {
  steps: SimulationStep[];
  errors: string[];
  /** El flujo llegó a su fin (false si se detuvo en una espera o por error). */
  completed: boolean;
  /** Detenido esperando la respuesta del cliente: pasa esto como `resume` con su mensaje. */
  waiting?: SimulationState;
}

// --- Helpers ---

// --- Simulator ---

export function simulateFlow(
  nodes: Node[],
  edges: Edge[],
  config: SimulationConfig
): SimulationResult {
  const steps: SimulationStep[] = [];
  const errors: string[] = [];
  const resume = config.resume;
  const replies = [...(config.replies ?? [])];

  // Estado simulado del contacto y la gestión: los nodos lo modifican y las
  // condiciones lo leen (igual que el motor, que escribe en la base).
  const variables: Record<string, string> = resume ? { ...resume.variables } : { message: config.incomingMessage };
  const tags = new Set<string>(resume ? resume.tags : (config.mockContact?.tags ?? []));
  const customFields: Record<string, string> = resume ? { ...resume.customFields } : { ...(config.mockContact?.customFields ?? {}) };
  let isSubscribed = resume ? resume.isSubscribed : (config.mockContact?.isSubscribed ?? true);
  const caseState: CaseConditionSnapshot & { hasOpenCase: boolean } = resume
    ? { ...resume.caseState }
    : {
        contactTypeId: config.mockContact?.contactTypeId ?? null,
        caseTypeId: config.mockCase?.caseTypeId ?? null,
        stageId: config.mockCase?.stageId ?? null,
        teamId: config.mockCase?.teamId ?? null,
        hasAssignee: config.mockCase?.hasAssignee ?? false,
        withinHours: config.mockCase?.withinHours ?? true,
        hasOpenCase: config.mockCase?.hasOpenCase ?? true,
      };

  const snapshot = (waitingNodeId: string): SimulationState => ({
    waitingNodeId,
    variables: { ...variables },
    caseState: { ...caseState },
    tags: [...tags],
    customFields: { ...customFields },
    isSubscribed,
  });

  /** Siguiente nodo desde uno dado (por la salida elegida, si la hay). */
  const nextEdgeFrom = (nodeId: string, nextHandle?: string): Edge | undefined => {
    let nextEdge: Edge | undefined;
    if (nextHandle) {
      // El lienzo dibuja las salidas de la condición como "yes"/"no" y las
      // plantillas como "true"/"false": se aceptan ambas.
      const accepted =
        nextHandle === "true" || nextHandle === "yes"
          ? ["true", "yes"]
          : nextHandle === "false" || nextHandle === "no"
            ? ["false", "no"]
            : [nextHandle];
      nextEdge = edges.find((e) => e.source === nodeId && !!e.sourceHandle && accepted.includes(e.sourceHandle));
    }
    if (!nextEdge) {
      nextEdge = edges.find((e) => e.source === nodeId && !e.sourceHandle);
    }
    if (!nextEdge && !nextHandle) {
      // Try any edge from this source (fallback). Con una salida elegida
      // (condición, A/B) y sin conexión en ella, el flujo termina ahí, como en
      // el motor: no se sigue por la otra salida.
      nextEdge = edges.find((e) => e.source === nodeId);
    }
    return nextEdge;
  };

  const flowEnd = (nodeId: string): SimulationResult => {
    steps.push({ nodeId, nodeType: "end", nodeLabel: "Fin", result: { type: "flow_end" } });
    return { steps, errors, completed: true };
  };

  let currentNodeId: string | undefined;

  if (resume) {
    // Continúa la conversación: la respuesta del cliente retoma la espera, sin buscar disparador.
    const waitNode = nodes.find((n) => n.id === resume.waitingNodeId);
    if (!waitNode) {
      errors.push("El nodo de espera ya no existe en el flujo");
      return { steps, errors, completed: false };
    }
    variables.message = config.incomingMessage;
    steps.push({
      nodeId: waitNode.id,
      nodeType: "reply",
      nodeLabel: "Respuesta del cliente",
      result: { type: "reply", text: config.incomingMessage },
    });
    const next = nextEdgeFrom(waitNode.id);
    if (!next) return flowEnd(waitNode.id);
    currentNodeId = next.target;
  } else {
    // 1. Find trigger node
    const triggerNode = nodes.find((n) => n.type === "trigger");
    if (!triggerNode) {
      errors.push("No se encontró un nodo disparador");
      return { steps, errors, completed: false };
    }

    // Simulate trigger matching
    const triggerData = triggerNode.data as Record<string, unknown>;
    const triggerType = (triggerData.triggerType as string) || "keyword";
    // Keywords are stored as { value, matchType } objects by the trigger panel, but
    // older flows / templates may store plain strings. Normalize to strings up front
    // so matching, the result payload, and the error log render real keywords instead
    // of "[object Object]".
    const rawKeywords = (triggerData.keywords as Array<string | { value: string }>) || [];
    const keywords = rawKeywords.map((k) => (typeof k === "string" ? k : (k?.value ?? ""))).filter((k) => k.length > 0);
    let triggerMatched = false;

    if (triggerType === "keyword") {
      const msg = config.incomingMessage.toLowerCase();
      triggerMatched = keywords.length === 0 || keywords.some((k) => msg.includes(k.toLowerCase()));
    } else if (triggerType === "welcome" || triggerType === "default" || isCaseTriggerType(triggerType)) {
      // Los disparadores de gestión no dependen del mensaje: se asume que el evento ocurrió.
      triggerMatched = true;
    }

    steps.push({
      nodeId: triggerNode.id,
      nodeType: "trigger",
      nodeLabel: (triggerData.label as string) || "Disparador",
      result: {
        type: "trigger",
        matched: triggerMatched,
        triggerType,
        keywords: keywords.length > 0 ? keywords : undefined,
      },
    });

    if (!triggerMatched) {
      errors.push(
        `El disparador no coincidió. Palabras clave: [${keywords.join(", ")}], Mensaje: "${config.incomingMessage}"`
      );
      return { steps, errors, completed: false };
    }

    // 2. Follow edges from trigger
    const firstEdge = edges.find((e) => e.source === triggerNode.id);
    if (!firstEdge) {
      errors.push("El disparador no tiene conexión de salida");
      return { steps, errors, completed: false };
    }
    currentNodeId = firstEdge.target;
  }

  let stepCount = 0;
  const maxSteps = 50;

  // 3. Traverse
  while (currentNodeId && stepCount < maxSteps) {
    stepCount++;
    const node = nodes.find((n) => n.id === currentNodeId);
    if (!node) {
      errors.push(`Nodo no encontrado: ${currentNodeId}`);
      break;
    }

    const data = node.data as Record<string, unknown>;
    const label = (data.label as string) || node.type || "Desconocido";
    let nextHandle: string | undefined;
    let shouldPause = false;

    // Las acciones y los nodos de gestión se guardan como "action" con
    // data.actionType: se resuelven igual que en el motor.
    const kind: string = nodeKind(node) || "unknown";

    switch (kind) {
      case "sendMessage": {
        // Botones y respuestas rápidas viven en cada mensaje (así los guarda el
        // panel); los del nodo se aceptan por compatibilidad.
        type RawMessage = {
          text?: string;
          buttons?: SimulatedButton[];
          quickReplies?: Array<{ title: string }>;
        };
        const messages = (data.messages as RawMessage[]) || [];
        const texts = messages
          .filter((m) => m.text)
          .map((m) => interpolate(m.text!, variables));
        const buttons: SimulatedButton[] = [
          ...messages.flatMap((m) => m.buttons ?? []),
          ...((data.buttons as SimulatedButton[]) ?? []),
        ]
          .filter((b) => b?.title)
          .map((b) => ({ title: interpolate(b.title, variables), type: b.type, url: b.url }));
        const quickReplies = [
          ...messages.flatMap((m) => m.quickReplies ?? []),
          ...((data.quickReplies as Array<{ title: string }>) ?? []),
        ]
          .filter((q) => q?.title)
          .map((q) => ({ title: interpolate(q.title, variables) }));
        if (config.windowOpen === false) {
          // Ventana de 24 h cerrada: plantilla del nodo o no se envía.
          const template = parseNodeTemplate(data.template);
          const decision = decideSendMode({
            platform: "whatsapp",
            windowOpen: false,
            hasText: texts.length > 0,
            hasTemplate: !!template,
          });
          if (decision.mode === "template" && template) {
            steps.push({
              nodeId: node.id,
              nodeType: "sendMessage",
              nodeLabel: label,
              result: {
                type: "template",
                templateName: template.template_name,
                language: template.language,
                params: previewTemplateParams(template.params),
              },
            });
            break;
          }
          if (decision.mode === "skip") {
            steps.push({
              nodeId: node.id,
              nodeType: "sendMessage",
              nodeLabel: label,
              result: { type: "message_skipped", reason: SKIP_REASON_LABELS[decision.reason] },
            });
            break;
          }
        }
        steps.push({
          nodeId: node.id,
          nodeType: "sendMessage",
          nodeLabel: label,
          result: {
            type: "message",
            texts: texts.length > 0 ? texts : ["(mensaje vacío)"],
            buttons: buttons.length > 0 ? buttons : undefined,
            quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
          },
        });
        break;
      }

      case "condition": {
        const conditions = (data.conditions as Array<{
          field: string;
          operator: string;
          value: string;
        }>) || [];
        const logic = (data.logic as string) || "and";

        const facts = {
          platform: "instagram", // simulado
          isSubscribed,
          tags: [...tags],
          customFields,
          variables,
        };
        const results = conditions.map((c) => {
          if (isCaseConditionField(c.field)) {
            return evaluateCaseCondition(
              { field: c.field, operator: c.operator, value: c.value },
              caseState
            );
          }
          return evaluateContactCondition(c as FlowCondition, facts);
        });

        const passed =
          logic === "and" ? results.every(Boolean) : results.some(Boolean);

        steps.push({
          nodeId: node.id,
          nodeType: "condition",
          nodeLabel: label,
          result: {
            type: "condition",
            conditions: conditions.map((c) =>
              isCaseConditionField(c.field)
                ? `${CASE_CONDITION_LABELS[c.field]} ${c.operator} "${c.value}"`
                : describeContactCondition(c)
            ),
            result: passed,
            path: passed ? "true" : "false",
          },
        });
        nextHandle = passed ? "true" : "false";
        break;
      }

      case "classifyCase": {
        const typeName = (data.caseTypeName as string) || (data.caseTypeId as string) || "";
        const stageName = (data.stageName as string) || "";
        const categoryName = (data.categoryName as string) || "";
        if (!data.caseTypeId) {
          steps.push({
            nodeId: node.id,
            nodeType: "classifyCase",
            nodeLabel: label,
            result: { type: "error", message: "Falta elegir el tipo de gestión en el nodo Clasificar gestión." },
          });
          break;
        }
        const opens = caseState.hasOpenCase ? "" : "Como no hay gestión abierta, abriría una. ";
        caseState.hasOpenCase = true;
        caseState.caseTypeId = data.caseTypeId as string;
        caseState.stageId = (data.stageId as string) || null;
        steps.push({
          nodeId: node.id,
          nodeType: "classifyCase",
          nodeLabel: label,
          result: {
            type: "action",
            actionType: "classifyCase",
            detail: `${opens}Clasificaría la gestión como "${typeName}"${stageName ? ` y la pasaría a la etapa "${stageName}"` : ""}${data.categoryId ? `, con la categoría "${categoryName || data.categoryId}"` : ""}`,
          },
        });
        break;
      }

      case "changeStage": {
        const stageName = (data.stageName as string) || (data.stageId as string) || "";
        if (!data.stageId) {
          steps.push({
            nodeId: node.id,
            nodeType: "changeStage",
            nodeLabel: label,
            result: { type: "error", message: "Falta elegir la etapa en el nodo Cambiar etapa." },
          });
          break;
        }
        const opens = caseState.hasOpenCase ? "" : "Como no hay gestión abierta, abriría una. ";
        caseState.hasOpenCase = true;
        caseState.stageId = data.stageId as string;
        steps.push({
          nodeId: node.id,
          nodeType: "changeStage",
          nodeLabel: label,
          result: {
            type: "action",
            actionType: "changeStage",
            detail: `${opens}Cambiaría la etapa de la gestión a "${stageName}"`,
          },
        });
        break;
      }

      case "assignTeam": {
        const reroute = data.mode === "reroute";
        const teamName = (data.teamName as string) || (data.teamId as string) || "";
        if (!reroute && !data.teamId) {
          steps.push({
            nodeId: node.id,
            nodeType: "assignTeam",
            nodeLabel: label,
            result: { type: "error", message: "Falta elegir el equipo en el nodo Asignar a equipo." },
          });
          break;
        }
        const opens = caseState.hasOpenCase ? "" : "Como no hay gestión abierta, abriría una. ";
        caseState.hasOpenCase = true;
        if (!reroute) caseState.teamId = data.teamId as string;
        caseState.hasAssignee = true;
        steps.push({
          nodeId: node.id,
          nodeType: "assignTeam",
          nodeLabel: label,
          result: {
            type: "action",
            actionType: "assignTeam",
            detail: reroute
              ? `${opens}Volvería a calcular el equipo según el tipo de gestión y el contacto, y repartiría la gestión a un asesor del equipo`
              : `${opens}Asignaría la gestión al equipo "${teamName}" y la repartiría a un asesor del equipo`,
          },
        });
        break;
      }

      case "distributeCase": {
        const replace = data.replaceAssignee === true;
        const opens = caseState.hasOpenCase ? "" : "Como no hay gestión abierta, abriría una. ";
        let detail: string;
        if (caseState.hasAssignee && !replace) {
          detail = "La gestión ya tiene responsable: no cambiaría nada";
        } else {
          detail = `${opens}Repartiría la gestión a un asesor del equipo actual${replace ? " (aunque ya tenga responsable)" : ""}`;
          caseState.hasAssignee = true;
        }
        caseState.hasOpenCase = true;
        steps.push({
          nodeId: node.id,
          nodeType: "distributeCase",
          nodeLabel: label,
          result: { type: "action", actionType: "distributeCase", detail },
        });
        break;
      }

      case "delay": {
        const duration = (data.duration as number) || 5;
        const unit = (data.unit as string) || "minutes";
        steps.push({
          nodeId: node.id,
          nodeType: "delay",
          nodeLabel: label,
          result: { type: "delay", duration, unit },
        });
        break;
      }

      case "addTag":
      case "removeTag": {
        const tagName = (data.tagName as string) || "";
        if (tagName) {
          if (kind === "addTag") tags.add(tagName);
          else tags.delete(tagName);
        }
        steps.push({
          nodeId: node.id,
          nodeType: kind,
          nodeLabel: label,
          result: {
            type: "action",
            actionType: kind,
            detail: `${kind === "addTag" ? "Agregar" : "Quitar"} etiqueta: ${tagName || "desconocida"}`,
          },
        });
        break;
      }

      case "action": {
        // Acción sin tipo conocido.
        const actionType = (data.actionType as string) || "unknown";
        steps.push({
          nodeId: node.id,
          nodeType: "action",
          nodeLabel: label,
          result: { type: "action", actionType, detail: actionType },
        });
        break;
      }

      case "setCustomField": {
        const slug = (data.fieldSlug as string) || "desconocido";
        const value = interpolate((data.value as string) || "", variables);
        if (data.fieldSlug) customFields[slug] = value;
        steps.push({
          nodeId: node.id,
          nodeType: "setCustomField",
          nodeLabel: label,
          result: {
            type: "action",
            actionType: "setCustomField",
            detail: `Asignar ${slug} = ${value}`,
          },
        });
        break;
      }

      case "aiResponse": {
        // Placeholder so downstream {{ai_response}} interpolates in the dry run
        variables.ai_response = "[Respuesta de IA]";
        steps.push({
          nodeId: node.id,
          nodeType: "aiResponse",
          nodeLabel: label,
          result: { type: "ai_response", mode: "skipped" },
        });
        break;
      }

      case "abSplit": {
        const paths =
          (data.paths as Array<{ name: string; weight: number }>) || [];
        if (paths.length > 0) {
          const totalWeight = paths.reduce((s, p) => s + p.weight, 0);
          const random = Math.random() * totalWeight;
          let cumulative = 0;
          let selected = paths[0];
          for (const p of paths) {
            cumulative += p.weight;
            if (random <= cumulative) {
              selected = p;
              break;
            }
          }
          steps.push({
            nodeId: node.id,
            nodeType: "abSplit",
            nodeLabel: label,
            result: {
              type: "split",
              selectedPath: selected.name,
              weight: selected.weight,
            },
          });
          nextHandle = selected.name;
        }
        break;
      }

      case "smartDelay": {
        steps.push({
          nodeId: node.id,
          nodeType: "smartDelay",
          nodeLabel: label,
          result: { type: "smart_delay" },
        });
        const reply = replies.shift();
        if (reply === undefined) {
          // Sin respuesta que dar: la conversación queda esperando el siguiente mensaje del cliente.
          return { steps, errors, completed: false, waiting: snapshot(node.id) };
        }
        variables.message = reply;
        steps.push({
          nodeId: node.id,
          nodeType: "reply",
          nodeLabel: "Respuesta del cliente",
          result: { type: "reply", text: reply },
        });
        break;
      }

      case "humanTakeover": {
        // El texto del nodo queda como nota interna en la gestión abierta.
        const note = interpolate((data.message as string) || "", variables).trim();
        steps.push({
          nodeId: node.id,
          nodeType: "humanTakeover",
          nodeLabel: label,
          result: { type: "human_takeover", note: note || undefined },
        });
        shouldPause = true;
        break;
      }

      case "goToFlow": {
        const flowId = (data.flowId as string) || "unknown";
        steps.push({
          nodeId: node.id,
          nodeType: "goToFlow",
          nodeLabel: label,
          result: { type: "go_to_flow", flowId },
        });
        shouldPause = true;
        break;
      }

      case "enrollSequence": {
        const sequenceId = (data.sequenceId as string) || "unknown";
        steps.push({
          nodeId: node.id,
          nodeType: "enrollSequence",
          nodeLabel: label,
          result: { type: "enroll_sequence", sequenceId },
        });
        break;
      }

      case "subscribe":
      case "unsubscribe": {
        isSubscribed = kind === "subscribe";
        steps.push({
          nodeId: node.id,
          nodeType: kind,
          nodeLabel: label,
          result: { type: kind },
        });
        break;
      }

      case "commentReply": {
        const text = interpolate((data.text as string) || "", variables);
        steps.push({
          nodeId: node.id,
          nodeType: "commentReply",
          nodeLabel: label,
          result: { type: "comment_reply", text },
        });
        break;
      }

      case "privateReply": {
        const text = interpolate((data.text as string) || "", variables);
        steps.push({
          nodeId: node.id,
          nodeType: "privateReply",
          nodeLabel: label,
          result: { type: "private_reply", text },
        });
        break;
      }

      case "httpRequest": {
        const method = (data.method as string) || "GET";
        const url = interpolate((data.url as string) || "", variables);
        steps.push({
          nodeId: node.id,
          nodeType: "httpRequest",
          nodeLabel: label,
          result: { type: "http_request", method, url },
        });
        break;
      }

      default: {
        steps.push({
          nodeId: node.id,
          nodeType: node.type || "unknown",
          nodeLabel: label,
          result: {
            type: "error",
            message: `Tipo de nodo desconocido: ${node.type}`,
          },
        });
      }
    }

    if (shouldPause) break;

    // Find next edge
    const nextEdge = nextEdgeFrom(node.id, nextHandle);

    if (!nextEdge) return flowEnd(node.id);

    currentNodeId = nextEdge.target;
  }

  if (stepCount >= maxSteps) {
    errors.push("Simulación detenida: se superaron los 50 pasos (posible bucle)");
  }

  return { steps, errors, completed: stepCount < maxSteps };
}
