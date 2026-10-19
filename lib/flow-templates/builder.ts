// Constructor de grafos para las plantillas de flujos: genera los nodos con el
// mismo formato que guarda el lienzo (tipo `action` con `data.actionType`,
// salidas de condición `yes`/`no`, mensajes con botones y respuestas rápidas)
// y los acomoda en el lienzo.

import type { ConditionRef, NodeRefs, TemplateEdge, TemplateGraph, TemplateNode } from "./types";

export interface KeywordSpec {
  value: string;
  matchType?: "exact" | "contains" | "startsWith";
}

export interface MessageSpec {
  text: string;
  /** Botones de respuesta (hasta 3 en WhatsApp). */
  buttons?: string[];
  /** Respuestas rápidas. */
  quickReplies?: string[];
}

export interface ConditionSpec {
  field: string;
  operator: "equals" | "not_equals" | "contains" | "exists" | "gt" | "lt";
  value?: string;
  ref?: Omit<ConditionRef, "index">;
}

function payloadOf(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Marca un dato de ejemplo que el administrador debe reemplazar antes de publicar. */
export function reemplaza(text: string): string {
  return `[REEMPLAZA: ${text}]`;
}

const X_STEP = 320;
const Y_STEP = 210;

export class FlowBuilder {
  private nodes: TemplateNode[] = [];
  private edges: TemplateEdge[] = [];
  private counter = 0;

  private add(type: TemplateNode["type"], data: Record<string, unknown>, refs?: NodeRefs): string {
    const id = `n${++this.counter}`;
    const node: TemplateNode = { id, type, position: { x: 0, y: 0 }, data };
    if (refs && Object.keys(refs).length > 0) node.refs = refs;
    this.nodes.push(node);
    return id;
  }

  // ── Disparadores ────────────────────────────────────────────────────────

  welcomeTrigger(label = "Primer mensaje del cliente"): string {
    return this.add("trigger", { label, triggerType: "welcome" });
  }

  /**
   * Gestión nueva (case_opened): se abre una gestión entrante, sea el primer mensaje de un cliente
   * nuevo o el de uno que vuelve sin gestión abierta. Con `onlyUnclassified` solo si quedó sin clasificar.
   */
  newCaseTrigger(label = "Gestión nueva", opts: { onlyUnclassified?: boolean } = {}): string {
    return this.add("trigger", {
      label,
      triggerType: "case_opened",
      ...(opts.onlyUnclassified ? { onlyUnclassified: true } : {}),
    });
  }

  defaultTrigger(label = "Cualquier otro mensaje"): string {
    return this.add("trigger", { label, triggerType: "default" });
  }

  keywordTrigger(keywords: Array<string | KeywordSpec>, label = "Palabras clave"): string {
    return this.add("trigger", {
      label,
      triggerType: "keyword",
      keywords: keywords.map((k) =>
        typeof k === "string"
          ? { value: k, matchType: "contains" }
          : { value: k.value, matchType: k.matchType ?? "contains" },
      ),
    });
  }

  stageTrigger(opts: { caseType: string; stage: string; label: string }): string {
    return this.add(
      "trigger",
      { label: opts.label, triggerType: "case_stage_changed" },
      { caseType: opts.caseType, stage: opts.stage },
    );
  }

  closedTrigger(opts: { caseType: string; outcome: "won" | "lost" | "resolved"; label: string }): string {
    return this.add(
      "trigger",
      { label: opts.label, triggerType: "case_closed", outcome: opts.outcome },
      { caseType: opts.caseType },
    );
  }

  noReplyTrigger(opts: { caseType: string; minutes: number; label: string }): string {
    return this.add(
      "trigger",
      { label: opts.label, triggerType: "client_no_reply", minutes: opts.minutes },
      { caseType: opts.caseType },
    );
  }

  // ── Mensajes y lógica ───────────────────────────────────────────────────

  message(
    label: string,
    messages: MessageSpec | MessageSpec[],
    template?: { template_name: string; language: string; params: string[] },
  ): string {
    const list = Array.isArray(messages) ? messages : [messages];
    const data: Record<string, unknown> = {
      label,
      messages: list.map((m) => ({
        text: m.text,
        ...(m.buttons?.length
          ? { buttons: m.buttons.map((title) => ({ title, type: "postback", payload: payloadOf(title) })) }
          : {}),
        ...(m.quickReplies?.length
          ? { quickReplies: m.quickReplies.map((title) => ({ title, payload: payloadOf(title) })) }
          : {}),
      })),
    };
    if (template) data.template = template;
    return this.add("sendMessage", data);
  }

  /** Espera inteligente: pausa el flujo hasta que el cliente responde. */
  wait(label = "Esperar la respuesta del cliente", minutes = 1440): string {
    return this.add("action", { label, actionType: "smartDelay", timeout: minutes, timeoutUnit: "minutes" });
  }

  condition(label: string, conditions: ConditionSpec[], logic: "and" | "or" = "and"): string {
    const refs: ConditionRef[] = [];
    conditions.forEach((c, index) => {
      if (c.ref) refs.push({ ...c.ref, index });
    });
    return this.add(
      "condition",
      {
        label,
        logic,
        conditions: conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value ?? "" })),
      },
      refs.length > 0 ? { conditions: refs } : undefined,
    );
  }

  /**
   * Condición sobre el texto de la última respuesta del cliente (variable
   * message). El motor compara sin mayúsculas ni tildes, así que basta una.
   */
  replyContains(label: string, text: string): string {
    return this.condition(label, [{ field: "variable:message", operator: "contains", value: text }]);
  }

  /** Espera fija antes del siguiente paso. */
  delay(label: string, duration: number, unit: "seconds" | "minutes" | "hours" | "days"): string {
    return this.add("delay", { label, duration, unit });
  }

  // ── Acciones ────────────────────────────────────────────────────────────

  tag(label: string, tagName: string): string {
    return this.add("action", { label, actionType: "addTag", tagName });
  }

  setField(label: string, fieldSlug: string, value: string): string {
    return this.add("action", { label, actionType: "setCustomField", fieldSlug, value });
  }

  /** Clasificar gestión: tipo, etapa y categoría (del mismo tipo) opcionales. */
  classify(label: string, opts: { caseType: string; stage?: string; category?: string }): string {
    return this.add(
      "action",
      { label, actionType: "classifyCase" },
      {
        caseType: opts.caseType,
        ...(opts.stage ? { stage: opts.stage } : {}),
        ...(opts.category ? { category: opts.category } : {}),
      },
    );
  }

  changeStage(label: string, opts: { caseType: string; stage: string }): string {
    return this.add(
      "action",
      { label, actionType: "changeStage" },
      { stageCaseType: opts.caseType, stage: opts.stage },
    );
  }

  assignTeam(label: string, team: string): string {
    return this.add("action", { label, actionType: "assignTeam", mode: "fixed" }, { team });
  }

  distribute(label = "Repartir a un asesor"): string {
    return this.add("action", { label, actionType: "distributeCase" });
  }

  takeover(label: string, note?: string): string {
    return this.add("action", { label, actionType: "humanTakeover", ...(note ? { message: note } : {}) });
  }

  unsubscribe(label = "Desuscribir al contacto"): string {
    return this.add("action", { label, actionType: "unsubscribe", confirmed: true });
  }

  // ── Conexiones ──────────────────────────────────────────────────────────

  link(from: string, to: string, handle?: "yes" | "no"): this {
    const id = `e${this.edges.length + 1}`;
    this.edges.push({ id, source: from, target: to, ...(handle ? { sourceHandle: handle } : {}) });
    return this;
  }

  /** Conecta en fila: a -> b -> c ... Devuelve el último id. */
  chain(...ids: string[]): string {
    for (let i = 0; i < ids.length - 1; i++) this.link(ids[i], ids[i + 1]);
    return ids[ids.length - 1];
  }

  yes(cond: string, to: string): this {
    return this.link(cond, to, "yes");
  }

  no(cond: string, to: string): this {
    return this.link(cond, to, "no");
  }

  build(): TemplateGraph {
    return { nodes: layout(this.nodes, this.edges), edges: this.edges };
  }
}

