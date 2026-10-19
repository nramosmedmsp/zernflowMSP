// Acciones del laboratorio. Cada una recibe el catálogo y el estado, y devuelve
// el estado nuevo (el recibido no se modifica) y la traza. Ninguna escribe en
// la base ni envía mensajes.

import { WHATSAPP_WINDOW_MS } from "@/lib/flow-engine/send-mode";
import { resolveGlobalKeyword } from "@/lib/flow-engine/global-keywords";
import { applyWaitingMenuReply } from "@/lib/flow-engine/menu-reply";
import { findKeywordMatch, selectTrigger, type TriggerMatchReason } from "@/lib/flow-engine/trigger-matcher";
import { activeTriggers, caseTypeName, describeTrigger, memberName } from "./catalog";
import {
  assignTo as assignToCase,
  changeStage as changeStageOfCase,
  classifyCase as classifyCaseOf,
  closeCase as closeCaseOf,
  handleHumanOutbound,
  handleInbound,
  pauseAutomation,
  previewClose as previewCloseOf,
  setCategory as setCategoryOf,
  type LabClosePreview,
} from "./cases";
import { runAdvanceTime } from "./cron";
import { drainEvents, executeFlow, findWaitingSession, resumeSession } from "./flows";
import { Run } from "./run";
import { lastClientMessageAt, latestOpenCase } from "./state";
import type {
  ClientInput,
  CloseCaseInput,
  LabCatalog,
  LabContact,
  LabOptions,
  LabResult,
  LabState,
  TriggerCandidateTrace,
} from "./types";

function truncate(text: string, max = 80): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

const REASON_TEXT: Record<TriggerMatchReason["via"], string> = {
  postback: "el cliente pulsó un botón con esa carga",
  quick_reply: "el cliente pulsó una respuesta rápida con esa carga",
  keyword: "el mensaje contiene la palabra clave",
  welcome: "es el primer mensaje del contacto",
  default: "ningún otro disparador coincidió",
};

/** Qué dice cada disparador del mensaje: coincide o por qué no (y quién ganó). */
function explainTriggers(
  catalog: LabCatalog,
  triggers: ReturnType<typeof activeTriggers>,
  message: { text?: string; postbackPayload?: string; quickReplyPayload?: string },
  isFirstMessage: boolean,
  chosenId: string | null,
  flowName: (id: string) => string,
): TriggerCandidateTrace[] {
  const ORDER = ["postback", "quick_reply", "keyword", "welcome", "default"];
  const chosen = triggers.find((t) => t.id === chosenId);
  return triggers
    .filter((t) => ORDER.includes(t.type))
    .map((t): TriggerCandidateTrace => {
      let would = false;
      let why = "";
      const config = (t.config ?? {}) as { payload?: string };
      switch (t.type) {
        case "postback":
          would = !!message.postbackPayload && config.payload === message.postbackPayload;
          why = would
            ? `El cliente pulsó el botón con carga «${config.payload}».`
            : message.postbackPayload
              ? `Espera la carga «${config.payload}» y llegó «${message.postbackPayload}».`
              : "El mensaje no es la pulsación de un botón.";
          break;
        case "quick_reply":
          would = !!message.quickReplyPayload && config.payload === message.quickReplyPayload;
          why = would
            ? `El cliente pulsó la respuesta rápida con carga «${config.payload}».`
            : message.quickReplyPayload
              ? `Espera la carga «${config.payload}» y llegó «${message.quickReplyPayload}».`
              : "El mensaje no es la pulsación de una respuesta rápida.";
          break;
        case "keyword": {
          const found = message.text ? findKeywordMatch(t.config, message.text) : null;
          would = !!found;
          why = found
            ? `El mensaje cumple la palabra clave «${found.keyword}» (${found.matchType === "exact" ? "coincidencia exacta" : found.matchType === "startsWith" ? "empieza con" : "contiene"}).`
            : message.text
              ? "Ninguna de sus palabras clave aparece en el mensaje."
              : "El mensaje no tiene texto.";
          break;
        }
        case "welcome":
          would = isFirstMessage;
          why = isFirstMessage ? "Es el primer mensaje del contacto." : "No es el primer mensaje del contacto.";
          break;
        case "default":
          would = true;
          why = "Es el disparador por defecto: aplica cuando ningún otro coincide.";
          break;
      }
      const isChosen = t.id === chosenId;
      if (!isChosen && would && chosen) {
        why += ` Habría coincidido, pero ganó «${flowName(chosen.flowId)}» por orden de prioridad (botón > respuesta rápida > palabra clave > bienvenida > por defecto, y dentro de lo mismo la prioridad numérica).`;
      }
      return {
        triggerId: t.id,
        flowId: t.flowId,
        flowName: flowName(t.flowId),
        type: t.type,
        description: describeTrigger(catalog, t),
        outcome: isChosen ? "matched" : "not_matched",
        why,
        nodeId: t.nodeId,
      };
    });
}

