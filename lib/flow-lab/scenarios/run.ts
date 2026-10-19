// Ejecutor de escenarios: corre los pasos con las acciones del simulador (sin
// escribir en la base ni enviar mensajes) y comprueba cada expectativa en el
// momento que indica, con el catálogo que se le pase.

import { createLabState } from "../state";
import type { LabCatalog, LabOptions, LabState, LabTrace } from "../types";
import { describeExpectation, describeStep } from "./describe";
import { evaluateExpectation } from "./expectations";
import { buildScenarioProfile, flowIdsByName, resolveStep } from "./resolve";
import type { ExpectationResult, ScenarioDefinition, ScenarioExpectation, ScenarioResult, ScenarioRun, StepError } from "./types";

export interface RunScenarioOptions {
  /** Reloj inicial (ISO) si el escenario no trae `startAt`. Por defecto, la hora actual. */
  nowIso?: string;
  /** Sorteo de las pruebas A/B. Por defecto siempre 0 (el primer camino), para que el resultado sea estable. */
  random?: LabOptions["random"];
}

/** Expectativa que no se pudo comprobar: falla y dice por qué. */
function unchecked(e: ScenarioExpectation, reason: string): ExpectationResult {
  return { id: e.id, description: describeExpectation(e), after: e.after ?? null, ok: false, expected: describeExpectation(e), actual: reason };
}

function summarize(
  ranAt: string,
  expectations: ExpectationResult[],
  stepError: StepError | null,
): ScenarioResult {
  const passed = expectations.filter((e) => e.ok).length;
  const failed = expectations.length - passed;
  return { ok: failed === 0 && !stepError, ranAt, total: expectations.length, passed, failed, stepError, expectations };
}

/** Corre un escenario completo. No lanza: cualquier problema queda en `result`. */
export function runScenario(catalog: LabCatalog, definition: ScenarioDefinition, options: RunScenarioOptions = {}): ScenarioRun {
  const ranAt = new Date().toISOString();
  const nowIso = definition.startAt && !Number.isNaN(Date.parse(definition.startAt)) ? definition.startAt : (options.nowIso ?? ranAt);
  const labOptions: LabOptions = { random: options.random ?? (() => 0) };

  const blankRun = (stepError: StepError): ScenarioRun => ({
    result: summarize(
      ranAt,
      definition.expectations.map((e) => unchecked(e, "No se pudo comprobar porque el escenario no pudo correr.")),
      stepError,
    ),
    traces: [],
    initialState: null,
    states: [],
    finalState: null,
  });

  // Punto de partida
  const profile = buildScenarioProfile(catalog, definition.profile, nowIso);
  if (!profile.ok) return blankRun({ step: 0, text: "Punto de partida", message: profile.error });
  let enabledFlowIds: string[] | null = null;
  if (definition.flows !== "published") {
    const ids = flowIdsByName(catalog, definition.flows);
    if (!ids.ok) return blankRun({ step: 0, text: "Flujos que participan", message: ids.error });
    enabledFlowIds = ids.value;
  }

  let state: LabState = createLabState(catalog, { profile: profile.value, channel: definition.channel, clock: nowIso, enabledFlowIds });
  const initialState = state;
  const traces: LabTrace[] = [];
  const states: LabState[] = [];
  let stepError: StepError | null = null;

  for (let i = 0; i < definition.steps.length; i++) {
    const step = definition.steps[i];
    const text = describeStep(step);
    const runner = resolveStep(catalog, state, step);
    if (!runner.ok) {
      stepError = { step: i + 1, text, message: runner.error };
      break;
    }
    let result;
    try {
      result = runner.value(state, labOptions);
    } catch (e) {
      stepError = { step: i + 1, text, message: `La simulación falló: ${e instanceof Error ? e.message : "error desconocido"}` };
      break;
    }
    if (result.trace.error) {
      stepError = { step: i + 1, text, message: result.trace.error };
      traces.push(result.trace);
      break;
    }
    state = result.state;
    traces.push(result.trace);
    states.push(state);
  }

  const executed = states.length;
  const expectations = definition.expectations.map((e): ExpectationResult => {
    const after = e.after ?? null;
    if (after !== null && (after < 1 || after > definition.steps.length || !Number.isInteger(after))) {
      return unchecked(e, `El paso ${after} no existe: el escenario tiene ${definition.steps.length} ${definition.steps.length === 1 ? "paso" : "pasos"}.`);
    }
    const index = after === null ? definition.steps.length : after;
    if (index > executed) {
      return unchecked(e, `No se pudo comprobar: el paso ${stepError?.step ?? index} no se pudo aplicar.`);
    }
    const at = index === 0 ? initialState : states[index - 1];
    return evaluateExpectation(e, { catalog, state: at, trace: index === 0 ? undefined : traces[index - 1] });
  });

  return { result: summarize(ranAt, expectations, stepError), traces, initialState, states, finalState: state };
}

