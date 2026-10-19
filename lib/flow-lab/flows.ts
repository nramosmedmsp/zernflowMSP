// Ejecución de flujos sobre el estado simulado: recorrido de nodos, esperas,
// sesiones y eventos de gestión. Sigue el motor real (lib/flow-engine/engine.ts
// y nodes/case-actions.ts) y reutiliza sus funciones puras: coincidencia de
// disparadores y de eventos, condiciones, interpolación, tipos de nodo,
// adaptación por plataforma, texto o plantilla según la ventana de 24 h.

import { buildAutoTemplateParams } from "@/lib/cases/auto-template-params";
import { isOpenAt } from "@/lib/cases/hours";
import { resolveTargetTeamId } from "@/lib/cases/routing";
import { demoTemplateText } from "@/lib/demo";
import { buildCaseConditionSnapshot, CASE_CONDITION_LABELS, isCaseConditionField } from "@/lib/flow-engine/case-conditions";
import {
  CASE_EVENT_VARIABLE,
  CASE_ID_VARIABLE,
  FLOW_CHAIN_VARIABLE,
  MAX_CASE_FLOW_CHAIN,
  canRunInChain,
  extendFlowChain,
  matchesCaseEvent,
  parseFlowChain,
  serializeFlowChain,
} from "@/lib/flow-engine/case-trigger-match";
import { evaluateConditionNode } from "@/lib/flow-engine/condition-eval";
import { describeContactCondition, type FlowCondition } from "@/lib/flow-engine/condition-fields";
import { chooseABPath, delayDurationMs, selectNextEdge } from "@/lib/flow-engine/graph";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { MENU_VARIABLE, recordMenu } from "@/lib/flow-engine/menu-reply";
import { nodeKind, persistsSessionVariables } from "@/lib/flow-engine/node-kind";
import { adaptMessage } from "@/lib/flow-engine/platform-adapter";
import {
  computeFlowWindowOpen,
  decideSendMode,
  messageHasContent,
  parseNodeTemplate,
  SKIP_REASON_LABELS,
  type NodeTemplate,
} from "@/lib/flow-engine/send-mode";
import { smartDelayTimeoutMs } from "@/lib/flow-engine/waiting-session";
import { CASE_ACTION_TYPES } from "@/lib/flow-engine/types";
import { phoneDigits } from "@/lib/whatsapp-templates";
import type { Platform } from "@/lib/types/database";
import { activeFlowIds, caseTypeName, contactTypeName, describeTrigger, stageName, teamName } from "./catalog";
import {
  addSystemNote,
  assignCase,
  assignTo,
  changeStage,
  classifyCase,
  ensureOpenCase,
  findTargetCase,
  pauseAutomation,
  selectEventTriggers,
  setCategory,
  stampBotOutbound,
  transferCase,
} from "./cases";
import type { LabCaseEvent, Run } from "./run";
import { caseById, lastInboundAt, latestOpenCase, nextId } from "./state";
import type { LabButton, LabFlow, LabNode, LabSession } from "./types";

const MAX_TRAVERSAL_DEPTH = 50;
const MAX_FLOW_NESTING = 20;
const MAX_EVENTS_PER_ACTION = 200;

export interface IncomingMessage {
  text?: string;
  postbackPayload?: string;
  quickReplyPayload?: string;
  callbackData?: string;
}

export interface FlowContext {
  triggerId: string;
  flowId: string;
  incoming: IncomingMessage;
  variables: Record<string, string>;
  /** Flujo disparado por un evento: empieza una sesión nueva en vez de reanudar la que espera al cliente. */
  startFresh?: boolean;
}

const NODE_KIND_LABELS: Record<string, string> = {
  trigger: "Disparador",
  sendMessage: "Enviar mensaje",
  condition: "Condición",
  delay: "Espera",
  addTag: "Agregar etiqueta",
  removeTag: "Quitar etiqueta",
  setCustomField: "Guardar campo personalizado",
  httpRequest: "Solicitud HTTP",
  goToFlow: "Ir a otro flujo",
  humanTakeover: "Atención humana",
  subscribe: "Suscribir",
  unsubscribe: "Desuscribir",
  commentReply: "Responder comentario",
  privateReply: "Respuesta privada",
  aiResponse: "Respuesta de IA",
  abSplit: "Prueba A/B",
  smartDelay: "Esperar la respuesta del cliente",
  enrollSequence: "Agregar a secuencia",
  classifyCase: "Clasificar gestión",
  changeStage: "Cambiar etapa",
  assignTeam: "Asignar a equipo",
  distributeCase: "Repartir a asesor",
};

export function nodeKindLabel(kind: string): string {
  return NODE_KIND_LABELS[kind] ?? kind;
}

function flowOf(run: Run, flowId: string): LabFlow | null {
  if (!activeFlowIds(run.catalog, run.state).has(flowId)) return null;
  return run.index.flowById.get(flowId) ?? null;
}

// ── Sesiones ────────────────────────────────────────────────────────────────

/**
 * Sesión activa del contacto que espera su respuesta y cuya espera no venció.
 * Las esperas vencidas se marcan como vencidas. Con varias, la más reciente.
 */
