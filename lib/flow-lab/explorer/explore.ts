// Explorador de caminos: dado un flujo, recorre con el simulador todos los
// caminos posibles y cuenta cómo termina cada uno. No reimplementa el motor:
// solo decide qué hacer a continuación (qué contestar, qué estado de partida
// probar) y llama a las acciones de lib/flow-lab.
//
// Cómo funciona:
//   1. Arranca el flujo con su disparador (el mensaje que lo activa o el evento
//      de gestión) sobre un perfil.
//   2. Cada vez que el flujo espera una respuesta, prueba cada botón o respuesta
//      rápida del último mensaje y las respuestas libres que llevan a ramas que
//      ningún botón cubre. Recorre a lo ancho (todas las opciones de un punto
//      antes de seguir), así que si se acaba el cupo de caminos quedan sin
//      explorar las ramas más profundas, no las primeras.
//   3. Las condiciones sobre el contacto o la gestión (etiqueta, tipo, etapa,
//      horario...) se exploran repitiendo todo desde otro estado de partida:
//      cada vez que un camino evalúa una de esas condiciones, se prueban sus
//      variantes. Un camino de una variante solo se conserva si difiere de los
//      que ya había.

import { isCaseConditionField } from "@/lib/flow-engine/case-conditions";
import { parseConditionField, upgradeCondition } from "@/lib/flow-engine/condition-fields";
import { nodeKind } from "@/lib/flow-engine/node-kind";
import { clientSays, advanceTime } from "../actions";
import { nodeKindLabel } from "../flows";
import { buildSampleProfiles } from "../profiles";
import { createLabState, emptyContact } from "../state";
import type { LabCatalog, LabFlow, LabNode, LabOptions, LabProfile, LabResult, LabSession, LabState, LabTrace } from "../types";
import {
  WINDOW_DIMENSION,
  abDimensionKey,
  abPathsOf,
  abRandomFor,
  buildDimensions,
  conditionsOf,
  dimensionKeyOf,
  findClocks,
  type Dimension,
} from "./dimensions";
import { replyOptions } from "./replies";
import { diffSummaries, limaDateTime, summarizeState } from "./state-summary";
import { planStarts, type StartPlan } from "./start";
import {
  DEFAULT_MAX_ACTIONS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_PATHS,
  DEFAULT_MAX_VARIANTS,
  type ExploreCondition,
  type ExploreCoverage,
  type ExploreCoverageItem,
  type ExploreEnd,
  type ExploreOptions,
  type ExploreOutputItem,
  type ExplorePath,
  type ExploreResult,
  type ExploreStartReport,
  type ExploreStateSummary,
  type ExploreStep,
  type ExploreTreeNode,
} from "./types";

/** Lunes 19/10/2026 10:00 de Lima. */
export const DEFAULT_EXPLORE_CLOCK = "2026-10-19T15:00:00.000Z";

const MAX_NO_START_ATTEMPTS = 8;

/** Una variante del estado de partida: dimensión → id de la opción. */
type Assignment = Record<string, string>;

function canonical(assignment: Assignment): string {
  return JSON.stringify(Object.entries(assignment).sort(([a], [b]) => a.localeCompare(b)));
}

/** Camino recién recorrido (todavía sin numerar ni etiquetar la variante). */
interface RawPath {
  steps: ExploreStep[];
  messages: ExplorePath["messages"];
  visited: ExplorePath["visited"];
  conditions: ExploreCondition[];
  abPaths: ExplorePath["abPaths"];
  end: ExploreEnd;
  final: ExploreStateSummary;
  changes: string[];
  warnings: string[];
  flowIds: string[];
}

/** Un camino en curso. */
interface Item {
  state: LabState;
  steps: ExploreStep[];
  visited: ExplorePath["visited"];
  visitedKeys: Set<string>;
  conditions: ExploreCondition[];
  abPaths: ExplorePath["abPaths"];
  warnings: string[];
  flowIds: string[];
  contexts: string[];
  depth: number;
  initial: ExploreStateSummary;
  initialMessages: number;
}