// ── El cliente escribe ──────────────────────────────────────────────────────

/**
 * El cliente escribe un texto o pulsa un botón. Mismo orden que el webhook real
 * (lib/inbound-pipeline.ts): abrir o reutilizar la gestión, pausa del bot,
 * palabras clave globales, retomar la sesión que espera, buscar disparador y
 * ejecutar el flujo; después, los eventos de gestión que eso provocó.
 */
export function clientSays(catalog: LabCatalog, state: LabState, input: ClientInput, options: LabOptions = {}): LabResult {
  const run = new Run(catalog, state, options);
  const isButton = input.kind === "button";
  const text = input.kind === "text" ? input.text : (input.title ?? input.payload);
  const title = isButton ? `El cliente pulsa «${truncate(text)}»` : `El cliente escribe: «${truncate(text)}»`;
  if (!text || !text.trim()) {
    return run.fail(state, "clientSays", title, "El mensaje está vacío.");
  }

  const incoming = {
    text,
    postbackPayload: isButton && (input.buttonType ?? "postback") === "postback" ? input.payload : undefined,
    quickReplyPayload: isButton && input.buttonType === "quick_reply" ? input.payload : undefined,
  };

  const message = run.addMessage({
    author: "client",
    kind: "text",
    text,
    ...(isButton ? { payload: input.payload } : {}),
  });
  run.step(
    "client_message",
    isButton
      ? `El cliente pulsa ${input.buttonType === "quick_reply" ? "la respuesta rápida" : "el botón"} «${text}» (carga «${input.payload}»).`
      : `El cliente escribe: «${text}»`,
    { messageId: message.id, data: { channel: state.channel, ...(isButton ? { payload: input.payload } : {}) } },
  );

  // El primer mensaje de un contacto nuevo dispara la bienvenida (en el webhook, "el contacto no existía").
  const isFirstMessage = !run.state.contact.existed;
  run.state.contact.existed = true;
  if (isFirstMessage) run.step("info", "Es el primer mensaje de este contacto: se crea el contacto y la conversación.");

  // 1. Gestión: abrir o reutilizar, sellar, repartir, respuesta fuera de horario.
  handleInbound(run, run.nowIso);

  runPipeline(run, incoming, isFirstMessage);
  drainEvents(run);
  return run.finish("clientSays", title);
}