export function findWaitingSession(run: Run): LabSession | null {
  const now = run.now.getTime();
  const rows = run.state.sessions
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.status === "active" && s.waitingForInput)
    .sort((a, b) => new Date(b.s.updatedAt).getTime() - new Date(a.s.updatedAt).getTime() || b.i - a.i)
    .map(({ s }) => s);
  const isExpired = (s: LabSession) => !!s.waitingUntil && new Date(s.waitingUntil).getTime() <= now;
  for (const s of rows.filter(isExpired)) {
    s.status = "expired";
    s.waitingForInput = false;
    run.step("session_expired", `La espera de «${run.index.flowById.get(s.flowId)?.name ?? s.flowId}» venció: la respuesta del cliente ya no la retoma.`, {
      flowId: s.flowId,
      nodeId: s.currentNodeId ?? undefined,
      level: "warning",
    });
  }
  return rows.find((s) => !isExpired(s)) ?? null;
}

function completeSession(run: Run, session: LabSession, why?: string) {
  if (session.status !== "active") return;
  session.status = "completed";
  session.updatedAt = run.nowIso;
  run.step("flow_completed", why ?? "El flujo terminó.", { flowId: session.flowId, level: "ok" });
}

function cancelSession(run: Run, session: LabSession, reason: string) {
  session.status = "cancelled";
  session.updatedAt = run.nowIso;
  run.step("flow_cancelled", reason, { flowId: session.flowId, level: "warning" });
}

/** Cadena de flujos de este contexto, con el flujo en curso incluido. */
export function currentFlowChain(ctx: Pick<FlowContext, "variables" | "flowId">): string[] {
  return extendFlowChain(parseFlowChain(ctx.variables[FLOW_CHAIN_VARIABLE]), ctx.flowId);
}

// ── Ejecutar y reanudar ─────────────────────────────────────────────────────

export function executeFlow(run: Run, ctx: FlowContext): void {
  if (run.flowNesting >= MAX_FLOW_NESTING) {
    run.warn(`Se detiene: más de ${MAX_FLOW_NESTING} flujos encadenados con «Ir a otro flujo» (posible bucle).`);
    return;
  }
  // {{message}} con el texto entrante, como en el motor real.
  if (ctx.incoming.text) ctx.variables.message ??= ctx.incoming.text;

  const waiting = ctx.startFresh ? null : findWaitingSession(run);
  if (waiting) return resumeSession(run, waiting, ctx);

  const flow = flowOf(run, ctx.flowId);
  if (!flow) {
    run.warn(`El flujo ${ctx.flowId} no está activo en la simulación (no está publicado o quedó fuera de la selección): no se ejecuta.`);
    return;
  }

  const session: LabSession = {
    id: nextId(run.state, "session"),
    flowId: flow.id,
    status: "active",
    currentNodeId: null,
    waitingForInput: false,
    waitingUntil: null,
    variables: { ...ctx.variables },
    humanTakeoverAt: null,
    startedAt: run.nowIso,
    updatedAt: run.nowIso,
  };
  run.state.sessions.push(session);
  run.ok("flow_started", `Empieza el flujo «${flow.name}».`, { flowId: flow.id, data: { sessionId: session.id } });

  const triggerNode = flow.nodes.find((n) => n.type === "trigger");
  if (!triggerNode) {
    run.warn(`El flujo «${flow.name}» no tiene nodo disparador.`, { flowId: flow.id });
    return;
  }
  run.visit(flow.id, triggerNode.id, run.steps.length);
  const firstEdge = flow.edges.find((e) => e.source === triggerNode.id);
  const startNode = firstEdge ? flow.nodes.find((n) => n.id === firstEdge.target) : undefined;
  if (!startNode) {
    run.warn(`El disparador del flujo «${flow.name}» no está conectado a ningún nodo.`, { flowId: flow.id, nodeId: triggerNode.id });
    return;
  }
  run.flowNesting++;
  try {
    traverse(run, session, flow, startNode, ctx, 0);
  } finally {
    run.flowNesting--;
  }
}

export function resumeSession(run: Run, session: LabSession, ctx: FlowContext): void {
  const flow = run.index.flowById.get(session.flowId);
  if (!flow) {
    cancelSession(run, session, `El flujo ${session.flowId} ya no existe: se cancela la sesión.`);
    return;
  }
  ctx.flowId = session.flowId;
  ctx.variables = { ...session.variables };

  // La reanudación la mueve una respuesta nueva; un clic en un botón sin texto guarda su carga.
  const reply = ctx.incoming.text || ctx.incoming.quickReplyPayload || ctx.incoming.postbackPayload || ctx.incoming.callbackData;
  if (reply) ctx.variables.message = reply;

  session.waitingForInput = false;
  session.waitingUntil = null;
  session.updatedAt = run.nowIso;

  const current = flow.nodes.find((n) => n.id === session.currentNodeId);
  if (!current) {
    cancelSession(run, session, `El nodo ${session.currentNodeId} ya no existe en el flujo «${flow.name}»: se cancela la sesión.`);
    return;
  }
  run.step("flow_resumed", reply ? `El flujo «${flow.name}» retoma desde «${labelOf(current)}» con la respuesta «${reply}».` : `El flujo «${flow.name}» retoma desde «${labelOf(current)}».`, {
    flowId: flow.id,
    nodeId: current.id,
    level: "ok",
  });

  const nextEdge = selectNextEdge(flow.edges, current.id);
  const nextNode = nextEdge ? flow.nodes.find((n) => n.id === nextEdge.target) : undefined;
  if (!nextNode) {
    completeSession(run, session);
    return;
  }
  run.flowNesting++;
  try {
    traverse(run, session, flow, nextNode, ctx, 0);
  } finally {
    run.flowNesting--;
  }
}