/** Acomoda los nodos por niveles (camino más largo desde el disparador). */
export function layout(nodes: TemplateNode[], edges: TemplateEdge[]): TemplateNode[] {
  const level = new Map<string, number>();
  const root = nodes.find((n) => n.type === "trigger");
  if (!root) return nodes;
  level.set(root.id, 0);
  // Relajación sobre un grafo sin ciclos: el nivel es el camino más largo.
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of edges) {
      const from = level.get(e.source);
      if (from === undefined) continue;
      if ((level.get(e.target) ?? -1) < from + 1) {
        level.set(e.target, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Orden dentro del nivel: por aparición en un recorrido que visita primero "Sí".
  const order = new Map<string, number>();
  const visit = (id: string) => {
    if (order.has(id)) return;
    order.set(id, order.size);
    for (const e of edges.filter((x) => x.source === id)) visit(e.target);
  };
  visit(root.id);

  const byLevel = new Map<number, TemplateNode[]>();
  for (const n of nodes) {
    const l = level.get(n.id) ?? 0;
    byLevel.set(l, [...(byLevel.get(l) ?? []), n]);
  }
  for (const [l, list] of byLevel) {
    list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    list.forEach((n, i) => {
      n.position = { x: Math.round(400 + (i - (list.length - 1) / 2) * X_STEP), y: l * Y_STEP };
    });
  }
  return nodes;
}