interface Ctx {
  catalog: LabCatalog;
  flow: LabFlow;
  options: ExploreOptions;
  clock: string;
  channel: NonNullable<ExploreOptions["channel"]>;
  maxDepth: number;
  maxPaths: number;
  enabledFlowIds: string[];
  dimensions: Map<string, Dimension>;
  plans: StartPlan[];
  actions: number;
  maxActions: number;
  actionLimit: boolean;
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function labelOf(node: LabNode): string {
  const label = node.data?.label;
  return typeof label === "string" && label.trim() ? label : nodeKindLabel(nodeKind(node));
}

/** El flujo y los flujos a los que puede saltar (también borradores): son los únicos activos en la exploración. */
function flowClosure(catalog: LabCatalog, rootId: string): LabFlow[] {
  const byId = new Map(catalog.flows.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const flow = byId.get(id);
    if (!flow || seen.has(id)) continue;
    seen.add(id);
    for (const node of flow.nodes) {
      if (nodeKind(node) !== "goToFlow") continue;
      const target = (node.data as { flowId?: unknown } | undefined)?.flowId;
      if (typeof target === "string") queue.push(target);
    }
  }
  return [...seen].map((id) => byId.get(id)!);
}

// ── Estado de partida ───────────────────────────────────────────────────────

function syntheticProfile(id: string, name: string, contactTypeId: string | null, existed: boolean): LabProfile {
  return {
    id,
    name,
    description: "Contacto de prueba que arma el explorador.",
    contact: emptyContact({ name: "Cliente de prueba", contactTypeId, existed }),
    cases: [],
    messages: [],
    notices: [],
  };
}

function candidateProfiles(ctx: Ctx, plan: StartPlan): LabProfile[] {
  if (ctx.options.profile) return [ctx.options.profile];
  const { catalog } = ctx;
  const samples = buildSampleProfiles(catalog, ctx.clock);
  const byType = catalog.contactTypes.map((t) => syntheticProfile(`tipo-${t.id}`, `Contacto de tipo «${t.name}»`, t.id, true));
  const noType = syntheticProfile("sin-tipo", "Contacto sin tipo", null, true);
  const newContact = syntheticProfile("contacto-nuevo", "Contacto nuevo", null, false);
  let list: LabProfile[];
  if (plan.needsNewContact) {
    list = [newContact, ...samples, ...byType];
  } else if (plan.contactTypeIds.length > 0) {
    const wanted = byType.filter((p) => plan.contactTypeIds.some((id) => p.id === `tipo-${id}`));
    list = [...wanted, ...samples, ...byType.filter((p) => !wanted.includes(p)), noType];
  } else {
    list = [...samples, ...byType, noType];
  }
  return list.slice(0, MAX_NO_START_ATTEMPTS);
}

/** Por qué no arrancó el flujo, según las trazas (lo que dijeron sus disparadores). */
function explainNoStart(flow: LabFlow, traces: readonly LabTrace[]): string {
  for (const trace of [...traces].reverse()) {
    if (trace.error) return trace.error;
    for (const step of [...trace.steps].reverse()) {
      if (step.kind !== "trigger_evaluation" && step.kind !== "case_event") continue;
      const candidates = (step.data?.candidates as Array<{ flowId: string; why: string }> | undefined) ?? [];
      const mine = candidates.find((c) => c.flowId === flow.id);
      if (mine) return mine.why;
      if (step.kind === "trigger_evaluation") return step.text;
    }
  }
  return "El disparador no se activó con este perfil.";
}

function randomFor(ctx: Ctx, assignment: Assignment): () => number {
  const values: number[] = [];
  for (const [key, optionId] of Object.entries(assignment)) {
    if (!key.startsWith("ab:")) continue;
    const rest = key.slice(3);
    const cut = rest.lastIndexOf(":");
    const flow = ctx.catalog.flows.find((f) => f.id === rest.slice(0, cut));
    const node = flow?.nodes.find((n) => n.id === rest.slice(cut + 1));
    if (node) values.push(abRandomFor(abPathsOf(node), optionId.slice(key.length + 1)));
  }
  let i = 0;
  // Sin variante elegida, las pruebas A/B toman su primer camino (así el resultado no cambia entre ejecuciones).
  return () => (values.length === 0 ? 0 : values[i++ % values.length]);
}

function newItem(state: LabState, initial: ExploreStateSummary, initialMessages: number): Item {
  return {
    state,
    steps: [],
    visited: [],
    visitedKeys: new Set(),
    conditions: [],
    abPaths: [],
    warnings: [],
    flowIds: [],
    contexts: [],
    depth: 0,
    initial,
    initialMessages,
  };
}

/** Anota en el camino lo que pasó en las trazas. `evaluated` recoge las dimensiones que miraron sus condiciones. */
function absorb(ctx: Ctx, item: Item, traces: readonly LabTrace[], evaluated: Set<string>): void {
  for (const trace of traces) {
    for (const v of trace.visited) {
      const key = `${v.flowId}:${v.nodeId}`;
      if (item.visitedKeys.has(key)) continue;
      item.visitedKeys.add(key);
      item.visited.push({ flowId: v.flowId, nodeId: v.nodeId });
      if (!item.flowIds.includes(v.flowId)) item.flowIds.push(v.flowId);
    }
    for (const step of trace.steps) {
      if (!step.flowId || !step.nodeId) continue;
      if (step.kind === "condition") {
        item.conditions.push({ flowId: step.flowId, nodeId: step.nodeId, output: step.data?.path === "yes" ? "yes" : "no" });
        const node = ctx.catalog.flows.find((f) => f.id === step.flowId)?.nodes.find((n) => n.id === step.nodeId);
        for (const c of node ? conditionsOf(node) : []) {
          const key = dimensionKeyOf(c);
          if (key) evaluated.add(key);
        }
      } else if (step.kind === "node" && step.data?.weight !== undefined && typeof step.data.path === "string") {
        item.abPaths.push({ flowId: step.flowId, nodeId: step.nodeId, path: step.data.path });
        evaluated.add(abDimensionKey(step.flowId, step.nodeId));
      }
    }
    for (const w of trace.warnings) if (!item.warnings.includes(w)) item.warnings.push(w);
  }
}

// ── Recorrido de un camino ──────────────────────────────────────────────────

function findWaiting(state: LabState): LabSession | null {
  const now = new Date(state.clock).getTime();
  const rows = state.sessions
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.status === "active" && s.waitingForInput && (!s.waitingUntil || new Date(s.waitingUntil).getTime() > now))
    .sort((a, b) => new Date(b.s.updatedAt).getTime() - new Date(a.s.updatedAt).getTime() || b.i - a.i);
  return rows[0]?.s ?? null;
}

