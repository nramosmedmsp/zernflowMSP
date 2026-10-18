/**
 * Client-side flow simulator. Runs a dry-run traversal of flow nodes/edges
 * without any database writes or API calls. Used for the "Test" panel in the
 * flow builder.
 */

import type { Node, Edge } from "@xyflow/react";
import { CASE_ACTION_TYPES } from "./types";
import { isCaseTriggerType } from "./case-trigger-match";
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
      buttons?: { title: string }[];
      quickReplies?: { title: string }[];
    }
  | { type: "condition"; conditions: string[]; result: boolean; path: string }
  | { type: "delay"; duration: number; unit: string }
  | { type: "action"; actionType: string; detail: string }
  | { type: "ai_response"; mode: "skipped" | "generated"; text?: string }
  | { type: "split"; selectedPath: string; weight: number }
  | { type: "smart_delay" }
  | { type: "human_takeover" }
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

export interface SimulationConfig {
  incomingMessage: string;
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
  completed: boolean;
}

// --- Helpers ---

function resolvePath(
  variables: Record<string, string>,
  path: string
): unknown {
  let value: unknown = variables;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

// Mirrors interpolateVariables in engine.ts (dot paths, JSON for objects,
// literal token when unresolved) so test-mode previews match production.
function interpolate(
  text: string,
  variables: Record<string, string>
): string {
  return text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (token, path: string) => {
    const value = resolvePath(variables, path);
    if (value === null || value === undefined) return token;
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

function evaluateCondition(
  actual: string | undefined,
  operator: string,
  expected: string
): boolean {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "contains":
      return actual?.includes(expected) || false;
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "gt":
      return Number(actual) > Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    default:
      return false;
  }
}

// --- Simulator ---

export function simulateFlow(
  nodes: Node[],
  edges: Edge[],
  config: SimulationConfig
): SimulationResult {
  const steps: SimulationStep[] = [];
  const errors: string[] = [];
  const variables: Record<string, string> = {
    message: config.incomingMessage,
  };

  // Gestión simulada: los nodos de gestión la modifican y las condiciones la leen.
  const caseState: CaseConditionSnapshot & { hasOpenCase: boolean } = {
    contactTypeId: config.mockContact?.contactTypeId ?? null,
    caseTypeId: config.mockCase?.caseTypeId ?? null,
    stageId: config.mockCase?.stageId ?? null,
    teamId: config.mockCase?.teamId ?? null,
    hasAssignee: config.mockCase?.hasAssignee ?? false,
    withinHours: config.mockCase?.withinHours ?? true,
    hasOpenCase: config.mockCase?.hasOpenCase ?? true,
  };

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
  const rawKeywords =
    (triggerData.keywords as Array<string | { value: string }>) || [];
  const keywords = rawKeywords
    .map((k) => (typeof k === "string" ? k : k?.value ?? ""))
    .filter((k) => k.length > 0);
  let triggerMatched = false;

  if (triggerType === "keyword") {
    const msg = config.incomingMessage.toLowerCase();
    triggerMatched =
      keywords.length === 0 ||
      keywords.some((k) => msg.includes(k.toLowerCase()));
  } else if (
    triggerType === "welcome" ||
    triggerType === "default" ||
    isCaseTriggerType(triggerType)
  ) {
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

  let currentNodeId: string | undefined = firstEdge.target;
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

    // Los nodos de gestión se guardan como "action" con data.actionType.
    const actionType = data.actionType as string | undefined;
    const kind: string =
      node.type === "action" && actionType && (CASE_ACTION_TYPES as readonly string[]).includes(actionType)
        ? actionType
        : node.type || "unknown";

    switch (kind) {
      case "sendMessage": {
        const messages = (data.messages as Array<{ type?: string; text?: string; imageUrl?: string }>) || [];
        const texts = messages
          .filter((m) => m.text)
          .map((m) => interpolate(m.text!, variables));
        const buttons = (data.buttons as Array<{ title: string }>) || [];
        const quickReplies = (data.quickReplies as Array<{ title: string }>) || [];
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

        const results = conditions.map((c) => {
          let fieldValue: string | undefined;

          if (isCaseConditionField(c.field)) {
            return evaluateCaseCondition(
              { field: c.field, operator: c.operator, value: c.value },
              caseState
            );
          }
          if (c.field === "platform") {
            fieldValue = "instagram"; // simulated
          } else if (c.field === "is_subscribed") {
            fieldValue = String(config.mockContact?.isSubscribed ?? true);
          } else if (c.field.startsWith("tag:")) {
            const tagName = c.field.replace("tag:", "");
            fieldValue = String(
              config.mockContact?.tags?.includes(tagName) ?? false
            );
          } else if (c.field === "has_tag") {
            // Simple tag check: value is the tag name
            fieldValue = String(
              config.mockContact?.tags?.includes(c.value) ?? false
            );
          } else if (c.field.startsWith("variable:")) {
            const varName = c.field.replace("variable:", "");
            fieldValue = variables[varName];
          } else {
            fieldValue = config.mockContact?.customFields?.[c.field];
          }

          return evaluateCondition(fieldValue, c.operator, c.value);
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
                : `${c.field} ${c.operator} "${c.value}"`
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
            detail: `${opens}Clasificaría la gestión como "${typeName}"${stageName ? ` y la pasaría a la etapa "${stageName}"` : ""}`,
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
        const tagName = (data.tagName as string) || "desconocida";
        const actionType =
          kind === "addTag"
            ? "addTag"
            : (data.actionType as string) || kind;
        steps.push({
          nodeId: node.id,
          nodeType: kind,
          nodeLabel: label,
          result: {
            type: "action",
            actionType,
            detail:
              actionType === "addTag" || actionType === "add"
                ? `Agregar etiqueta: ${tagName}`
                : `Quitar etiqueta: ${tagName}`,
          },
        });
        break;
      }

      case "action": {
        const actionType = (data.actionType as string) || "unknown";
        const tagName = (data.tagName as string) || "";
        const fieldSlug = (data.fieldSlug as string) || "";
        const fieldValue = (data.value as string) || "";
        let detail = actionType;
        if (actionType === "addTag") detail = `Agregar etiqueta: ${tagName}`;
        else if (actionType === "removeTag") detail = `Quitar etiqueta: ${tagName}`;
        else if (actionType === "setCustomField")
          detail = `Asignar ${fieldSlug} = ${fieldValue}`;
        steps.push({
          nodeId: node.id,
          nodeType: "action",
          nodeLabel: label,
          result: { type: "action", actionType, detail },
        });
        break;
      }

      case "setCustomField": {
        const slug = (data.fieldSlug as string) || "desconocido";
        const value = interpolate((data.value as string) || "", variables);
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
        shouldPause = true;
        break;
      }

      case "humanTakeover": {
        steps.push({
          nodeId: node.id,
          nodeType: "humanTakeover",
          nodeLabel: label,
          result: { type: "human_takeover" },
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
        steps.push({
          nodeId: node.id,
          nodeType: kind,
          nodeLabel: label,
          result: { type: node.type as "subscribe" | "unsubscribe" },
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
      nextEdge = edges.find(
        (e) => e.source === node.id && !!e.sourceHandle && accepted.includes(e.sourceHandle)
      );
    }
    if (!nextEdge) {
      nextEdge = edges.find(
        (e) => e.source === node.id && !e.sourceHandle
      );
    }
    if (!nextEdge) {
      // Try any edge from this source (fallback)
      nextEdge = edges.find((e) => e.source === node.id);
    }

    if (!nextEdge) {
      steps.push({
        nodeId: node.id,
        nodeType: "end",
        nodeLabel: "Fin",
        result: { type: "flow_end" },
      });
      return { steps, errors, completed: true };
    }

    currentNodeId = nextEdge.target;
  }

  if (stepCount >= maxSteps) {
    errors.push("Simulación detenida: se superaron los 50 pasos (posible bucle)");
  }

  return { steps, errors, completed: stepCount < maxSteps };
}
