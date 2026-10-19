// Qué puede contestar el cliente cuando el flujo espera su respuesta: cada
// botón o respuesta rápida del último menú y, para las condiciones sobre el
// mensaje, una respuesta que entre por cada rama (y una genérica que no entre
// por ninguna). Puro.

import { evaluateConditionNode } from "@/lib/flow-engine/condition-eval";
import { isCaseConditionField } from "@/lib/flow-engine/case-conditions";
import { selectNextEdge } from "@/lib/flow-engine/graph";
import { readMenu } from "@/lib/flow-engine/menu-reply";
import { nodeKind } from "@/lib/flow-engine/node-kind";
import { upgradeCondition } from "@/lib/flow-engine/condition-fields";
import type { LabFlow, LabSession, LabState } from "../types";
import { conditionsOf, isMessageCondition, satisfyingValue, violatingValue } from "./dimensions";
import type { ExploreStep } from "./types";

/** Respuesta de texto libre cuando nada más la pide. */
export const GENERIC_REPLY = "Respuesta de prueba";

const MAX_WALK = 60;

/** Nodos donde el recorrido de una respuesta se detiene (otra espera, otro flujo, una persona, una prueba A/B). */
function stopsWalk(kind: string): boolean {
  return kind === "smartDelay" || kind === "goToFlow" || kind === "humanTakeover" || kind === "abSplit";
}

function messageFacts(text: string) {
  return { isSubscribed: true, tags: [] as string[], customFields: {}, variables: { message: text } };
}

/**
 * Recorre el flujo desde el nodo de espera con una respuesta y devuelve la
 * «firma» de lo que decide esa respuesta: qué salida toma cada condición sobre
 * el mensaje y dónde se detiene. Dos respuestas con la misma firma llevan al
 * mismo sitio.
 */
export function replySignature(flow: LabFlow, waitNodeId: string, text: string): string {
  const parts: string[] = [];
  let edge = selectNextEdge(flow.edges, waitNodeId);
  for (let i = 0; i < MAX_WALK && edge; i++) {
    const node = flow.nodes.find((n) => n.id === edge!.target);
    if (!node) break;
    const kind = nodeKind(node);
    if (kind === "condition") {
      const conditions = conditionsOf(node).map((c) => upgradeCondition(c, isCaseConditionField));
      const onMessage = conditions.filter(isMessageCondition);
      if (onMessage.length === 0) {
        // Una condición que no depende de la respuesta: el recorrido seguiría igual por ambas salidas.
        parts.push(`${node.id}:?`);
        return parts.join(";");
      }
      const logic = String((node.data as { logic?: unknown }).logic ?? "and");
      const { passed } = evaluateConditionNode({ conditions: onMessage, logic }, { ...messageFacts(text) }, null);
      parts.push(`${node.id}:${passed ? "y" : "n"}`);
      if (onMessage.length < conditions.length) return parts.join(";");
      edge = selectNextEdge(flow.edges, node.id, passed ? "true" : "false");
      continue;
    }
    if (stopsWalk(kind)) {
      parts.push(`stop:${node.id}`);
      return parts.join(";");
    }
    edge = selectNextEdge(flow.edges, node.id);
  }
  parts.push("fin");
  return parts.join(";");
}

/** Condiciones sobre el mensaje que se pueden alcanzar desde el nodo de espera (sin cruzar otra espera). */
function reachableMessageConditions(flow: LabFlow, waitNodeId: string) {
  const out: Array<{ operator: string; value: string }> = [];
  const seen = new Set<string>([waitNodeId]);
  const queue = flow.edges.filter((e) => e.source === waitNodeId).map((e) => e.target);
  while (queue.length > 0 && seen.size < 200) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = flow.nodes.find((n) => n.id === id);
    if (!node) continue;
    const kind = nodeKind(node);
    if (kind === "condition") {
      for (const c of conditionsOf(node).map((x) => upgradeCondition(x, isCaseConditionField))) {
        if (isMessageCondition(c)) out.push({ operator: c.operator, value: c.value });
      }
    }
    if (stopsWalk(kind) && kind !== "abSplit") continue;
    for (const e of flow.edges) if (e.source === id) queue.push(e.target);
  }
  return out;
}

function candidateTexts(conditions: ReadonlyArray<{ operator: string; value: string }>): string[] {
  // La genérica va primero: entre dos respuestas que llevan al mismo sitio, gana la que no parece un dato.
  const texts: string[] = [];
  const push = (value: string | null) => {
    if (value !== null && value.trim() !== "" && !texts.includes(value)) texts.push(value);
  };
  push(GENERIC_REPLY);
  for (const c of conditions) {
    push(satisfyingValue(c.operator, c.value));
    push(violatingValue(c.operator, c.value));
    const n = Number(c.value);
    if ((c.operator === "gt" || c.operator === "lt") && Number.isFinite(n)) {
      push(String(n));
      push(String(n - 1));
      push(String(n + 1));
    }
  }
  return texts;
}

/** Última respuesta del bot en la conversación. */
function lastBotMessage(state: LabState) {
  for (let i = state.messages.length - 1; i >= 0; i--) if (state.messages[i].author === "bot") return state.messages[i];
  return undefined;
}

/**
 * Las respuestas que se prueban en una espera: cada botón o respuesta rápida del último menú (tal como llega
 * en el canal: botón, o el número de la opción si el canal lo pasó a lista numerada) y las respuestas libres
 * que llevan a ramas que ningún botón cubre.
 */
export function replyOptions(flow: LabFlow, state: LabState, session: LabSession): ExploreStep[] {
  const waitNodeId = session.currentNodeId;
  if (!waitNodeId) return [];
  const steps: ExploreStep[] = [];
  const covered = new Set<string>();
  const menu = readMenu(session.variables);
  const last = lastBotMessage(state);

  menu?.options.forEach((opt, i) => {
    if (opt.link || !opt.title.trim()) return;
    const realButton = menu.kind === "button" ? last?.buttons?.find((b) => b.type === "postback" && b.title === opt.title && b.payload) : undefined;
    const realQuick = menu.kind === "quick_reply" ? last?.quickReplies?.find((q) => q.title === opt.title && q.payload) : undefined;
    covered.add(replySignature(flow, waitNodeId, opt.title));
    if (realButton) {
      steps.push({ kind: "button", label: `Pulsa «${opt.title}»`, seq: steps.length, input: { kind: "button", payload: realButton.payload!, title: opt.title, buttonType: "postback" } });
    } else if (realQuick) {
      steps.push({ kind: "button", label: `Pulsa «${opt.title}»`, seq: steps.length, input: { kind: "button", payload: realQuick.payload, title: opt.title, buttonType: "quick_reply" } });
    } else {
      steps.push({ kind: "button", label: `Elige «${opt.title}» (escribe ${i + 1})`, seq: steps.length, input: { kind: "text", text: String(i + 1) } });
    }
  });

  const conditions = reachableMessageConditions(flow, waitNodeId);
  if (conditions.length === 0) {
    // Nada depende de lo que escriba: con botones basta; sin ellos, una respuesta cualquiera.
    if (steps.length === 0) steps.push({ kind: "text", label: `Escribe «${GENERIC_REPLY}»`, seq: 0, input: { kind: "text", text: GENERIC_REPLY } });
    return steps;
  }
  for (const text of candidateTexts(conditions)) {
    const signature = replySignature(flow, waitNodeId, text);
    if (covered.has(signature)) continue;
    covered.add(signature);
    steps.push({ kind: "text", label: `Escribe «${text}»`, seq: steps.length, input: { kind: "text", text } });
  }
  return steps;
}