function pendingJobMinutes(state: LabState): number | null {
  const now = new Date(state.clock).getTime();
  let best: number | null = null;
  for (const job of state.jobs) {
    if (job.status !== "pending") continue;
    const session = state.sessions.find((s) => s.id === job.sessionId);
    if (!session || session.status !== "active") continue;
    const at = new Date(job.runAt).getTime();
    if (best === null || at < best) best = at;
  }
  return best === null ? null : Math.max(1, Math.ceil((best - now) / 60_000));
}

function durationText(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? "día" : "días"}`;
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? "hora" : "horas"}`;
  return `${minutes} min`;
}

function contextKey(state: LabState, session: LabSession): string {
  const open = state.cases.filter((c) => c.status === "open");
  return [
    session.flowId,
    session.currentNodeId,
    session.variables.__menu ?? "",
    [...state.contact.tags].sort().join(","),
    open.map((c) => `${c.caseTypeId}:${c.stageId}`).join(","),
    state.automationPaused,
  ].join("|");
}

function endOf(ctx: Ctx, state: LabState): ExploreEnd {
  const flowName = (id: string) => ctx.catalog.flows.find((f) => f.id === id)?.name ?? id;
  if (state.sessions.some((s) => s.humanTakeoverAt)) {
    return { kind: "human", text: "El flujo pasa a atención humana: el bot queda en pausa y atiende una persona." };
  }
  const last = state.sessions[state.sessions.length - 1];
  if (last && last.flowId !== ctx.flow.id) {
    return { kind: "goto", text: `El flujo salta a «${flowName(last.flowId)}» y termina allí.` };
  }
  return { kind: "flow_end", text: "El flujo terminó." };
}

function finish(ctx: Ctx, item: Item, end: ExploreEnd): RawPath {
  const final = summarizeState(ctx.catalog, item.state);
  return {
    steps: item.steps,
    messages: item.state.messages.slice(item.initialMessages),
    visited: item.visited,
    conditions: item.conditions,
    abPaths: item.abPaths,
    end,
    final,
    changes: diffSummaries(item.initial, final),
    warnings: item.warnings,
    flowIds: item.flowIds,
  };
}