function runPipeline(
  run: Run,
  incoming: { text?: string; postbackPayload?: string; quickReplyPayload?: string },
  isFirstMessage: boolean,
): void {
  const { state, catalog } = run;
  const flowName = (id: string) => run.index.flowById.get(id)?.name ?? id;

  // 2. Bot en pausa: el mensaje no dispara palabras clave ni bienvenida ni retoma esperas (los flujos de eventos de gestión sí corren).
  if (state.automationPaused) {
    run.warn("El bot está en pausa en esta conversación (un asesor respondió, pasó a atención humana o se pausó a mano): el mensaje no dispara ningún flujo. La gestión sí se actualizó.");
    return;
  }

  // 3. Palabras clave globales (baja, alta).
  const keyword = resolveGlobalKeyword(incoming.text, catalog.globalKeywords);
  if (keyword.handled) {
    state.contact.subscribed = keyword.action === "subscribe";
    run.ok(
      "global_keyword",
      keyword.action === "unsubscribe"
        ? `Palabra clave global «${keyword.keyword}»: el contacto se da de baja. El mensaje no sigue a los flujos.`
        : `Palabra clave global «${keyword.keyword}»: el contacto se vuelve a suscribir. El mensaje no sigue a los flujos.`,
      { data: { keyword: keyword.keyword, action: keyword.action } },
    );
    return;
  }
  if (keyword.keyword) {
    run.step("global_keyword", `La palabra clave global «${keyword.keyword}» no tiene acción de baja ni de alta: el mensaje sigue su camino.`);
  }

  // 4. Una sesión que espera la respuesta la retoma, sin buscar disparadores.
  const waiting = findWaitingSession(run);
  if (waiting) {
    // "1", "2." o el texto exacto de una opción del último menú del bot retoman la espera como esa opción.
    const reply = applyWaitingMenuReply(waiting.variables, incoming);
    if (reply.choice) {
      run.step(
        "info",
        `La respuesta «${reply.original}» se interpreta como la opción «${reply.choice.title}» del último menú del bot${reply.choice.payload ? ` (carga «${reply.choice.payload}»)` : ""}.`,
        { flowId: waiting.flowId, level: "ok", data: { menuChoice: reply.choice.title, original: reply.original } },
      );
    }
    resumeSession(run, waiting, { triggerId: "", flowId: waiting.flowId, incoming: reply.incoming, variables: {} });
    return;
  }

  // 5. Buscar el disparador.
  const triggers = activeTriggers(catalog, state);
  const messageTriggers = triggers.filter((t) => ["postback", "quick_reply", "keyword", "welcome", "default"].includes(t.type));
  const selected = selectTrigger(messageTriggers, incoming, isFirstMessage);
  const candidates = explainTriggers(catalog, messageTriggers, incoming, isFirstMessage, selected?.trigger.id ?? null, flowName);

  if (!selected) {
    const why =
      messageTriggers.length === 0
        ? "No hay flujos activos con disparadores de mensajes (¿hay flujos publicados o elegidos?)."
        : `Ninguno de los ${messageTriggers.length} disparadores coincide con «${truncate(incoming.text ?? "")}»${isFirstMessage ? "" : " (no es el primer mensaje, así que la bienvenida no aplica)"} y no hay un disparador por defecto.`;
    run.step("trigger_evaluation", `Ningún flujo se dispara. ${why}`, { level: "warning", data: { matched: false, candidates, isFirstMessage } });
    return;
  }

  const { trigger, reason } = selected;
  run.ok(
    "trigger_evaluation",
    `Coincide el disparador de «${flowName(trigger.flowId)}»: ${describeTrigger(catalog, trigger)} (${REASON_TEXT[reason.via]}${reason.via === "keyword" ? ` «${reason.keyword}»` : ""}).`,
    { flowId: trigger.flowId, nodeId: trigger.nodeId, data: { matched: true, triggerId: trigger.id, reason, candidates, isFirstMessage } },
  );

  // 6. Ejecutar el flujo.
  executeFlow(run, { triggerId: trigger.id, flowId: trigger.flowId, incoming, variables: {} });
}

// ── El tiempo pasa ──────────────────────────────────────────────────────────

/** Avanza el reloj y aplica lo que haría el cron y el motor: esperas, "cliente sin responder", gestiones programadas y ventana de 24 h. */
export function advanceTime(catalog: LabCatalog, state: LabState, minutes: number, options: LabOptions = {}): LabResult {
  const run = new Run(catalog, state, options);
  const title = `Pasa el tiempo (${minutes} min)`;
  if (!Number.isFinite(minutes) || minutes <= 0) return run.fail(state, "advanceTime", title, "Indica cuántos minutos avanzar (mayor que 0).");
  runAdvanceTime(run, minutes);
  return run.finish("advanceTime", title);
}

// ── Acciones de un asesor ───────────────────────────────────────────────────

