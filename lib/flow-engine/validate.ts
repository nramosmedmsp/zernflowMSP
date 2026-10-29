// Revisión de un flujo antes de publicarlo: errores que lo dejarían roto en
// producción (sin disparador, mensajes vacíos, nodos incompletos) y avisos que
// la persona puede aceptar (nodos sueltos, variables {{...}} desconocidas,
// palabras clave repetidas en otro flujo publicado). Pura: la usan la ruta de
// publicación (el servidor es quien decide) y el editor.

import { nodeKind } from "./node-kind";

/**
 * Datos del contacto que el bot llena solo. Es la misma lista que
 * CONTACT_FLOW_VARIABLES (contact-variables.ts); se repite aquí para que el
 * editor no cargue código de servidor, y una prueba vigila que coincidan.
 */
export const CONTACT_VARIABLE_NAMES = ["nombre", "fecha_clave", "empresa"] as const;

export interface FlowNodeLike {
  id: string;
  type?: string;
  data?: unknown;
}

export interface FlowEdgeLike {
  source: string;
  target: string;
}

export type FlowIssueSeverity = "error" | "warning";

export interface FlowIssue {
  severity: FlowIssueSeverity;
  code:
    | "no_trigger"
    | "trigger_no_keywords"
    | "trigger_no_payload"
    | "trigger_not_connected"
    | "empty_message"
    | "incomplete_node"
    | "unreachable_node"
    | "unknown_variable"
    | "go_to_self"
    | "keyword_collision";
  message: string;
  nodeId?: string;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Palabras clave de un nodo disparador (formato del panel o de las plantillas), sin vacías. */
export function triggerKeywords(data: unknown): string[] {
  const d = rec(data);
  const config = rec(d.config);
  const raw = Array.isArray(d.keywords) ? d.keywords : Array.isArray(config.keywords) ? config.keywords : [];
  return raw
    .map((k) => (typeof k === "string" ? k : text(rec(k).value)))
    .map((k) => k.trim())
    .filter((k) => k !== "");
}

/** Forma comparable de una palabra clave: sin mayúsculas ni espacios de más. */
export function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

/** Nombre de la etiqueta del nodo según cómo lo muestra el lienzo. */
const NODE_LABELS: Record<string, string> = {
  trigger: "Disparador",
  sendMessage: "Enviar mensaje",
  goToFlow: "Ir a flujo",
  enrollSequence: "Inscribir en secuencia",
  addTag: "Agregar etiqueta",
  removeTag: "Quitar etiqueta",
  httpRequest: "Solicitud HTTP",
  setCustomField: "Campo personalizado",
};

function labelOf(node: FlowNodeLike): string {
  return NODE_LABELS[nodeKind(node)] ?? "Nodo";
}

/** ¿El mensaje tiene algo que enviar (texto, archivo, tarjetas)? */
export function messageHasContent(message: unknown): boolean {
  const m = rec(message);
  if (text(m.text) || text(m.imageUrl) || text(m.mediaUrl)) return true;
  const elements = rec(m.carousel).elements;
  return Array.isArray(elements) && elements.length > 0;
}

/** Variables {{x}} o {{x.y}} de un texto: la primera parte de cada una. */
export function variableRoots(value: string): string[] {
  const roots: string[] = [];
  for (const match of value.matchAll(/\{\{(\w+(?:\.\w+)*)\}\}/g)) roots.push(match[1].split(".")[0]);
  return roots;
}

function upstreamIds(nodeId: string, edges: readonly FlowEdgeLike[]): Set<string> {
  const seen = new Set<string>();
  const queue = [nodeId];
  for (let i = 0; i < queue.length; i++) {
    for (const e of edges) {
      if (e.target !== queue[i] || seen.has(e.source)) continue;
      seen.add(e.source);
      queue.push(e.source);
    }
  }
  return seen;
}

/**
 * Variables que el bot tiene disponibles al llegar a un nodo: el mensaje del
 * cliente, los datos del contacto, los del comentario (si el flujo nace de uno)
 * y lo que producen los nodos anteriores (IA, Solicitud HTTP).
 */
export function availableVariablesFor(
  nodeId: string,
  nodes: readonly FlowNodeLike[],
  edges: readonly FlowEdgeLike[],
): string[] {
  const variables: string[] = ["message", ...CONTACT_VARIABLE_NAMES];
  const trigger = nodes.find((n) => n.type === "trigger");
  if (rec(trigger?.data).triggerType === "comment_keyword") {
    variables.push("comment_id", "comment_text", "commenter_name", "post_id");
  }
  const upstream = upstreamIds(nodeId, edges);
  for (const n of nodes) {
    if (!upstream.has(n.id)) continue;
    const kind = nodeKind(n);
    if (kind === "aiResponse" && !variables.includes("ai_response")) variables.push("ai_response");
    if (kind === "httpRequest") {
      const name = text(rec(n.data).responseVariable);
      if (name && !variables.includes(name)) variables.push(name);
    }
  }
  return variables;
}

function messageTexts(message: unknown): string[] {
  const m = rec(message);
  const out: string[] = [];
  if (typeof m.text === "string") out.push(m.text);
  const elements = rec(m.carousel).elements;
  if (Array.isArray(elements)) {
    for (const el of elements) {
      const e = rec(el);
      if (typeof e.title === "string") out.push(e.title);
      if (typeof e.subtitle === "string") out.push(e.subtitle);
    }
  }
  return out;
}

export interface ValidateOptions {
  /** Id del flujo que se publica (para avisar si "Ir a flujo" apunta a sí mismo). */
  flowId?: string;
}

export function validateFlowGraph(
  nodes: readonly FlowNodeLike[],
  edges: readonly FlowEdgeLike[],
  options: ValidateOptions = {},
): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const add = (issue: FlowIssue) => issues.push(issue);