function child(item: Item, state: LabState, step: ExploreStep): Item {
  return {
    ...item,
    state,
    steps: [...item.steps, step],
    visited: [...item.visited],
    visitedKeys: new Set(item.visitedKeys),
    conditions: [...item.conditions],
    abPaths: [...item.abPaths],
    warnings: [...item.warnings],
    flowIds: [...item.flowIds],
    contexts: [...item.contexts],
    depth: item.depth + 1,
  };
}

interface AssignmentOutcome {
  paths: RawPath[];
  /** Ramas que no se exploraron por el cupo de caminos. */
  unexplored: ExploreStep[][];
  evaluated: Set<string>;
  starts: ExploreStartReport[];
  initial: ExploreStateSummary | null;
  profile: string | null;
  /** Algún arranque falló: en una variante significa que la variante no sirve. */
  startFailed: boolean;
}

function run(ctx: Ctx, action: () => LabResult): LabResult | null {
  if (ctx.actions >= ctx.maxActions) {
    ctx.actionLimit = true;
    return null;
  }
  ctx.actions++;
  return action();
}

function exploreAssignment(ctx: Ctx, assignment: Assignment, budget: number): AssignmentOutcome {
  const evaluated = new Set<string>();
  const out: AssignmentOutcome = { paths: [], unexplored: [], evaluated, starts: [], initial: null, profile: null, startFailed: false };
  const random = randomFor(ctx, assignment);
  const labOptions: LabOptions = { random };
  const optionsOf = Object.entries(assignment).flatMap(([key, id]) => ctx.dimensions.get(key)?.options.filter((o) => o.id === id) ?? []);

  const queue: Item[] = [];
  const done: RawPath[] = [];

  // 1. Arrancar el flujo con cada uno de sus disparadores.
  ctx.plans.forEach((plan, planIndex) => {
    const report: ExploreStartReport = { nodeId: plan.nodeId, trigger: plan.trigger, action: plan.step.label, ok: false, profile: null };
    out.starts.push(report);
    let problem = "";
    for (const profile of candidateProfiles(ctx, plan)) {
      const state = createLabState(ctx.catalog, { profile, channel: ctx.channel, clock: ctx.clock, enabledFlowIds: ctx.enabledFlowIds });
      plan.prepare(ctx.catalog, state);
      for (const option of optionsOf) option.apply(ctx.catalog, state);
      const initial = summarizeState(ctx.catalog, state);
      const initialMessages = state.messages.length;
      ctx.actions++;
      const fired = plan.fire(ctx.catalog, state, labOptions);
      const started = fired.traces.some((t) => t.visited.some((v) => v.flowId === ctx.flow.id && v.nodeId === plan.nodeId));
      if (fired.error || !started) {
        problem = fired.error ?? explainNoStart(ctx.flow, fired.traces);
        continue;
      }
      report.ok = true;
      report.profile = profile.name;
      report.action = plan.step.label;
      const item = newItem(fired.state, initial, initialMessages);
      item.steps = [{ ...plan.step, seq: planIndex }];
      absorb(ctx, item, fired.traces, evaluated);
      if (!out.initial) {
        out.initial = initial;
        out.profile = profile.name;
      }
      queue.push(item);
      return;
    }
    report.problem = problem || "El disparador no se activó.";
    out.startFailed = true;
    done.push({
      steps: [{ ...plan.step, seq: planIndex }],
      messages: [],
      visited: [],
      conditions: [],
      abPaths: [],
      end: { kind: "error", text: `El flujo no se dispara: ${report.problem}` },
      final: summarizeState(ctx.catalog, createLabState(ctx.catalog, { clock: ctx.clock, channel: ctx.channel })),
      changes: [],
      warnings: [],
      flowIds: [],
    });
  });

  // 2. Recorrer a lo ancho: todas las opciones de una espera antes de seguir más abajo.
  while (queue.length > 0) {
    let item = queue.shift()!;
    for (;;) {
      const { state } = item;
      const waiting = state.automationPaused ? null : findWaiting(state);
      if (!waiting) {
        // Sin espera de respuesta: o una espera de tiempo (nodo Espera) que se avanza, o terminó.
        const minutes = state.automationPaused ? null : pendingJobMinutes(state);
        if (minutes !== null && item.depth < ctx.maxDepth) {
          const result = run(ctx, () => advanceTime(ctx.catalog, state, minutes, labOptions));
          if (!result) {
            done.push(finish(ctx, item, { kind: "path_limit", text: "Se alcanzó el tope de acciones del simulador." }));
            break;
          }
          const step: ExploreStep = { kind: "time", label: `Pasan ${durationText(minutes)}`, seq: 0 };
          if (result.trace.error) {
            done.push(finish(ctx, child(item, state, step), { kind: "error", text: result.trace.error }));
            break;
          }
          const next = child(item, result.state, step);
          absorb(ctx, next, [result.trace], evaluated);
          item = next;
          continue;
        }
        if (minutes !== null) {
          done.push(finish(ctx, item, { kind: "depth_limit", text: `Se cortó en el paso ${item.depth}: el flujo seguía esperando que pase el tiempo (profundidad máxima).` }));
          break;
        }
        done.push(finish(ctx, item, endOf(ctx, state)));
        break;
      }

      const flow = ctx.catalog.flows.find((f) => f.id === waiting.flowId);
      const waitNode = flow?.nodes.find((n) => n.id === waiting.currentNodeId);
      const where = waitNode ? `«${labelOf(waitNode)}»` : "una espera";
      if (item.depth >= ctx.maxDepth) {
        done.push(finish(ctx, item, { kind: "depth_limit", text: `Se cortó en el paso ${item.depth} (profundidad máxima): el flujo seguía esperando una respuesta en ${where}.` }));
        break;
      }
      const key = contextKey(state, waiting);
      if (item.contexts.includes(key)) {
        done.push(finish(ctx, item, { kind: "cycle", text: `Ciclo: el flujo vuelve a esperar en ${where} con el mismo estado.` }));
        break;
      }
      item.contexts.push(key);

      const options: ExploreStep[] = flow ? replyOptions(flow, state, waiting) : [];
      if (ctx.options.noReply !== false || options.length === 0) {
        options.push({
          kind: "no_reply",
          label: "El cliente no responde",
          seq: options.length,
        });
      }
      options.forEach((o, i) => (o.seq = i));

      // Cupo: el camino actual se reemplaza por sus ramas.
      const room = budget - done.length - queue.length;
      const kept = options.slice(0, Math.max(0, room));
      for (const dropped of options.slice(kept.length)) out.unexplored.push([...item.steps, dropped]);
      if (kept.length === 0) {
        done.push(finish(ctx, item, { kind: "path_limit", text: "Se alcanzó el máximo de caminos: las ramas de este punto no se exploraron." }));
        break;
      }

      for (const step of kept) {
        if (step.kind === "no_reply") {
          const until = waiting.waitingUntil ? `; la espera vence el ${limaDateTime(waiting.waitingUntil)} (Lima)` : "";
          done.push(finish(ctx, child(item, state, step), { kind: "waiting", text: `El flujo queda esperando en ${where}: el cliente no responde${until}.` }));
          continue;
        }
        const result = run(ctx, () => clientSays(ctx.catalog, state, step.input!, labOptions));
        if (!result) {
          done.push(finish(ctx, child(item, state, step), { kind: "path_limit", text: "Se alcanzó el tope de acciones del simulador." }));
          continue;
        }
        if (result.trace.error) {
          done.push(finish(ctx, child(item, state, step), { kind: "error", text: result.trace.error }));
          continue;
        }
        const next = child(item, result.state, step);
        absorb(ctx, next, [result.trace], evaluated);
        queue.push(next);
      }
      break;
    }
  }
  out.paths = done;
  return out;
}