/** El asesor responde en la conversación: pausa el bot, sella la primera respuesta y cierra la espera del cliente. */
export function agentReplies(catalog: LabCatalog, state: LabState, text: string, opts: { agentId?: string | null; options?: LabOptions } = {}): LabResult {
  const run = new Run(catalog, state, opts.options);
  const title = `El asesor responde: «${truncate(text)}»`;
  if (!text || !text.trim()) return run.fail(state, "agentReplies", title, "El mensaje está vacío.");
  const agentId = opts.agentId ?? latestOpenCase(run.state)?.assigneeId ?? null;
  const message = run.addMessage({
    author: "agent",
    kind: "text",
    text: text.trim(),
    authorName: agentId ? memberName(catalog, agentId) : "Asesor",
  });
  run.step("agent_message", `El asesor${agentId ? ` ${memberName(catalog, agentId)}` : ""} escribe: «${text.trim()}»`, { messageId: message.id });
  if (run.state.channel === "whatsapp") {
    const last = lastClientMessageAt(run.state);
    if (!last || run.now.getTime() - new Date(last).getTime() > WHATSAPP_WINDOW_MS) {
      run.warn("La ventana de 24 h de WhatsApp está cerrada: en el CRM real el asesor solo podría enviar una plantilla aprobada.");
    }
  }
  handleHumanOutbound(run, agentId);
  drainEvents(run);
  return run.finish("agentReplies", title);
}

function targetCase(run: Run, caseId?: string) {
  return caseId ? run.state.cases.find((c) => c.id === caseId) : latestOpenCase(run.state);
}

/** El asesor cambia la etapa de la gestión abierta (solo etapas abiertas). */
export function changeStage(catalog: LabCatalog, state: LabState, stageId: string, opts: { caseId?: string; options?: LabOptions } = {}): LabResult {
  const run = new Run(catalog, state, opts.options);
  const stage = run.index.stageById.get(stageId)?.stage.name ?? stageId;
  const title = `El asesor cambia la etapa a «${stage}»`;
  const row = targetCase(run, opts.caseId);
  if (!row) return run.fail(state, "changeStage", title, "No hay una gestión abierta.");
  const result = changeStageOfCase(run, row, stageId);
  if ("error" in result) return run.fail(state, "changeStage", title, result.error);
  drainEvents(run);
  return run.finish("changeStage", title);
}

/** El asesor clasifica la gestión (cambia el tipo de gestión). */
export function classify(catalog: LabCatalog, state: LabState, caseTypeId: string, opts: { caseId?: string; options?: LabOptions } = {}): LabResult {
  const run = new Run(catalog, state, opts.options);
  const title = `El asesor clasifica la gestión como «${caseTypeName(catalog, caseTypeId)}»`;
  const row = targetCase(run, opts.caseId);
  if (!row) return run.fail(state, "classify", title, "No hay una gestión abierta.");
  const result = classifyCaseOf(run, row, caseTypeId);
  if ("error" in result) return run.fail(state, "classify", title, result.error);
  drainEvents(run);
  return run.finish("classify", title);
}

/** El asesor elige la categoría de la gestión (null la quita). */
export function setCategory(catalog: LabCatalog, state: LabState, categoryId: string | null, opts: { caseId?: string; options?: LabOptions } = {}): LabResult {
  const run = new Run(catalog, state, opts.options);
  const title = "El asesor cambia la categoría";
  const row = targetCase(run, opts.caseId);
  if (!row) return run.fail(state, "setCategory", title, "No hay una gestión abierta.");
  const result = setCategoryOf(run, row, categoryId);
  if ("error" in result) return run.fail(state, "setCategory", title, result.error);
  return run.finish("setCategory", title);
}

/** Asigna la gestión a una persona, o la devuelve a la cola (null). */
export function assign(
  catalog: LabCatalog,
  state: LabState,
  memberId: string | null,
  opts: { caseId?: string; enforceTeam?: boolean; options?: LabOptions } = {},
): LabResult {
  const run = new Run(catalog, state, opts.options);
  const title = memberId ? `Se asigna la gestión a ${memberName(catalog, memberId)}` : "Se devuelve la gestión a la cola";
  const row = targetCase(run, opts.caseId);
  if (!row) return run.fail(state, "assign", title, "No hay una gestión abierta.");
  const result = assignToCase(run, row, memberId, opts.enforceTeam !== false);
  if ("error" in result) return run.fail(state, "assign", title, result.error);
  return run.finish("assign", title);
}

/**
 * El asesor cierra la gestión (ganada, perdida o resuelta). Aplica las reglas
 * del tipo: tipo de contacto, programación de Recompra o Renovación, fecha clave.
 * Emite los eventos case_stage_changed y case_closed que disparan flujos.
 */
