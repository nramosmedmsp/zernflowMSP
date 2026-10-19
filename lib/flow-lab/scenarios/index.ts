// Escenarios guardados del laboratorio: formato, ejecutor y utilidades.
// Todo es puro (sin servidor ni DOM): corre en el navegador y en las pruebas.

export { describeExpectation, describeProfile, describeSetup, describeStep, describeWhen, formatDuration, STATUS_LABELS } from "./describe";
export { ECOMMERCE_EXAMPLES, GYM_EXAMPLES, exampleScenariosFor } from "./examples";
export { evaluateExpectation } from "./expectations";
export { flowsFromIds, proposeExpectations, scenarioFromSession, stepFromAction, type RecordableAction, type SessionToScenarioInput } from "./from-session";
export { findByName, normalizeName, sameName } from "./names";
export { buildScenarioProfile, caseTypeByName, flowIdsByName, memberByName, resolveStep } from "./resolve";
export { runScenario, type RunScenarioOptions } from "./run";
export * from "./types";
export { cleanName, newExpectationId, parseScenarioDefinition, parseScenarioResult, type Parsed } from "./validate";