// ── Árbol, cobertura y resultado ────────────────────────────────────────────

function signatureOf(path: RawPath): string {
  return JSON.stringify([
    path.steps.filter((s) => s.kind !== "variant").map((s) => `${s.kind}|${s.label}`),
    path.visited.map((v) => `${v.flowId}:${v.nodeId}`),
    path.end.kind,
    path.final,
    path.messages.map((m) => `${m.author}:${m.kind}:${m.text}`),
  ]);
}

function shortLabel(steps: readonly ExploreStep[], flowName: string): string {
  const parts = steps.filter((s) => s.kind !== "variant" && s.kind !== "start" && s.kind !== "time").map((s) => s.label);
  if (parts.length > 0) return parts.join(" → ");
  const start = steps.find((s) => s.kind === "start");
  return start ? start.label : flowName;
}

/** Ids de los nodos del árbol por los que pasa un camino (para resaltarlo). */
export function pathTreeIds(path: Pick<ExplorePath, "steps">): string[] {
  let id = "root";
  return path.steps.map((step) => (id = `${id}/${step.kind}|${step.label}`));
}

function insert(root: ExploreTreeNode, steps: readonly ExploreStep[], leaf: Partial<ExploreTreeNode>): void {
  let node = root;
  steps.forEach((step, i) => {
    const id = `${node.id}/${step.kind}|${step.label}`;
    let next = node.children.find((c) => c.id === id);
    if (!next) {
      next = { id, kind: step.kind, label: step.label, children: [] };
      node.children.push(next);
    }
    node = next;
    if (i === steps.length - 1) Object.assign(node, leaf);
  });
}

