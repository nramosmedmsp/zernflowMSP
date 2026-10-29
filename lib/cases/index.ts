// Motor de gestiones (docs/FASE-1-TECNICO.md 3 y FASE-2-TECNICO.md 3). Solo
// servidor: todas las funciones con E/S reciben el cliente de servicio y no
// validan permisos (eso lo hacen lib/actions/cases.ts, el webhook y el cron).
// Lo puro vive en routing.ts, rules.ts, dates.ts, access.ts y
// lib/business-hours.ts, con pruebas vitest.

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
export { setConversationBotPaused } from "./bot-pause";
export { closeCase, previewClose, type CloseCaseInput, type ClosePreview } from "./close";
export {
  activateScheduledCases,
  notifyCommitmentsOverdue,
  notifyOverdueNextActions,
  notifySlaBreaches,
  notifySolutionDeadlines,
  retryUnassignedCases,
  runCaseTasks,
  type CaseTaskStats,
} from "./cron";
export {
  handleHumanOutbound,
  handleHumanOutboundForConversation,
  handleInbound,
  stampBotOutbound,
  type InboundResult,
} from "./inbound";
export { caseLink, type Db, type EngineResult, type NotificationType } from "./io";
export {
  PARALLEL_CONFIRM_MESSAGE,
  PAST_SCHEDULE_MESSAGE,
  SAME_TYPE_OPEN_MESSAGE,
  listActiveCases,
  openCase,
  parallelOpeningError,
  type OpenCaseInput,
  type OpenCaseSummary,
} from "./open";
export { allowsSameTypeParallel, sameTypeConfirmMessage } from "./parallel";
export type { RuleEffects } from "./effects";
// Fase 2
export {
  buildAutoTemplateParams,
  formatKeyDate,
  parseAutoTemplate,
  sendAutoTemplate,
  type AutoTemplateOutcome,
} from "./auto-template";
export { emitCaseEvent } from "./events";
export { isOpenAt, nextOpeningFor, scheduleForTeam, type HoursInfo } from "./hours";
export { scheduleCasesForKeyDate, type KeyDateScheduleResult } from "./key-date";
export { zernioMessenger, type CaseMessenger, type SendResult } from "./messaging";
export { detectClientNoReply, nextNoReplyThreshold, noReplyMinutes } from "./no-reply";
export { renderOffHoursReply, sendOffHoursReply, type OffHoursReplyOutcome } from "./off-hours";
export { reassignWaitingCases } from "./reassign";
// Control de reclamos
export {
  alertUnhandledComplaints,
  dismissComplaint,
  flagComplaint,
  openComplaintCase,
  protectedTypes,
  type FlagOutcome,
} from "./complaint";
export {
  approveCloseRequest,
  closeOrRequestClose,
  registerSolutionInProgress,
  rejectCloseRequest,
  type CloseOrRequestResult,
} from "./protected";
export { isSupervisorInDb, notifySupervisors, supervisorRecipients } from "./supervisors";