function labelOf(node: LabNode): string {
  const label = node.data?.label;
  return typeof label === "string" && label.trim() ? label : nodeKindLabel(nodeKind(node));
}

function traverse(run: Run, session: LabSession, flow: LabFlow, start: LabNode, ctx: FlowContext, startDepth: number) {
  let node: LabNode = start;
  let depth = startDepth;
  for (;;) {
    if (depth >= MAX_TRAVERSAL_DEPTH) {
      run.warn(`El flujo «${flow.name}» superó los ${MAX_TRAVERSAL_DEPTH} pasos (posible bucle): se detiene.`, { flowId: flow.id });
      completeSession(run, session);
      return;
    }
    session.currentNodeId = node.id;
    session.updatedAt = run.nowIso;
    const kind = nodeKind(node);
    run.visit(flow.id, node.id, run.steps.length + 1);
    run.step("node", `${labelOf(node)} · ${nodeKindLabel(kind)}`, {
      flowId: flow.id,
      nodeId: node.id,
      nodeLabel: labelOf(node),
      data: { nodeKind: kind },
    });

    const result = executeNode(run, session, flow, node, kind, ctx);

    // Las variables se guardan en la sesión después de los mismos nodos que en el motor real.
    if (persistsSessionVariables(node)) session.variables = { ...ctx.variables };

    if (result === "pause") return;

    const handle = typeof result === "string" && result.startsWith("handle:") ? result.replace("handle:", "") : undefined;
    const nextEdge = selectNextEdge(flow.edges, node.id, handle);
    if (!nextEdge) {
      completeSession(run, session, handle ? `El flujo terminó: la salida «${handle}» no está conectada.` : undefined);
      return;
    }
    const nextNode = flow.nodes.find((n) => n.id === nextEdge.target);
    if (!nextNode) {
      completeSession(run, session);
      return;
    }
    node = nextNode;
    depth++;
  }
}

type NodeResult = "pause" | `handle:${string}` | void;

function executeNode(run: Run, session: LabSession, flow: LabFlow, node: LabNode, kind: string, ctx: FlowContext): NodeResult {
  const where = { flowId: flow.id, nodeId: node.id, nodeLabel: labelOf(node) };
  const data = node.data ?? {};
  if ((CASE_ACTION_TYPES as readonly string[]).includes(kind)) {
    executeCaseAction(run, kind, data, ctx, where);
    return;
  }
  switch (kind) {
    case "sendMessage":
      return executeSendMessage(run, flow, node, data, ctx, where);
    case "condition":
      return executeCondition(run, data, ctx, where);
    case "delay": {
      const duration = typeof data.duration === "number" ? data.duration : Number(data.duration);
      const runAt = new Date(run.now.getTime() + delayDurationMs(duration, String(data.unit))).toISOString();
      run.state.jobs.push({ id: nextId(run.state, "job"), type: "resume_flow", sessionId: session.id, nodeId: node.id, runAt, status: "pending" });
      session.waitingUntil = runAt;
      run.step("flow_waiting", `Espera ${duration} ${UNIT_TEXT[String(data.unit)] ?? "segundos"}: el flujo sigue ${formatAt(runAt)}.`, { ...where, data: { until: runAt } });
      return "pause";
    }
    case "addTag":
    case "removeTag": {
      const tagName = typeof data.tagName === "string" ? data.tagName : "";
      if (!tagName) return;
      const tags = run.state.contact.tags;
      if (kind === "addTag") {
        if (!tags.includes(tagName)) tags.push(tagName);
        run.ok("tag_changed", `Se agrega la etiqueta «${tagName}» al contacto.`, { ...where, data: { tag: tagName, change: "added" } });
      } else {
        run.state.contact.tags = tags.filter((t) => t !== tagName);
        run.ok("tag_changed", `Se quita la etiqueta «${tagName}» del contacto.`, { ...where, data: { tag: tagName, change: "removed" } });
      }
      return;
    }
    case "setCustomField": {
      const slug = String(data.fieldSlug ?? "");
      if (!run.catalog.customFields.some((f) => f.slug === slug)) {
        run.warn(`El campo personalizado «${slug}» no existe en el espacio: el motor real no guarda nada.`, where);
        return;
      }
      const value = interpolateVariables(String(data.value ?? ""), ctx.variables);
      run.state.contact.customFields[slug] = value;
      run.ok("custom_field_set", `Se guarda el campo «${slug}» = «${value}».`, { ...where, data: { slug, value } });
      return;
    }
    case "httpRequest": {
      const mocked = run.options.httpResponses && node.id in run.options.httpResponses;
      const responseVariable = typeof data.responseVariable === "string" ? data.responseVariable : "";
      if (mocked && responseVariable) {
        const response = run.options.httpResponses![node.id];
        ctx.variables[responseVariable] = (typeof response === "string" ? response : JSON.stringify(response)) as string;
        run.step("variable_set", `Solicitud HTTP simulada: la variable «${responseVariable}» recibe la respuesta de prueba.`, { ...where, data: { variable: responseVariable } });
      } else {
        run.warn(`La simulación no hace solicitudes HTTP (${String(data.method ?? "GET")} ${interpolateVariables(String(data.url ?? ""), ctx.variables)}): el nodo no tiene efecto.`, where);
      }
      return;
    }
    case "goToFlow": {
      const target = String(data.flowId ?? "");
      const targetFlow = run.index.flowById.get(target);
      run.step("node", `Va al flujo «${targetFlow?.name ?? target}».`, { ...where, data: { goToFlowId: target } });
      executeFlow(run, { ...ctx, flowId: target, startFresh: false });
      return "pause";
    }
    case "humanTakeover": {
      const note = data.message ? interpolateVariables(String(data.message), ctx.variables).trim() : "";
      if (note) {
        const target = findTargetCase(run, ctx.variables[CASE_ID_VARIABLE]);
        if (target) addSystemNote(run, target, note);
        else run.warn("Atención humana: no hay gestión abierta, la nota no se guardó.", where);
      }
      pauseAutomation(run, "nodo Atención humana");
      session.humanTakeoverAt = run.nowIso;
      session.status = "completed";
      session.updatedAt = run.nowIso;
      run.step("flow_completed", "El flujo termina: la conversación pasa a atención humana.", { flowId: flow.id, level: "ok" });
      return "pause";
    }
    case "subscribe":
    case "unsubscribe": {
      run.state.contact.subscribed = kind === "subscribe";
      run.ok("subscription_changed", kind === "subscribe" ? "El contacto queda suscrito." : "El contacto queda dado de baja (no suscrito).", { ...where, data: { subscribed: kind === "subscribe" } });
      return;
    }
    case "commentReply":
    case "privateReply":
      run.warn("Este nodo solo aplica a comentarios de publicaciones: en una conversación de mensajes no se ejecuta.", where);
      return;
    case "aiResponse":
      ctx.variables.ai_response = "[Respuesta de IA]";
      run.warn("La simulación no llama a la IA: {{ai_response}} queda con un texto de ejemplo y no se envía ningún mensaje.", where);
      return;
    case "abSplit": {
      const paths = (data.paths as Array<{ name: string; weight: number }> | undefined) ?? [];
      if (paths.length === 0) {
        run.warn("La prueba A/B no tiene caminos: el flujo termina aquí.", where);
        return;
      }
      const chosen = chooseABPath(paths, (run.options.random ?? Math.random)());
      run.step("node", `Prueba A/B: sigue por el camino «${chosen.name}».`, { ...where, data: { path: chosen.name, weight: chosen.weight } });
      return `handle:${chosen.name}`;
    }
    case "smartDelay": {
      const ms = smartDelayTimeoutMs(data as { timeout?: unknown; timeoutUnit?: unknown });
      const until = new Date(run.now.getTime() + ms).toISOString();
      session.waitingForInput = true;
      session.waitingUntil = until;
      session.currentNodeId = node.id;
      run.step("flow_waiting", `El flujo espera la respuesta del cliente (hasta ${formatAt(until)}).`, { ...where, data: { until } });
      return "pause";
    }
    case "enrollSequence":
      run.warn("La simulación no recorre las secuencias: el contacto no se agrega.", where);
      return;
    default:
      return;
  }
}