function buildCoverage(ctx: Ctx, paths: readonly ExplorePath[]): ExploreCoverage {
  const { flow } = ctx;
  const reachedNodes = new Set<string>();
  const taken = new Set<string>();
  for (const p of paths) {
    for (const v of p.visited) if (v.flowId === flow.id) reachedNodes.add(v.nodeId);
    for (const c of p.conditions) if (c.flowId === flow.id) taken.add(`${c.nodeId}:${c.output}`);
    for (const a of p.abPaths) if (a.flowId === flow.id) taken.add(`${a.nodeId}:${a.path}`);
  }
  const unreachedNodes: ExploreCoverageItem[] = [];
  const unreachedOutputs: ExploreOutputItem[] = [];
  let outputsTotal = 0;
  let outputsReached = 0;
  for (const node of flow.nodes) {
    const kind = nodeKindLabel(nodeKind(node));
    const label = labelOf(node);
    const base = { flowId: flow.id, nodeId: node.id, label, kind };
    if (!reachedNodes.has(node.id)) unreachedNodes.push(base);
    const outputs =
      nodeKind(node) === "condition"
        ? [
            { output: "yes", text: "Sí" },
            { output: "no", text: "No" },
          ]
        : nodeKind(node) === "abSplit"
          ? abPathsOf(node).map((p) => ({ output: p.name, text: `camino «${p.name}»` }))
          : [];
    for (const o of outputs) {
      outputsTotal++;
      if (taken.has(`${node.id}:${o.output}`)) outputsReached++;
      else unreachedOutputs.push({ ...base, output: o.output, description: `${label} → ${o.text}` });
    }
  }
  const nodesTotal = flow.nodes.length;
  const nodesReached = nodesTotal - unreachedNodes.length;
  const total = nodesTotal + outputsTotal;
  return {
    flowId: flow.id,
    nodesTotal,
    nodesReached,
    outputsTotal,
    outputsReached,
    percent: total === 0 ? 100 : Math.round(((nodesReached + outputsReached) / total) * 100),
    unreachedNodes,
    unreachedOutputs,
    complete: unreachedNodes.length === 0 && unreachedOutputs.length === 0,
  };
}

/** Avisos de lo que el explorador no puede probar. */
function explorerNotes(ctx: Ctx, clocksOutside: string | null): string[] {
  const notes: string[] = [];
  for (const node of ctx.flow.nodes) {
    if (nodeKind(node) !== "condition") continue;
    for (const c of conditionsOf(node)) {
      if (c.field === "within_hours" && !clocksOutside) {
        notes.push(`«${labelOf(node)}» mira el horario, pero el espacio no tiene horas cerradas: no se pudo probar «fuera de horario».`);
      } else if (!isCaseConditionField(c.field)) {
        const parsed = parseConditionField(upgradeCondition(c, isCaseConditionField));
        if (parsed.kind === "variable" && parsed.name !== "message") {
          notes.push(`«${labelOf(node)}» depende de la variable «${parsed.name || c.field}», que el explorador no puede fijar: esa salida puede quedar sin recorrer.`);
        }
      }
    }
  }
  return [...new Set(notes)];
}

