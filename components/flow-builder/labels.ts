// Etiquetas en español para valores internos que se muestran al usuario.
// Los valores guardados (claves del mapa) no cambian.

const UNIT_LABELS: Record<string, string> = {
  seconds: "segundos",
  minutes: "minutos",
  hours: "horas",
  days: "días",
};

/** Unidad de tiempo interna ("minutes") -> etiqueta en español ("minutos"). */
export function unitLabel(unit: string): string {
  return UNIT_LABELS[unit] ?? unit;
}

const FLOW_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  published: "Publicado",
  archived: "Archivado",
};

/** Estado interno del flujo ("draft") -> etiqueta en español ("Borrador"). */
export function flowStatusLabel(status: string): string {
  return FLOW_STATUS_LABELS[status] ?? status;
}

const SEQUENCE_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  active: "Activa",
  paused: "Pausada",
  archived: "Archivada",
};

/** Estado interno de una secuencia ("active") -> etiqueta en español ("Activa"). */
export function sequenceStatusLabel(status: string): string {
  return SEQUENCE_STATUS_LABELS[status] ?? status;
}

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  keyword: "Palabra clave",
  postback: "Botón (postback)",
  quick_reply: "Respuesta rápida",
  welcome: "Bienvenida",
  default: "Por defecto",
  comment_keyword: "Palabra clave en comentario",
  case_opened: "Gestión nueva",
  case_stage_changed: "Cambio de etapa",
  case_closed: "Gestión cerrada",
  client_no_reply: "Cliente sin responder",
};

/** Tipo de disparador interno ("quick_reply") -> etiqueta en español. */
export function triggerTypeLabel(type: string): string {
  return TRIGGER_TYPE_LABELS[type] ?? type;
}

const NODE_TYPE_LABELS: Record<string, string> = {
  trigger: "Disparador",
  sendMessage: "Enviar mensaje",
  condition: "Condición",
  delay: "Espera",
  aiResponse: "Respuesta con IA",
  action: "Acción",
  addTag: "Agregar etiqueta",
  removeTag: "Quitar etiqueta",
  setCustomField: "Asignar campo personalizado",
  httpRequest: "Solicitud HTTP",
  goToFlow: "Ir a flujo",
  humanTakeover: "Atención humana",
  subscribe: "Suscribir",
  unsubscribe: "Desuscribir",
  commentReply: "Responder comentario",
  privateReply: "Respuesta privada",
  abSplit: "Prueba A/B",
  smartDelay: "Espera inteligente",
  enrollSequence: "Inscribir en secuencia",
  classifyCase: "Clasificar gestión",
  changeStage: "Cambiar etapa",
  assignTeam: "Asignar a equipo",
  distributeCase: "Repartir a asesor",
  end: "Fin",
  unknown: "Desconocido",
};

/**
 * El simulador (lib/flow-engine/simulator.ts) usa el tipo interno del nodo o
 * "Trigger"/"End" como nombre cuando el nodo no tiene uno propio; aquí se
 * muestra en español. Los nombres escritos por el usuario no se tocan.
 */
export function simulatorNodeLabel(label: string): string {
  if (label === "Trigger") return NODE_TYPE_LABELS.trigger;
  if (label === "End") return NODE_TYPE_LABELS.end;
  if (label === "Unknown") return NODE_TYPE_LABELS.unknown;
  return NODE_TYPE_LABELS[label] ?? label;
}
