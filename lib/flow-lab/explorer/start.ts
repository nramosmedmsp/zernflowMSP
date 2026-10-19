// Cómo arranca cada disparador de un flujo: el mensaje que lo activa, o el evento
// de gestión (cierre, cambio de etapa, cliente sin responder). Usa las acciones
// del simulador. Puro.

import { addDays, limaDateOf } from "@/lib/cases/dates";
import { triggerMinutes } from "@/lib/flow-engine/case-trigger-match";
import { advanceTime, changeStage, clientSays, closeCase } from "../actions";
import { describeTrigger, indexCatalog } from "../catalog";
import { latestOpenCase } from "../state";
import type { ClientInput, CloseCaseInput, LabCase, LabCaseType, LabCatalog, LabFlow, LabOptions, LabState, LabTrace, LabTrigger } from "../types";
import { firstOpenStageId, seedOpenCase } from "./seed";
import type { ExploreStep } from "./types";

export const START_TEXT = "Hola";

export interface StartRun {
  state: LabState;
  traces: LabTrace[];
  /** Si algo impidió arrancar (el estado queda como estaba). */
  error?: string;
}

export interface StartPlan {
  nodeId: string;
  nodeLabel: string;
  triggerType: string;
  /** «palabras clave: precio». */
  trigger: string;
  /** Paso inicial del camino («El cliente escribe «precio»»). */
  step: ExploreStep;
  /** Arranca por un evento de gestión, sin mensaje del cliente. */
  event: boolean;
  /** Necesita un contacto nuevo (primer mensaje). */
  needsNewContact: boolean;
  /** Tipos de contacto a los que se limita («Gestión nueva»). */
  contactTypeIds: string[];
  /** Deja listo el estado (la gestión abierta que necesita un evento). */
  prepare: (catalog: LabCatalog, state: LabState) => void;
  /** Dispara el flujo. */
  fire: (catalog: LabCatalog, state: LabState, options: LabOptions) => StartRun;
}

type Config = Record<string, unknown>;

function configOf(trigger: LabTrigger): Config {
  return trigger.config && typeof trigger.config === "object" ? (trigger.config as Config) : {};
}