/** Explora todos los caminos de un flujo. */
export function exploreFlow(catalog: LabCatalog, options: ExploreOptions): ExploreResult {
  const flow = catalog.flows.find((f) => f.id === options.flowId);
  if (!flow) throw new Error("El flujo que quieres explorar no existe.");
  const clock = options.clock ?? DEFAULT_EXPLORE_CLOCK;
  const channel = options.channel ?? "whatsapp";
  const maxDepth = clamp(options.maxDepth, DEFAULT_MAX_DEPTH, 1, 100);
  const maxPaths = clamp(options.maxPaths, DEFAULT_MAX_PATHS, 1, 1000);
  const maxVariants = clamp(options.maxVariants, DEFAULT_MAX_VARIANTS, 0, 100);

  const closure = flowClosure(catalog, flow.id);
  const enabledFlowIds = closure.map((f) => f.id);
  const clocks = findClocks(catalog, clock);
  const plans = planStarts(catalog, flow, options.startText).filter((p) => !options.triggerNodeId || p.nodeId === options.triggerNodeId);
  const dimensions = options.variants === false ? new Map<string, Dimension>() : buildDimensions(catalog, closure, clocks);
  const staticKeys: string[] = [];
  if (options.variants !== false && options.windowVariants !== false && channel === "whatsapp" && plans.some((p) => p.event)) {
    dimensions.set(WINDOW_DIMENSION.key, WINDOW_DIMENSION);
    staticKeys.push(WINDOW_DIMENSION.key);
  }
  const ctx: Ctx = {
    catalog,
    flow,
    options,
    clock,
    channel,
    maxDepth,
    maxPaths,
    enabledFlowIds,
    dimensions,
    plans,
    actions: 0,
    maxActions: clamp(options.maxActions, DEFAULT_MAX_ACTIONS, 1, 100_000),
    actionLimit: false,
  };

  const truncated = { paths: false, variants: false, depth: false, actions: false };
  const kept: Array<{ raw: RawPath; variantOrder: number; variant: string[] }> = [];
  const unexplored: Array<{ steps: ExploreStep[]; variantOrder: number; variant: string[] }> = [];
  const seen = new Set<string>();
  const queued = new Set<string>([canonical({})]);
  const queue: Assignment[] = [{}];
  const order = new Map<string, number>([[canonical({}), 0]]);
  let starts: ExploreStartReport[] = [];
  let initial: ExploreStateSummary | null = null;
  let profileName: string | null = null;
  const variantLabels: string[] = [];

  while (queue.length > 0) {
    const assignment = queue.shift()!;
    const isBase = Object.keys(assignment).length === 0;
    const budget = maxPaths - kept.length;
    if (budget <= 0) {
      truncated.variants = true;
      break;
    }
    const outcome = exploreAssignment(ctx, assignment, budget);
    if (isBase) {
      starts = outcome.starts;
      initial = outcome.initial;
      profileName = outcome.profile;
    } else if (outcome.startFailed) {
      // La variante no deja arrancar el flujo (por ejemplo, otro tipo de gestión): no sirve.
      continue;
    }

    // Variantes nuevas: las dimensiones que miraron las condiciones de este camino.
    const keys = [...outcome.evaluated, ...(isBase ? staticKeys : [])];
    for (const key of keys) {
      const dim = dimensions.get(key);
      if (!dim || key in assignment) continue;
      for (const option of dim.options) {
        const next = { ...assignment, [key]: option.id };
        const id = canonical(next);
        if (queued.has(id)) continue;
        if (queued.size > maxVariants) {
          truncated.variants = true;
          continue;
        }
        queued.add(id);
        order.set(id, order.size);
        queue.push(next);
      }
    }

    const labels = Object.entries(assignment).flatMap(([key, id]) => dimensions.get(key)?.options.filter((o) => o.id === id).map((o) => o.label) ?? []);
    const variantOrder = order.get(canonical(assignment)) ?? 0;
    let added = 0;
    for (const raw of outcome.paths) {
      const sig = signatureOf(raw);
      if (seen.has(sig)) continue;
      seen.add(sig);
      kept.push({ raw, variantOrder, variant: labels });
      added++;
    }
    for (const steps of outcome.unexplored) unexplored.push({ steps, variantOrder, variant: labels });
    if (!isBase && added > 0) for (const l of labels) if (!variantLabels.includes(l)) variantLabels.push(l);
  }

  // Orden del árbol: variante, disparador y luego la posición de cada elección.
  const compare = (a: { steps: ExploreStep[]; variantOrder: number }, b: { steps: ExploreStep[]; variantOrder: number }) => {
    if (a.variantOrder !== b.variantOrder) return a.variantOrder - b.variantOrder;
    const n = Math.max(a.steps.length, b.steps.length);
    for (let i = 0; i < n; i++) {
      const x = a.steps[i]?.seq ?? -1;
      const y = b.steps[i]?.seq ?? -1;
      if (x !== y) return x - y;
    }
    return 0;
  };
  kept.sort((a, b) => compare({ steps: a.raw.steps, variantOrder: a.variantOrder }, { steps: b.raw.steps, variantOrder: b.variantOrder }));

  const hasVariants = kept.some((k) => k.variantOrder > 0) || unexplored.some((u) => u.variantOrder > 0);
  const withVariantSteps = (steps: ExploreStep[], variant: string[], variantOrder: number): ExploreStep[] => {
    if (!hasVariants) return steps;
    const label = variant.length > 0 ? variant.join(" y ") : "Caso base";
    return [{ kind: "variant", label, seq: variantOrder }, ...steps];
  };

  const paths: ExplorePath[] = kept.map(({ raw, variantOrder, variant }, i) => {
    const steps = withVariantSteps(raw.steps, variant, variantOrder);
    return {
      id: i + 1,
      label: shortLabel(raw.steps, flow.name),
      variant,
      steps,
      messages: raw.messages,
      visited: raw.visited,
      conditions: raw.conditions,
      abPaths: raw.abPaths,
      end: raw.end,
      final: raw.final,
      changes: raw.changes,
      warnings: raw.warnings,
      flowIds: raw.flowIds,
    };
  });

  const tree: ExploreTreeNode = { id: "root", kind: "root", label: flow.name, children: [] };
  for (const p of paths) insert(tree, p.steps, { pathId: p.id, endKind: p.end.kind });
  for (const u of unexplored.sort((a, b) => compare(a, b))) insert(tree, withVariantSteps(u.steps, u.variant, u.variantOrder), { skipped: true });

  truncated.paths = unexplored.length > 0 || paths.some((p) => p.end.kind === "path_limit");
  truncated.depth = paths.some((p) => p.end.kind === "depth_limit");
  truncated.actions = ctx.actionLimit;

  const notes = explorerNotes(ctx, clocks.outside);
  if (!initial) notes.push("El flujo no se pudo arrancar: revisa el disparador y el perfil.");
  if (truncated.paths) notes.push(`Se alcanzó el máximo de ${maxPaths} caminos: hay ramas sin explorar (aparecen marcadas en el árbol). Sube el máximo para verlas.`);
  if (truncated.variants) notes.push(`Había más variantes del estado de partida que el máximo (${maxVariants}) o el cupo de caminos se agotó: algunas no se probaron.`);
  if (truncated.depth) notes.push(`Algún camino se cortó por la profundidad máxima (${maxDepth} pasos).`);
  if (truncated.actions) notes.push("Se alcanzó el tope de acciones del simulador: la exploración quedó incompleta.");

  return {
    flowId: flow.id,
    flowName: flow.name,
    options: { maxDepth, maxPaths, maxVariants, channel, clock },
    initial: initial ?? summarizeState(catalog, createLabState(catalog, { clock, channel })),
    profileName,
    starts,
    paths,
    tree,
    coverage: buildCoverage(ctx, paths),
    variants: variantLabels,
    truncated,
    notes,
    actions: ctx.actions,
  };
}

/** Nodos recorridos por un camino, agrupados por flujo, para iluminar el mapa. */
export function highlightOfPath(path: Pick<ExplorePath, "visited">): { flowId: string; nodeIds: string[] }[] {
  const byFlow = new Map<string, string[]>();
  for (const v of path.visited) byFlow.set(v.flowId, [...(byFlow.get(v.flowId) ?? []), v.nodeId]);
  return [...byFlow].map(([flowId, nodeIds]) => ({ flowId, nodeIds }));
}