export function closeCase(catalog: LabCatalog, state: LabState, input: CloseCaseInput, opts: { options?: LabOptions } = {}): LabResult {
  const run = new Run(catalog, state, opts.options);
  const kindText = input.kind === "won" ? "ganada" : input.kind === "lost" ? "perdida" : input.kind === "resolved" ? "resuelta" : "cerrada";
  const title = `El asesor cierra la gestión como ${kindText}`;
  const result = closeCaseOf(run, input);
  if ("error" in result) return run.fail(state, "closeCase", title, result.error);
  drainEvents(run);
  return run.finish("closeCase", title);
}

/** Vista previa del cierre: qué se programaría y si hay que pedir la fecha clave. No cambia nada. */
export function previewClose(catalog: LabCatalog, state: LabState, input: CloseCaseInput): { ok: true; preview: LabClosePreview } | { error: string } {
  const run = new Run(catalog, state);
  return previewCloseOf(run, input);
}

/** Edita datos del contacto (tipo, etiquetas, campos, suscripción, responsable, equipo, fecha clave, teléfono, nombre). */
export function setContact(catalog: LabCatalog, state: LabState, partial: Partial<Omit<LabContact, "existed">>): LabResult {
  const run = new Run(catalog, state);
  const title = "Se editan los datos del contacto";
  const changed: string[] = [];
  const contact = run.state.contact;
  for (const [key, value] of Object.entries(partial) as [keyof LabContact, unknown][]) {
    if (value === undefined || JSON.stringify(contact[key]) === JSON.stringify(value)) continue;
    (contact as unknown as Record<string, unknown>)[key] = structuredClone(value);
    changed.push(key);
  }
  if (changed.length === 0) {
    run.step("info", "No hay cambios en el contacto.");
  } else {
    run.ok("contact_changed", `Contacto editado: ${changed.join(", ")}.`, { data: { fields: changed } });
  }
  return run.finish("setContact", title);
}

/**
 * Pausa o reanuda el bot en la conversación: equivale al botón "Pausar bot" /
 * "Reanudar bot" de la cabecera del chat en la bandeja (setConversationBotPaused
 * en el CRM real; allí además se valida el permiso y queda en la actividad).
 * La pausa también la ponen un asesor al responder o el nodo Atención humana, y
 * se quita sola al quedar el contacto sin gestiones abiertas.
 */
export function setBotPaused(catalog: LabCatalog, state: LabState, paused: boolean): LabResult {
  const run = new Run(catalog, state);
  const title = paused ? "Se pausa el bot (botón de la bandeja)" : "Se reanuda el bot (botón de la bandeja)";
  if (paused) {
    pauseAutomation(run, "se pausó a mano con el botón «Pausar bot» de la bandeja");
  } else if (run.state.automationPaused) {
    run.state.automationPaused = false;
    run.ok("bot_resumed", "El bot se reanuda en la conversación (botón «Reanudar bot» de la bandeja).");
  } else {
    run.step("info", "El bot ya estaba activo.");
  }
  return run.finish("setBotPaused", title);
}

/** Cambia la disponibilidad de un asesor (para probar el reparto). */
export function setMemberAvailability(catalog: LabCatalog, state: LabState, memberId: string, availability: "available" | "away"): LabResult {
  const run = new Run(catalog, state);
  const title = `${memberName(catalog, memberId)} pasa a ${availability === "available" ? "disponible" : "ausente"}`;
  const current = run.state.members[memberId];
  if (!current) return run.fail(state, "setMemberAvailability", title, "La persona no es miembro del espacio.");
  current.availability = availability;
  run.ok("info", `${memberName(catalog, memberId)} está ${availability === "available" ? "disponible: puede recibir gestiones" : "ausente: no recibe gestiones nuevas"}.`);
  return run.finish("setMemberAvailability", title);
}

/** Elige los flujos activos en la simulación (null = todos los publicados). Cambia solo el estado, sin traza. */
export function setEnabledFlows(state: LabState, enabledFlowIds: string[] | null): LabState {
  const next = structuredClone(state);
  next.enabledFlowIds = enabledFlowIds ? [...enabledFlowIds] : null;
  return next;
}

/** Cambia el canal de la conversación. Cambia solo el estado, sin traza. */
export function setChannel(state: LabState, channel: LabState["channel"]): LabState {
  const next = structuredClone(state);
  next.channel = channel;
  return next;
}