const UNIT_TEXT: Record<string, string> = { seconds: "segundos", minutes: "minutos", hours: "horas", days: "días" };

function formatAt(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3_600_000);
  return `${d.toISOString().slice(0, 10).split("-").reverse().join("/")} ${d.toISOString().slice(11, 16)} (Lima)`;
}

// ── Nodos de gestión ────────────────────────────────────────────────────────

type Where = { flowId: string; nodeId: string; nodeLabel: string };

function executeCaseAction(run: Run, kind: string, data: Record<string, unknown>, ctx: FlowContext, where: Where) {
  const error = runCaseAction(run, kind, data, ctx);
  if (error) run.warn(`El nodo «${where.nodeLabel}» no pudo ejecutarse: ${error} El flujo sigue.`, where);
}

function runCaseAction(run: Run, kind: string, data: Record<string, unknown>, ctx: FlowContext): string | null {
  const chain = currentFlowChain(ctx);
  switch (kind) {
    case "classifyCase": {
      const caseTypeId = typeof data.caseTypeId === "string" ? data.caseTypeId : "";
      if (!caseTypeId) return "Elige el tipo de gestión en el nodo.";
      const ensured = ensureOpenCase(run, ctx.variables, CASE_ID_VARIABLE, caseTypeId);
      if ("error" in ensured) return ensured.error;
      const classified = classifyCase(run, ensured.row, caseTypeId, chain);
      if ("error" in classified) return classified.error;
      if (typeof data.stageId === "string" && data.stageId) {
        const moved = changeStage(run, ensured.row, data.stageId, chain);
        if ("error" in moved) return moved.error;
      }
      if (typeof data.categoryId === "string" && data.categoryId) {
        // Categoría opcional del tipo elegido: si no pertenece al tipo se ignora.
        const categorized = setCategory(run, ensured.row, data.categoryId);
        if ("error" in categorized) {
          run.warn(`Categoría «${String(data.categoryName ?? data.categoryId)}» ignorada: ${categorized.error} La gestión queda clasificada igual.`);
        }
      }
      return null;
    }
    case "changeStage": {
      const stageId = typeof data.stageId === "string" ? data.stageId : "";
      if (!stageId) return "Elige la etapa en el nodo.";
      const ensured = ensureOpenCase(run, ctx.variables, CASE_ID_VARIABLE);
      if ("error" in ensured) return ensured.error;
      const moved = changeStage(run, ensured.row, stageId, chain);
      return "error" in moved ? moved.error : null;
    }
    case "assignTeam": {
      const mode = data.mode === "reroute" ? "reroute" : "fixed";
      if (mode === "fixed" && !data.teamId) return "Elige el equipo en el nodo.";
      const ensured = ensureOpenCase(run, ctx.variables, CASE_ID_VARIABLE);
      if ("error" in ensured) return ensured.error;
      const row = ensured.row;
      let teamId: string | null;
      if (mode === "fixed") {
        teamId = (data.teamId as string | undefined) ?? null;
      } else {
        // Re-ruteo: el equipo que corresponde según el tipo de gestión y el contacto.
        const type = row.caseTypeId ? (run.index.caseTypeById.get(row.caseTypeId) ?? null) : null;
        teamId = resolveTargetTeamId({
          caseTypeId: type?.id ?? null,
          routing: type?.routing ?? "contact_owner",
          fixedTeamId: type?.fixedTeamId ?? null,
          currentTeamId: null,
          contactOwnerId: run.state.contact.ownerId,
          contactTeamId: run.state.contact.teamId,
          teams: run.catalog.teams.map((t) => ({ id: t.id, isDefault: t.isDefault, assignmentMode: t.assignmentMode })),
          teamMembers: run.catalog.teamMembers.map((m) => ({ teamId: m.teamId, userId: m.userId, role: m.role, caseTypeIds: m.caseTypeIds })),
          members: run.catalog.members.map((m) => ({ userId: m.userId, role: m.role, availability: m.availability, lastAssignedAt: m.lastAssignedAt })),
          workspaceMode: run.catalog.workspaceMode,
        });
      }
      if (teamId !== row.teamId) {
        const moved = transferCase(run, row, teamId, null);
        return "error" in moved ? moved.error : null;
      }
      if (!row.assigneeId && row.status === "open") assignCase(run, row);
      return null;
    }
    case "distributeCase": {
      const ensured = ensureOpenCase(run, ctx.variables, CASE_ID_VARIABLE);
      if ("error" in ensured) return ensured.error;
      const row = ensured.row;
      if (row.status !== "open") return null;
      if (row.assigneeId) {
        if (!data.replaceAssignee) {
          run.step("info", "La gestión ya tiene responsable: no se cambia nada.", { caseId: row.id });
          return null;
        }
        const released = assignTo(run, row, null);
        if ("error" in released) return released.error;
      }
      assignCase(run, row);
      return null;
    }
    default:
      return null;
  }
}

