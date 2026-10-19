// Contexto de una acción: estado que se modifica (una copia), traza, mensajes
// nuevos y cola de eventos de gestión. Interno del laboratorio.

import { indexCatalog, type LabIndex } from "./catalog";
import { cloneState, nextId } from "./state";
import {
  MAX_EVENTS,
  type LabCatalog,
  type LabMessage,
  type LabOptions,
  type LabResult,
  type LabState,
  type LabTrace,
  type TraceKind,
  type TraceStep,
} from "./types";

/** Evento de gestión que disparan los flujos (igual que CaseFlowEvent, sin espacio ni contacto). */
export interface LabCaseEvent {
  type: "case_opened" | "case_stage_changed" | "case_closed" | "client_no_reply";
  caseId: string;
  caseTypeId: string | null;
  stageId: string | null;
  outcome?: "won" | "lost" | "resolved";
  /** case_opened: tipo de contacto del cliente al abrirse la gestión. */
  contactTypeId?: string | null;
  /** Ids de los flujos que ya corrieron en la cadena que provocó este evento. */
  chain?: string[];
}

export type StepExtra = Partial<Omit<TraceStep, "n" | "at" | "kind" | "text" | "level">> & {
  level?: TraceStep["level"];
};

export class Run {
  readonly index: LabIndex;
  readonly state: LabState;
  readonly steps: TraceStep[] = [];
  readonly visited: LabTrace["visited"] = [];
  readonly newMessages: LabMessage[] = [];
  readonly warnings: string[] = [];
  readonly queue: LabCaseEvent[] = [];
  readonly startedAt: string;
  error?: string;
  /** Cuántos flujos hay anidados con «Ir a otro flujo» (corta los bucles). */
  flowNesting = 0;

  constructor(
    readonly catalog: LabCatalog,
    state: LabState,
    readonly options: LabOptions = {},
  ) {
    this.index = indexCatalog(catalog);
    this.state = cloneState(state);
    this.startedAt = this.state.clock;
  }

  get now(): Date {
    return new Date(this.state.clock);
  }

  get nowIso(): string {
    return this.state.clock;
  }

  /** Añade un paso a la traza (y al registro de eventos del estado). */
  step(kind: TraceKind, text: string, extra: StepExtra = {}): TraceStep {
    const { level, ...rest } = extra;
    const step: TraceStep = {
      n: this.steps.length + 1,
      at: this.state.clock,
      kind,
      level: level ?? "info",
      text,
      ...rest,
    };
    if (step.flowId && !step.flowName) step.flowName = this.index.flowById.get(step.flowId)?.name;
    this.steps.push(step);
    this.state.counters.event += 1;
    this.state.events.push({
      id: this.state.counters.event,
      at: step.at,
      kind,
      text,
      flowId: step.flowId,
      nodeId: step.nodeId,
      caseId: step.caseId,
    });
    if (this.state.events.length > MAX_EVENTS) this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    return step;
  }

  ok(kind: TraceKind, text: string, extra: StepExtra = {}): TraceStep {
    return this.step(kind, text, { level: "ok", ...extra });
  }

  /** Aviso: algo que la simulación no hizo o hizo distinto a lo esperado. */
  warn(text: string, extra: StepExtra = {}): TraceStep {
    this.warnings.push(text);
    return this.step("warning", text, { level: "warning", ...extra });
  }

  /** Mensaje nuevo de la conversación. */
  addMessage(message: Omit<LabMessage, "id" | "at">): LabMessage {
    const full: LabMessage = { id: nextId(this.state, "message"), at: this.state.clock, ...message };
    this.state.messages.push(full);
    this.newMessages.push(full);
    return full;
  }

  visit(flowId: string, nodeId: string, step: number) {
    this.visited.push({ flowId, nodeId, step });
  }

  enqueue(event: LabCaseEvent) {
    this.queue.push(event);
  }

  finish(action: string, title: string): LabResult {
    return {
      state: this.state,
      trace: {
        action,
        title,
        startedAt: this.startedAt,
        endedAt: this.state.clock,
        steps: this.steps,
        visited: this.visited,
        messages: this.newMessages,
        warnings: this.warnings,
        ...(this.error ? { error: this.error } : {}),
      },
    };
  }

  /** La acción no se pudo aplicar: el estado vuelve a ser el original. */
  fail(original: LabState, action: string, title: string, error: string): LabResult {
    const run = new Run(this.catalog, original, this.options);
    run.error = error;
    run.step("error", error, { level: "error" });
    run.state.events.pop();
    run.state.counters.event -= 1;
    return run.finish(action, title);
  }
}