function firstKeyword(config: Config): string | null {
  const list = Array.isArray(config.keywords) ? config.keywords : [];
  for (const k of list) {
    const value = typeof k === "string" ? k : (k as { value?: unknown } | null)?.value;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function messageRun(input: ClientInput) {
  return (catalog: LabCatalog, state: LabState, options: LabOptions): StartRun => {
    const result = clientSays(catalog, state, input, options);
    return result.trace.error ? { state, traces: [result.trace], error: result.trace.error } : { state: result.state, traces: [result.trace] };
  };
}

function openCaseOfType(state: LabState, caseTypeId: string | null | undefined): LabCase | undefined {
  const open = state.cases.filter((c) => c.status === "open" && (!caseTypeId || c.caseTypeId === caseTypeId));
  return open.length > 0 ? latestOpenCase({ cases: open }) ?? open[0] : undefined;
}

/** Datos que pide el cierre (categoría, motivo, fecha clave), con los primeros del tipo. */
function closeInput(type: LabCaseType | undefined, outcome: "won" | "lost" | "resolved", caseId: string, withKeyDate: string | null): CloseCaseInput {
  const input: CloseCaseInput = { kind: outcome, caseId };
  if (type?.categories.length) input.categoryId = [...type.categories].sort((a, b) => a.position - b.position)[0].id;
  // El motivo tiene que ser del mismo resultado que el cierre (ganada no lleva el motivo de una perdida).
  const reason = (type?.reasons ?? []).find((r) => r.kind === outcome);
  if (reason) input.outcomeReasonId = reason.id;
  if (withKeyDate) input.keyDate = withKeyDate;
  return input;
}

function closeRun(type: LabCaseType | undefined, outcome: "won" | "lost" | "resolved") {
  return (catalog: LabCatalog, state: LabState, options: LabOptions): StartRun => {
    const row = openCaseOfType(state, type?.id);
    if (!row) return { state, traces: [], error: "No hay una gestión abierta de ese tipo para cerrar." };
    let result = closeCase(catalog, state, closeInput(type, outcome, row.id, null), { options });
    if (result.trace.error) {
      // Una regla puede pedir la fecha clave del vencimiento: se prueba con una a 30 días.
      const keyDate = addDays(limaDateOf(new Date(state.clock)), 30);
      const retry = closeCase(catalog, state, closeInput(type, outcome, row.id, keyDate), { options });
      if (!retry.trace.error) result = retry;
    }
    return result.trace.error ? { state, traces: [result.trace], error: result.trace.error } : { state: result.state, traces: [result.trace] };
  };
}

/** Planes de arranque de un flujo: uno por cada nodo disparador que se sabe disparar. */
export function planStarts(catalog: LabCatalog, flow: LabFlow, startText?: string): StartPlan[] {
  const index = indexCatalog(catalog);
  const plans: StartPlan[] = [];
  for (const node of flow.nodes) {
    if (node.type !== "trigger") continue;
    const trigger = catalog.triggers.find((t) => t.flowId === flow.id && t.nodeId === node.id && SUPPORTED.has(t.type));
    if (!trigger) continue;
    const config = configOf(trigger);
    const label = typeof node.data?.label === "string" && node.data.label.trim() ? node.data.label : "Disparador";
    const base = {
      nodeId: node.id,
      nodeLabel: label,
      triggerType: trigger.type,
      trigger: describeTrigger(catalog, trigger),
      needsNewContact: false,
      contactTypeIds: [] as string[],
      prepare: () => {},
    };
    const message = (input: ClientInput, text: string, extra: Partial<StartPlan> = {}): StartPlan => ({
      ...base,
      event: false,
      step: { kind: "start", label: text, seq: 0, input },
      fire: messageRun(input),
      ...extra,
    });

    switch (trigger.type) {
      case "keyword": {
        const text = startText ?? firstKeyword(config) ?? START_TEXT;
        plans.push(message({ kind: "text", text }, `El cliente escribe «${text}»`));
        break;
      }
      case "postback":
      case "quick_reply": {
        const payload = String(config.payload ?? "");
        plans.push(
          message(
            { kind: "button", payload, title: payload, buttonType: trigger.type === "quick_reply" ? "quick_reply" : "postback" },
            `El cliente pulsa el botón «${payload}»`,
          ),
        );
        break;
      }
      case "welcome": {
        const text = startText ?? START_TEXT;
        plans.push(message({ kind: "text", text }, `Un contacto nuevo escribe «${text}»`, { needsNewContact: true }));
        break;
      }
      case "default": {
        const text = startText ?? START_TEXT;
        plans.push(message({ kind: "text", text }, `El cliente escribe «${text}»`));
        break;
      }
      case "case_opened": {
        const text = startText ?? START_TEXT;
        const ids = Array.isArray(config.contact_type_ids) ? config.contact_type_ids.filter((v): v is string => typeof v === "string") : [];
        plans.push(message({ kind: "text", text }, `El cliente escribe «${text}» y se abre una gestión nueva`, { contactTypeIds: ids }));
        break;
      }
      case "case_closed": {
        const typeId = typeof config.case_type_id === "string" ? config.case_type_id : null;
        const outcome = config.outcome === "won" || config.outcome === "lost" || config.outcome === "resolved" ? config.outcome : "resolved";
        const type = (typeId ? index.caseTypeById.get(typeId) : undefined) ?? catalog.caseTypes.find((t) => t.stages.some((s) => s.kind === outcome));
        const outcomeText = outcome === "won" ? "ganada" : outcome === "lost" ? "perdida" : "resuelta";
        plans.push({
          ...base,
          event: true,
          step: { kind: "start", label: `Se cierra como ${outcomeText} una gestión${type ? ` de ${type.name}` : ""}`, seq: 0 },
          prepare: (c, s) => {
            if (!openCaseOfType(s, type?.id)) seedOpenCase(c, s, { caseTypeId: type?.id });
          },
          fire: closeRun(type, outcome),
        });
        break;
      }
      case "case_stage_changed": {
        const stageId = typeof config.stage_id === "string" ? config.stage_id : null;
        const found = stageId ? index.stageById.get(stageId) : undefined;
        const typeId = (typeof config.case_type_id === "string" ? config.case_type_id : null) ?? found?.caseType.id ?? null;
        const type = typeId ? index.caseTypeById.get(typeId) : catalog.caseTypes[0];
        const open = (type?.stages ?? []).filter((s) => s.kind === "open").sort((a, b) => a.position - b.position);
        const target = found?.stage.id ?? open[1]?.id ?? open[0]?.id ?? null;
        const targetName = open.find((s) => s.id === target)?.name ?? found?.stage.name ?? "otra etapa";
        plans.push({
          ...base,
          event: true,
          step: { kind: "start", label: `La gestión${type ? ` de ${type.name}` : ""} pasa a «${targetName}»`, seq: 0 },
          prepare: (c, s) => {
            if (!openCaseOfType(s, type?.id)) {
              const row = seedOpenCase(c, s, { caseTypeId: type?.id });
              row.stageId = firstOpenStageId(type, target ?? undefined);
            } else {
              const row = openCaseOfType(s, type?.id)!;
              if (row.stageId === target) row.stageId = firstOpenStageId(type, target ?? undefined);
            }
          },
          fire: (c, s, options) => {
            const row = openCaseOfType(s, type?.id);
            if (!row || !target) return { state: s, traces: [], error: "No hay una gestión abierta de ese tipo o una etapa a la que pasar." };
            const result = changeStage(c, s, target, { caseId: row.id, options });
            return result.trace.error ? { state: s, traces: [result.trace], error: result.trace.error } : { state: result.state, traces: [result.trace] };
          },
        });
        break;
      }
      case "client_no_reply": {
        const minutes = triggerMinutes(config);
        const typeId = typeof config.case_type_id === "string" ? config.case_type_id : null;
        plans.push({
          ...base,
          event: true,
          step: { kind: "start", label: `El cliente no responde durante ${minutes} min`, seq: 0 },
          prepare: (c, s) => {
            const row = openCaseOfType(s, typeId) ?? seedOpenCase(c, s, { caseTypeId: typeId });
            const at = (ms: number) => new Date(new Date(s.clock).getTime() - ms).toISOString();
            row.lastInboundAt = at((minutes + 10) * 60_000);
            row.lastOutboundAt = at(Math.max(1, minutes - 1) * 60_000);
            row.waitingSince = null;
          },
          fire: (c, s, options) => {
            const result = advanceTime(c, s, 2, options);
            return result.trace.error ? { state: s, traces: [result.trace], error: result.trace.error } : { state: result.state, traces: [result.trace] };
          },
        });
        break;
      }
    }
  }
  return plans;
}

const SUPPORTED = new Set(["keyword", "postback", "quick_reply", "welcome", "default", "case_opened", "case_closed", "case_stage_changed", "client_no_reply"]);