// ── Condición ───────────────────────────────────────────────────────────────

function describeCaseCondition(run: Run, c: FlowCondition): string {
  const field = c.field as keyof typeof CASE_CONDITION_LABELS;
  const label = CASE_CONDITION_LABELS[field];
  let value = c.value;
  if (c.field === "contact_type") value = contactTypeName(run.catalog, c.value);
  else if (c.field === "case_type") value = caseTypeName(run.catalog, c.value);
  else if (c.field === "case_stage") value = stageName(run.catalog, c.value);
  else if (c.field === "case_team") value = teamName(run.catalog, c.value);
  else if (c.field === "has_assignee" || c.field === "within_hours") value = c.value === "true" ? "Sí" : c.value === "false" ? "No" : c.value;
  const op = c.operator === "equals" ? "=" : c.operator === "not_equals" ? "≠" : c.operator === "contains" ? "contiene" : c.operator;
  return `${label} ${op} «${value}»`;
}

function executeCondition(run: Run, data: Record<string, unknown>, ctx: FlowContext, where: Where): NodeResult {
  const conditions = ((data.conditions as FlowCondition[] | undefined) ?? []).map((c) => ({ field: c.field, operator: c.operator, value: c.value }));
  const { state, index } = run;
  const usesCase = conditions.some((c) => isCaseConditionField(c.field));
  let snapshot = null;
  if (usesCase) {
    let row = findTargetCase(run, ctx.variables[CASE_ID_VARIABLE]);
    // Evento de una gestión ya cerrada: las condiciones miran esa gestión.
    if (!row && ctx.variables[CASE_ID_VARIABLE]) row = caseById(state, ctx.variables[CASE_ID_VARIABLE]);
    snapshot = buildCaseConditionSnapshot({
      contactTypeId: state.contact.contactTypeId,
      row: row ? { case_type_id: row.caseTypeId, stage_id: row.stageId, team_id: row.teamId, assignee_id: row.assigneeId } : null,
      withinHours: isOpenAt(index.hours, row?.teamId ?? null, run.now),
    });
  }
  const facts = {
    platform: state.channel as Platform,
    isSubscribed: state.contact.subscribed,
    tags: [...state.contact.tags],
    customFields: state.contact.customFields,
    variables: ctx.variables,
  };
  const { results, passed } = evaluateConditionNode(
    { conditions, logic: typeof data.logic === "string" ? data.logic : "and" },
    facts,
    snapshot,
  );
  const items = conditions.map((c, i) => ({
    description: isCaseConditionField(c.field) ? describeCaseCondition(run, c) : describeContactCondition(c),
    result: results[i],
  }));
  const joiner = data.logic === "or" ? " o " : " y ";
  run.step(
    "condition",
    `${items.map((i) => `${i.description} (${i.result ? "se cumple" : "no se cumple"})`).join(joiner) || "Sin condiciones"} → sale por «${passed ? "Sí" : "No"}».`,
    {
      ...where,
      level: "info",
      data: { conditions: items, logic: data.logic ?? "and", passed, path: passed ? "yes" : "no" },
    },
  );
  return passed ? "handle:true" : "handle:false";
}