  const triggers = nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) {
    add({
      severity: "error",
      code: "no_trigger",
      message: "Falta un disparador: sin él el flujo nunca se activa. Arrastra un nodo Disparador al lienzo.",
    });
  }

  for (const t of triggers) {
    const d = rec(t.data);
    const type = text(d.triggerType) || "keyword";
    if ((type === "keyword" || type === "comment_keyword") && triggerKeywords(t.data).length === 0) {
      add({
        severity: "error",
        code: "trigger_no_keywords",
        nodeId: t.id,
        message: "El disparador no tiene palabras clave: nadie podrá activar el flujo.",
      });
    }
    if ((type === "postback" || type === "quick_reply") && !text(d.payload) && !text(rec(d.config).payload)) {
      add({
        severity: "error",
        code: "trigger_no_payload",
        nodeId: t.id,
        message: "El disparador de botón no indica qué botón lo activa.",
      });
    }
    if (!edges.some((e) => e.source === t.id)) {
      add({
        severity: "error",
        code: "trigger_not_connected",
        nodeId: t.id,
        message: "El disparador no está conectado a ningún paso: el flujo no haría nada.",
      });
    }
  }

  for (const n of nodes) {
    const d = rec(n.data);
    const kind = nodeKind(n);
    if (kind === "sendMessage") {
      const messages = Array.isArray(d.messages) ? d.messages : [];
      if (messages.length === 0 || messages.some((m) => !messageHasContent(m))) {
        add({
          severity: "error",
          code: "empty_message",
          nodeId: n.id,
          message:
            messages.length === 0
              ? "Un nodo «Enviar mensaje» no tiene ningún mensaje."
              : "Un nodo «Enviar mensaje» tiene un mensaje vacío: escribe el texto o quítalo.",
        });
      }
    } else if (kind === "goToFlow") {
      if (!text(d.flowId)) {
        add({ severity: "error", code: "incomplete_node", nodeId: n.id, message: "«Ir a flujo» no tiene un flujo de destino elegido." });
      } else if (options.flowId && d.flowId === options.flowId) {
        add({ severity: "warning", code: "go_to_self", nodeId: n.id, message: "«Ir a flujo» apunta a este mismo flujo." });
      }
    } else if (kind === "enrollSequence" && !text(d.sequenceId)) {
      add({ severity: "error", code: "incomplete_node", nodeId: n.id, message: "«Inscribir en secuencia» no tiene una secuencia elegida." });
    } else if ((kind === "addTag" || kind === "removeTag") && !text(d.tagName)) {
      add({ severity: "error", code: "incomplete_node", nodeId: n.id, message: `«${labelOf(n)}» no tiene el nombre de la etiqueta.` });
    } else if (kind === "httpRequest" && !text(d.url)) {
      add({ severity: "error", code: "incomplete_node", nodeId: n.id, message: "«Solicitud HTTP» no tiene dirección." });
    }
  }

  // Nodos que ningún disparador alcanza: quedan en el lienzo sin ejecutarse nunca.
  if (triggers.length > 0) {
    const reached = new Set<string>(triggers.map((t) => t.id));
    const queue = [...reached];
    for (let i = 0; i < queue.length; i++) {
      for (const e of edges) {
        if (e.source !== queue[i] || reached.has(e.target)) continue;
        reached.add(e.target);
        queue.push(e.target);
      }
    }
    for (const n of nodes) {
      if (reached.has(n.id)) continue;
      add({
        severity: "warning",
        code: "unreachable_node",
        nodeId: n.id,
        message: `Un nodo «${labelOf(n)}» no está conectado al disparador: nunca se ejecutará.`,
      });
    }
  }

  // Variables {{x}} que el bot no va a llenar.
  const everyHttpVariable = nodes
    .filter((n) => nodeKind(n) === "httpRequest")
    .map((n) => text(rec(n.data).responseVariable))
    .filter(Boolean);
  for (const n of nodes) {
    if (nodeKind(n) !== "sendMessage") continue;
    const messages = Array.isArray(rec(n.data).messages) ? (rec(n.data).messages as unknown[]) : [];
    const known = new Set([...availableVariablesFor(n.id, nodes, edges), ...everyHttpVariable]);
    const unknown = new Set<string>();
    for (const m of messages) for (const t of messageTexts(m)) for (const root of variableRoots(t)) if (!known.has(root)) unknown.add(root);
    if (unknown.size > 0) {
      const list = [...unknown].map((v) => `{{${v}}}`).join(", ");
      add({
        severity: "warning",
        code: "unknown_variable",
        nodeId: n.id,
        message: `El mensaje usa ${list}, que el bot no conoce: el cliente recibiría el espacio en blanco. Variables disponibles: {{nombre}}, {{fecha_clave}}, {{empresa}}.`,
      });
    }
  }

  return issues;
}

export interface OtherFlowKeywords {
  flowId: string;
  flowName: string;
  keywords: readonly string[];
}

/** Palabras clave de este flujo que otro flujo publicado ya usa (aviso, no error). */
export function findKeywordCollisions(
  ownKeywords: readonly string[],
  others: readonly OtherFlowKeywords[],
): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const seen = new Set<string>();
  for (const keyword of ownKeywords) {
    const norm = normalizeKeyword(keyword);
    if (!norm) continue;
    for (const other of others) {
      const key = `${norm}\u0000${other.flowId}`;
      if (seen.has(key)) continue;
      if (other.keywords.some((k) => normalizeKeyword(k) === norm)) {
        seen.add(key);
        issues.push({
          severity: "warning",
          code: "keyword_collision",
          message: `La palabra clave «${keyword.trim()}» también la usa el flujo publicado «${other.flowName}». Si un cliente la escribe, solo responderá uno de los dos.`,
        });
      }
    }
  }
  return issues;
}

export const hasErrors = (issues: readonly FlowIssue[]): boolean => issues.some((i) => i.severity === "error");
