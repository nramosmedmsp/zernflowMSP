// Ayudas para las pruebas del laboratorio: un "guion" que encadena acciones y
// guarda el estado, y atajos para leer el resultado.

import * as lab from "./actions";
import { buildCatalogFromTemplates, type BuildCatalogOptions } from "./from-templates";
import { createLabState, currentCase, type CreateStateInput } from "./state";
import type { ClientInput, CloseCaseInput, LabCase, LabCatalog, LabMessage, LabResult, LabState, LabTrace, TraceKind, TraceStep } from "./types";

/** Lunes 19/10/2026 10:00 en Lima (15:00 UTC). */
export const MONDAY_10AM = "2026-10-19T15:00:00.000Z";

export class Script {
  state: LabState;
  last!: LabTrace;
  traces: LabTrace[] = [];

  constructor(
    readonly catalog: LabCatalog,
    input: CreateStateInput = {},
  ) {
    this.state = createLabState(catalog, { clock: MONDAY_10AM, ...input });
  }

  apply(result: LabResult): this {
    this.state = result.state;
    this.last = result.trace;
    this.traces.push(result.trace);
    return this;
  }

  says(text: string): this {
    return this.apply(lab.clientSays(this.catalog, this.state, { kind: "text", text }));
  }

  press(title: string, payload?: string, buttonType?: "postback" | "quick_reply"): this {
    const input: ClientInput = { kind: "button", title, payload: payload ?? title, buttonType };
    return this.apply(lab.clientSays(this.catalog, this.state, input));
  }

  wait(minutes: number): this {
    return this.apply(lab.advanceTime(this.catalog, this.state, minutes));
  }

  agent(text: string, agentId?: string): this {
    return this.apply(lab.agentReplies(this.catalog, this.state, text, { agentId }));
  }

  stage(name: string): this {
    return this.apply(lab.changeStage(this.catalog, this.state, this.stageId(name)));
  }

  stageById(stageId: string): this {
    return this.apply(lab.changeStage(this.catalog, this.state, stageId));
  }

  classify(typeName: string): this {
    return this.apply(lab.classify(this.catalog, this.state, this.typeId(typeName)));
  }

  close(input: CloseCaseInput): this {
    return this.apply(lab.closeCase(this.catalog, this.state, input));
  }

  assign(memberId: string | null): this {
    return this.apply(lab.assign(this.catalog, this.state, memberId));
  }

  contact(partial: Parameters<typeof lab.setContact>[2]): this {
    return this.apply(lab.setContact(this.catalog, this.state, partial));
  }

  botPaused(paused: boolean): this {
    return this.apply(lab.setBotPaused(this.catalog, this.state, paused));
  }

  // Lecturas

  stageId(name: string, typeName?: string): string {
    const type = typeName ? this.catalog.caseTypes.find((t) => t.name === typeName) : this.currentType();
    const stage = (type ? [type] : this.catalog.caseTypes).flatMap((t) => t.stages).find((s) => s.name === name);
    if (!stage) throw new Error(`No hay una etapa «${name}»`);
    return stage.id;
  }

  typeId(name: string): string {
    const type = this.catalog.caseTypes.find((t) => t.name === name);
    if (!type) throw new Error(`No hay un tipo «${name}»`);
    return type.id;
  }

  currentType() {
    const row = this.openCase() ?? currentCase(this.state);
    return this.catalog.caseTypes.find((t) => t.id === row?.caseTypeId);
  }

  contactTypeId(name: string): string {
    const type = this.catalog.contactTypes.find((t) => t.name === name);
    if (!type) throw new Error(`No hay un tipo de contacto «${name}»`);
    return type.id;
  }

  openCase(): LabCase | undefined {
    return this.state.cases.find((c) => c.status === "open");
  }

  casesOfType(typeName: string): LabCase[] {
    const id = this.typeId(typeName);
    return this.state.cases.filter((c) => c.caseTypeId === id);
  }

  stageNameOf(row: LabCase | undefined): string | undefined {
    return row?.stageId ? this.catalog.caseTypes.flatMap((t) => t.stages).find((s) => s.id === row.stageId)?.name : undefined;
  }

  typeNameOf(row: LabCase | undefined): string | undefined {
    return this.catalog.caseTypes.find((t) => t.id === row?.caseTypeId)?.name;
  }

  /** Mensajes del bot, del asesor o del cliente de toda la conversación. */
  messages(author?: LabMessage["author"]): LabMessage[] {
    return this.state.messages.filter((m) => !author || m.author === author);
  }

  botTexts(): string[] {
    return this.messages("bot").map((m) => m.text);
  }

  /** Mensajes nuevos de la última acción. */
  newBotTexts(): string[] {
    return this.last.messages.filter((m) => m.author === "bot").map((m) => m.text);
  }

  steps(kind: TraceKind, trace: LabTrace = this.last): TraceStep[] {
    return trace.steps.filter((s) => s.kind === kind);
  }

  allText(trace: LabTrace = this.last): string {
    return trace.steps.map((s) => s.text).join("\n");
  }

  visitedNodes(flowId?: string): string[] {
    return this.last.visited.filter((v) => !flowId || v.flowId === flowId).map((v) => v.nodeId);
  }
}

export async function ecommerceCatalog(options: BuildCatalogOptions = {}): Promise<LabCatalog> {
  return buildCatalogFromTemplates({ business: "ecommerce", ...options });
}

/**
 * Cliente que vuelve a escribir: ya existe como contacto y es de tipo «Cliente», para el que ningún tipo de
 * gestión se sugiere (en E-commerce, Venta solo se sugiere para Prospecto), así que su gestión nueva queda sin clasificar.
 */
export function returningCustomer(catalog: LabCatalog, input: CreateStateInput = {}): Script {
  const type = catalog.contactTypes.find((t) => t.name === "Cliente");
  if (!type) throw new Error("No hay un tipo de contacto «Cliente»");
  return new Script(catalog, { ...input, contact: { name: "Lucía", existed: true, contactTypeId: type.id, ...(input.contact ?? {}) } });
}

export function flowIdOf(catalog: LabCatalog, name: string): string {
  const flow = catalog.flows.find((f) => f.name === name);
  if (!flow) throw new Error(`No hay un flujo «${name}»`);
  return flow.id;
}