// ── Enviar mensaje ──────────────────────────────────────────────────────────

type RawButton = { title: string; type?: "postback" | "url"; payload?: string; url?: string };
type RawMessage = {
  text?: string;
  imageUrl?: string;
  mediaUrl?: string;
  mediaType?: string;
  quickReplies?: Array<{ title: string; payload: string }>;
  buttons?: Array<{ title: string; type: "postback" | "url"; payload?: string; url?: string }>;
  carousel?: { elements: Array<{ imageUrl?: string; title: string; subtitle?: string; buttons?: Array<{ type: "postback" | "url"; title: string; payload?: string; url?: string }> }> };
};

/** Qué cambió al adaptar el mensaje al canal (lista vacía si se envía tal cual). */
export function adaptationNotes(raw: RawMessage, platform: Platform, adaptedHasRich: boolean): string[] {
  const notes: string[] = [];
  const hadRich = !!(raw.buttons?.length || raw.quickReplies?.length || raw.carousel?.elements?.length);
  if (!hadRich || adaptedHasRich) return notes;
  if (platform === "whatsapp") {
    if (raw.carousel?.elements?.length) {
      notes.push("WhatsApp no admite carruseles: las tarjetas se enviaron como texto numerado.");
    } else if (raw.buttons?.some((b) => b.type === "url")) {
      notes.push("WhatsApp no admite botones con enlace en los botones de respuesta: las opciones se enviaron como lista numerada en el texto.");
    } else {
      notes.push("WhatsApp admite hasta 3 botones o respuestas rápidas: como hay más, las opciones se enviaron como lista numerada en el texto.");
    }
  } else {
    notes.push("Las opciones se enviaron como texto numerado.");
  }
  return notes;
}

function sessionVariablesFill(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (token, name: string) => variables[name] ?? token);
}

function stampFlowOutbound(run: Run, ctx: FlowContext) {
  // Los flujos de "cliente sin responder" no sellan la salida: su propio mensaje reiniciaría la cuenta.
  if (ctx.variables[CASE_EVENT_VARIABLE] === "client_no_reply") return;
  stampBotOutbound(run);
}

function executeSendMessage(run: Run, flow: LabFlow, node: LabNode, data: Record<string, unknown>, ctx: FlowContext, where: Where): void {
  const platform = run.state.channel as Platform;
  const messages = ((data.messages as RawMessage[] | undefined) ?? []);
  // El menú del último mensaje queda en la sesión (como en el motor real): la respuesta numérica o con el texto de una opción lo retoma.
  recordMenu(ctx.variables, messages);

  // WhatsApp: texto o plantilla según la ventana de 24 h.
  if (platform === "whatsapp") {
    const template = parseNodeTemplate(data.template);
    const lastInbound = lastInboundAt(run.state);
    const windowOpen = computeFlowWindowOpen(ctx.incoming, lastInbound, run.now);
    const decision = decideSendMode({
      platform: "whatsapp",
      windowOpen,
      hasText: messages.some(messageHasContent),
      hasTemplate: !!template,
    });
    if (!windowOpen) {
      run.step("info", lastInbound ? `Ventana de 24 h de WhatsApp: cerrada (el cliente escribió por última vez el ${formatAt(lastInbound)}).` : "Ventana de 24 h de WhatsApp: cerrada (el cliente nunca escribió).", {
        ...where,
        level: "warning",
        data: { windowOpen: false, lastInboundAt: lastInbound },
      });
    }
    if (decision.mode === "skip") {
      delete ctx.variables[MENU_VARIABLE];
      const reason = SKIP_REASON_LABELS[decision.reason];
      run.step("message_skipped", `No se envió: ${reason}`, { ...where, level: "warning", data: { reason: decision.reason } });
      run.warnings.push(reason);
      return;
    }
    if (decision.mode === "template" && template) {
      delete ctx.variables[MENU_VARIABLE];
      sendTemplateFromNode(run, flow, ctx, template, where);
      return;
    }
  }

  for (const raw of messages) {
    const adapted = adaptMessage(raw, platform);
    const text = interpolateVariables(adapted.text, ctx.variables);
    const mediaUrl = raw.mediaUrl || raw.imageUrl;
    const mediaType = raw.mediaType || (raw.imageUrl ? "image" : undefined);
    const buttons: LabButton[] | undefined = adapted.buttons?.map((b) => ({ title: b.title, type: b.type, payload: b.payload, url: b.url }));
    const adaptedHasRich = !!(adapted.buttons?.length || adapted.quickReplies?.length || adapted.template);
    const message = run.addMessage({
      author: "bot",
      kind: "text",
      text,
      ...(buttons?.length ? { buttons } : {}),
      ...(adapted.quickReplies?.length ? { quickReplies: adapted.quickReplies.map((q) => ({ title: q.title, payload: q.payload })) } : {}),
      ...(adapted.template
        ? {
            carousel: adapted.template.elements.map((el) => ({
              title: el.title,
              subtitle: el.subtitle,
              imageUrl: el.imageUrl,
              buttons: el.buttons?.map((b) => ({ title: b.title, type: b.type, payload: b.payload, url: b.url })),
            })),
          }
        : {}),
      ...(adapted.imageUrl ? { imageUrl: adapted.imageUrl } : {}),
      ...(mediaUrl ? { attachment: { type: mediaType || "image", url: mediaUrl } } : {}),
      adaptation: adaptationNotes(raw, platform, adaptedHasRich),
      flowId: flow.id,
      flowName: flow.name,
      nodeId: node.id,
    });
    if (message.adaptation?.length === 0) delete message.adaptation;
    stampFlowOutbound(run, ctx);
    run.ok("message_sent", `Mensaje del bot: «${truncate(text)}»${message.adaptation ? ` (${message.adaptation.join(" ")})` : ""}`, {
      ...where,
      messageId: message.id,
    });
  }
}

