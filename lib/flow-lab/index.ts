// Laboratorio de conversaciones: simula una conversación completa como la
// viviría el sistema real, sin escribir en la base ni enviar mensajes.
// Ver README.md para la API.
//
// Este índice no exporta loadLabCatalog (solo servidor): impórtalo de
// "@/lib/flow-lab/load-catalog". Tampoco buildCatalogFromTemplates (pruebas y
// desarrollo): "@/lib/flow-lab/from-templates".

export {
  advanceTime,
  agentReplies,
  assign,
  changeStage,
  classify,
  clientSays,
  closeCase,
  previewClose,
  setBotPaused,
  setCategory,
  setChannel,
  setContact,
  setEnabledFlows,
  setMemberAvailability,
} from "./actions";
export {
  activeFlowIds,
  activeTriggers,
  deriveTriggers,
  describeTrigger,
  indexCatalog,
  normalizeCatalog,
} from "./catalog";
export type { LabClosePreview } from "./cases";
export { buildSampleProfiles } from "./profiles";
export { cloneState, createLabState, currentCase, emptyContact, lastInboundAt } from "./state";
export * from "./types";
