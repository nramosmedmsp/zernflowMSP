// Motor de gestiones (docs/FASE-1-TECNICO.md 3). Solo servidor: todas las
// funciones con E/S reciben el cliente de servicio y no validan permisos (eso
// lo hacen lib/actions/cases.ts, el webhook y el cron). Lo puro vive en
// routing.ts, rules.ts, dates.ts y access.ts, con pruebas vitest.

export { assignCase, loadAssignmentContext, type AssignOutcome, type AssignmentContextCache } from "./assign";
export {
  addNote,
  assignTo,
  changeStage,
  classifyCase,
  setCategory,
  setNextAction,
  transferCase,
} from "./changes";
export { closeCase, previewClose, type CloseCaseInput, type ClosePreview } from "./close";
export { activateScheduledCases, notifyOverdueNextActions, retryUnassignedCases, runCaseTasks } from "./cron";
export {
  handleHumanOutbound,
  handleHumanOutboundForConversation,
  handleInbound,
  stampBotOutbound,
  type InboundResult,
} from "./inbound";
export { caseLink, type Db, type EngineResult, type NotificationType } from "./io";
export { openCase, type OpenCaseInput } from "./open";
export type { RuleEffects } from "./effects";