function truncate(text: string, max = 120): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

/** Envía la plantilla del nodo (como sendFlowTemplate del motor real). */
function sendTemplateFromNode(run: Run, flow: LabFlow, ctx: FlowContext, template: NodeTemplate, where: Where) {
  const { state, index } = run;
  let text = `Plantilla: ${template.template_name}`;
  const fail = (error: string) => {
    run.addMessage({
      author: "bot",
      kind: "template",
      text,
      template: { name: template.template_name, language: template.language, params: [] },
      failed: error,
      flowId: flow.id,
      flowName: flow.name,
      nodeId: where.nodeId,
    });
    run.warn(`La plantilla «${template.template_name}» no se pudo enviar: ${error}`, where);
  };

  if (!phoneDigits(state.contact.phone)) {
    fail("El contacto no tiene un número de WhatsApp.");
    return;
  }
  const caseRow = caseById(state, ctx.variables[CASE_ID_VARIABLE]) ?? latestOpenCase(state);
  const needsCustom = template.params.some((p) => p.toLowerCase().includes("{campo:"));
  const built = buildAutoTemplateParams(
    { ...template, params: template.params.map((p) => sessionVariablesFill(p, ctx.variables)) },
    {
      contactName: state.contact.name,
      keyDate: state.contact.keyDate,
      workspaceName: index.hours.workspaceName,
      teamName: caseRow?.teamId ? index.hours.teamNames.get(caseRow.teamId) : null,
      customFields: needsCustom ? state.contact.customFields : undefined,
    },
  );
  if (!built.ok) {
    fail(built.error);
    return;
  }
  text = demoTemplateText(template.template_name, built.params);
  const message = run.addMessage({
    author: "bot",
    kind: "template",
    text,
    template: { name: template.template_name, language: template.language, params: built.params },
    flowId: flow.id,
    flowName: flow.name,
    nodeId: where.nodeId,
  });
  stampFlowOutbound(run, ctx);
  run.ok("message_sent", `Ventana de 24 h cerrada: se envía la plantilla de WhatsApp «${template.template_name}» (${template.language}) con los valores ${built.params.map((p) => `«${p}»`).join(", ") || "(sin variables)"}.`, {
    ...where,
    messageId: message.id,
    data: { template: template.template_name, params: built.params },
  });
}

// ── Eventos de gestión → flujos ─────────────────────────────────────────────

const EVENT_TEXT: Record<LabCaseEvent["type"], string> = {
  case_opened: "gestión nueva",
  case_stage_changed: "cambio de etapa",
  case_closed: "gestión cerrada",
  client_no_reply: "cliente sin responder",
};

/** Por qué un disparador de evento no corre (o "coincide"). */
function explainEventTrigger(
  run: Run,
  trigger: { id: string; flowId: string; type: string; config: unknown },
  event: LabCaseEvent,
  stampedMinutes: number | null,
  selectedIds: Set<string>,
  claimedFlows: Set<string>,
): { outcome: "matched" | "not_matched"; why: string } {
  if (selectedIds.has(trigger.id)) return { outcome: "matched", why: "El tipo de gestión, la etapa o el resultado del evento coinciden con la configuración del disparador." };
  if (!matchesCaseEvent(trigger, event, stampedMinutes)) {
    const config = (trigger.config && typeof trigger.config === "object" ? trigger.config : {}) as Record<string, unknown>;
    if (typeof config.case_type_id === "string" && config.case_type_id !== event.caseTypeId) {
      return { outcome: "not_matched", why: `Solo aplica a gestiones de «${caseTypeName(run.catalog, config.case_type_id)}»; esta es de «${caseTypeName(run.catalog, event.caseTypeId)}».` };
    }
    if (event.type === "case_opened") {
      if (config.only_unclassified === true && event.caseTypeId) {
        return { outcome: "not_matched", why: `Solo aplica a gestiones sin clasificar; esta quedó como «${caseTypeName(run.catalog, event.caseTypeId)}».` };
      }
      const wanted = Array.isArray(config.contact_type_ids) ? config.contact_type_ids.filter((v): v is string => typeof v === "string") : [];
      if (wanted.length > 0) {
        return { outcome: "not_matched", why: `Solo aplica a clientes de tipo ${wanted.map((id) => `«${contactTypeName(run.catalog, id)}»`).join(", ")}; este es «${contactTypeName(run.catalog, event.contactTypeId)}».` };
      }
    }
    if (event.type === "case_stage_changed" && typeof config.stage_id === "string" && config.stage_id !== event.stageId) {
      return { outcome: "not_matched", why: `Solo aplica cuando pasa a «${stageName(run.catalog, config.stage_id)}»; pasó a «${stageName(run.catalog, event.stageId)}».` };
    }
    if (event.type === "case_closed" && typeof config.outcome === "string" && config.outcome !== event.outcome) {
      return { outcome: "not_matched", why: `Solo aplica a gestiones cerradas como «${config.outcome}»; esta se cerró como «${event.outcome}».` };
    }
    if (event.type === "client_no_reply") {
      return { outcome: "not_matched", why: `Sus minutos no son los del umbral que se acaba de cumplir (${stampedMinutes ?? "ninguno"}).` };
    }
    return { outcome: "not_matched", why: "La configuración del disparador no coincide con el evento." };
  }
  if (!canRunInChain(event.chain, trigger.flowId)) {
    const chain = event.chain ?? [];
    return chain.length >= MAX_CASE_FLOW_CHAIN
      ? { outcome: "not_matched", why: `Coincide, pero la cadena de flujos ya tiene ${chain.length} (máximo ${MAX_CASE_FLOW_CHAIN}): se corta para evitar bucles.` }
      : { outcome: "not_matched", why: "Coincide, pero este flujo ya corrió en la cadena de eventos que provocó este: no se repite (protección contra bucles)." };
  }
  if (claimedFlows.has(trigger.flowId)) return { outcome: "not_matched", why: "El flujo tiene otro disparador que ya coincidió: solo corre una vez por evento." };
  return { outcome: "not_matched", why: "No coincide." };
}

/**
 * Ejecuta los flujos cuyos disparadores coinciden con el evento (como
 * runCaseEventFlows del motor real). No hace nada si el contacto no tiene
 * conversación; el bot en pausa no lo impide.
 */
export function runCaseEventFlows(run: Run, event: LabCaseEvent): void {
  const { state, catalog } = run;
  const row = caseById(state, event.caseId);
  const eventLabel = `${EVENT_TEXT[event.type]}${event.type === "case_closed" && event.outcome ? ` (${event.outcome === "won" ? "ganada" : event.outcome === "lost" ? "perdida" : "resuelta"})` : ""}`;
  const base = `Evento «${eventLabel}» de la gestión «${caseTypeName(catalog, event.caseTypeId)}»`;

  if ((event.chain?.length ?? 0) >= MAX_CASE_FLOW_CHAIN) {
    run.warn(`${base}: la cadena de eventos ya es demasiado larga (${event.chain!.length}), se detiene para evitar bucles.`, { caseId: event.caseId });
    return;
  }

  let stampedMinutes: number | null = null;
  if (event.type === "client_no_reply") {
    if (!row || row.status !== "open") return;
    stampedMinutes = row.noReplyEventMinutes;
    if (stampedMinutes === null) return;
  }

  const { all, selected } = selectEventTriggers(run, event, stampedMinutes);
  const selectedIds = new Set(selected.map((t) => t.id));
  const claimed = new Set<string>();
  const candidates = all.map((t) => {
    const verdict = explainEventTrigger(run, t, event, stampedMinutes, selectedIds, claimed);
    if (verdict.outcome === "matched") claimed.add(t.flowId);
    return {
      triggerId: t.id,
      flowId: t.flowId,
      flowName: run.index.flowById.get(t.flowId)?.name ?? t.flowId,
      type: t.type,
      description: describeTrigger(catalog, t),
      outcome: verdict.outcome,
      why: verdict.why,
      nodeId: t.nodeId,
    };
  });

  if (all.length === 0) {
    run.step("case_event", `${base}: ningún flujo activo escucha este tipo de evento.`, { caseId: event.caseId, data: { event: event.type, candidates } });
    return;
  }
  if (selected.length === 0) {
    run.step("case_event", `${base}: ningún disparador coincide.`, { caseId: event.caseId, level: "info", data: { event: event.type, candidates } });
    return;
  }
  run.step("case_event", `${base}: coinciden ${selected.map((t) => `«${run.index.flowById.get(t.flowId)?.name}»`).join(", ")}.`, {
    caseId: event.caseId,
    level: "ok",
    data: { event: event.type, candidates },
  });

  // Con el bot en pausa los flujos de eventos de gestión corren igual: la pausa solo evita que el bot hable
  // cuando el cliente escribe (como en el motor real).
  if (state.automationPaused) {
    run.step("info", "El bot está en pausa en esta conversación, pero los flujos de eventos de gestión se ejecutan igual (la pausa solo corta los mensajes del cliente).", { caseId: event.caseId });
  }

  for (const trigger of selected) {
    const chain = extendFlowChain(event.chain, trigger.flowId);
    const variables: Record<string, string> = {
      [CASE_ID_VARIABLE]: event.caseId,
      [CASE_EVENT_VARIABLE]: event.type,
      [FLOW_CHAIN_VARIABLE]: serializeFlowChain(chain),
    };
    if (event.caseTypeId) variables.case_type_id = event.caseTypeId;
    if (event.stageId) variables.stage_id = event.stageId;
    if (event.outcome) variables.outcome = event.outcome;
    executeFlow(run, {
      triggerId: trigger.id,
      flowId: trigger.flowId,
      incoming: {},
      variables,
      startFresh: true,
    });
  }
}

/** Ejecuta los eventos de gestión pendientes (los que emitió la acción y los que provocan los flujos). */
export function drainEvents(run: Run): void {
  let processed = 0;
  while (run.queue.length > 0) {
    if (processed++ >= MAX_EVENTS_PER_ACTION) {
      run.warn(`Se detiene: más de ${MAX_EVENTS_PER_ACTION} eventos de gestión seguidos (posible bucle).`);
      run.queue.length = 0;
      return;
    }
    const event = run.queue.shift()!;
    runCaseEventFlows(run, event);
  }
}
