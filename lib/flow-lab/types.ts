// Tipos del laboratorio de conversaciones (ver README.md). Todo lo que viaja
// entre acciones es JSON: el estado se puede guardar en el navegador.

import type {
  AssignmentMode,
  BusinessHours,
  CaseRouting,
  CaseStatus,
  FlowStatus,
  MemberAvailability,
  OffHoursReplySettings,
  OutcomeKind,
  StageKind,
  TeamRole,
  WorkspaceRole,
} from "@/lib/types/database";
import type { RuleRow } from "@/lib/cases/rules";
import type { GlobalKeyword } from "@/lib/flow-engine/global-keywords";

export type LabChannel = "whatsapp" | "instagram" | "facebook";

export const LAB_CHANNELS: readonly LabChannel[] = ["whatsapp", "instagram", "facebook"];

export const LAB_CHANNEL_LABELS: Record<LabChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook Messenger",
};

// ── Catálogo (la configuración del espacio que se simula) ───────────────────

export interface LabNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface LabEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface LabFlow {
  id: string;
  name: string;
  status: FlowStatus;
  nodes: LabNode[];
  edges: LabEdge[];
}

/** Disparador derivado de los nodos del flujo con la misma función que usa la publicación (buildDesiredTriggers). */
export interface LabTrigger {
  id: string;
  flowId: string;
  type: string;
  config: unknown;
  priority: number;
  isActive: boolean;
  /** Id del nodo disparador del flujo que lo originó (para iluminarlo en el mapa). */
  nodeId?: string;
}

export interface LabStage {
  id: string;
  name: string;
  kind: StageKind;
  position: number;
}

export interface LabCategory {
  id: string;
  name: string;
  isHighPriority: boolean;
  position: number;
}

export interface LabOutcomeReason {
  id: string;
  name: string;
  kind: OutcomeKind;
  position: number;
}

export interface LabCaseType {
  id: string;
  name: string;
  position: number;
  isProactive: boolean;
  suggestedForContactTypeIds: string[];
  routing: CaseRouting;
  fixedTeamId: string | null;
  requireCategory: boolean;
  requireOutcomeReason: boolean;
  /** case_types.auto_template ({ template_name, language, params }). */
  autoTemplate: unknown;
  stages: LabStage[];
  categories: LabCategory[];
  reasons: LabOutcomeReason[];
  /** Filas de case_rules tal como están en la base (se leen con parseRule). */
  rules: RuleRow[];
}

export interface LabContactType {
  id: string;
  name: string;
  isDefault: boolean;
  position: number;
}

export interface LabTeam {
  id: string;
  name: string;
  isDefault: boolean;
  assignmentMode: AssignmentMode;
  businessHours: BusinessHours | null;
}

export interface LabMember {
  userId: string;
  name: string;
  role: WorkspaceRole;
  availability: MemberAvailability;
  lastAssignedAt: string | null;
}

export interface LabTeamMember {
  teamId: string;
  userId: string;
  role: TeamRole;
  /** null = atiende todos los tipos de gestión. */
  caseTypeIds: string[] | null;
}

export interface LabHoliday {
  date: string;
  /** null = feriado de toda la empresa. */
  teamId: string | null;
}

export interface LabCatalog {
  version: 1;
  workspaceName: string;
  flows: LabFlow[];
  triggers: LabTrigger[];
  caseTypes: LabCaseType[];
  contactTypes: LabContactType[];
  teams: LabTeam[];
  members: LabMember[];
  teamMembers: LabTeamMember[];
  /** Modo de reparto del espacio cuando no hay equipos. */
  workspaceMode: AssignmentMode;
  /** Horario de la empresa (null = 24 horas). */
  workspaceHours: BusinessHours | null;
  offHoursReply: OffHoursReplySettings | null;
  reassignAfterMinutes: number | null;
  holidays: LabHoliday[];
  globalKeywords: GlobalKeyword[];
  /** Campos personalizados definidos en el espacio. */
  customFields: { slug: string; name: string }[];
  /** Etiquetas que existen en el espacio (informativo). */
  tags: string[];
}

// ── Estado de la simulación ─────────────────────────────────────────────────

export interface LabContact {
  name: string | null;
  /** Teléfono de WhatsApp (dígitos con código de país); null = no tiene. */
  phone: string | null;
  contactTypeId: string | null;
  tags: string[];
  customFields: Record<string, string>;
  subscribed: boolean;
  ownerId: string | null;
  teamId: string | null;
  /** Fecha clave "YYYY-MM-DD" (vencimiento de membresía, última compra...). */
  keyDate: string | null;
  /**
   * ¿El contacto ya existía antes de este mensaje? El primer mensaje de un
   * contacto nuevo dispara la bienvenida (como en el webhook real).
   */
  existed: boolean;
}

export interface LabNote {
  at: string;
  body: string;
  /** null = nota del sistema (por ejemplo la del nodo Atención humana). */
  authorId: string | null;
}

export interface LabCase {
  id: string;
  caseTypeId: string | null;
  stageId: string | null;
  categoryId: string | null;
  status: CaseStatus;
  origin: "inbound" | "manual" | "proactive";
  teamId: string | null;
  assigneeId: string | null;
  assignedAt: string | null;
  scheduledFor: string | null;
  openedAt: string | null;
  createdAt: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  waitingSince: string | null;
  firstResponseAt: string | null;
  closedAt: string | null;
  /** Etapa que tenía al cerrarse (a la que vuelve si se reabre). */
  closedFromStageId: string | null;
  outcomeReasonId: string | null;
  offHoursReplySentAt: string | null;
  autoTemplateSentAt: string | null;
  noReplyEventOutboundAt: string | null;
  noReplyEventMinutes: number | null;
  /**
   * Orden de la última entrada y de la última salida (contador del laboratorio). El reloj simulado no avanza
   * entre acciones: si ambos sellos caen en el mismo instante, este orden dice cuál fue después, como las
   * milésimas de segundo en el CRM real (lo usa «cliente sin responder»).
   */
  inboundOrder?: number;
  outboundOrder?: number;
  notes: LabNote[];
}

export interface LabSession {
  id: string;
  flowId: string;
  status: "active" | "completed" | "cancelled" | "expired";
  currentNodeId: string | null;
  waitingForInput: boolean;
  waitingUntil: string | null;
  variables: Record<string, string>;
  humanTakeoverAt: string | null;
  startedAt: string;
  updatedAt: string;
}

/** Reanudación pendiente de un nodo Espera (el cron real la procesa con scheduled_jobs). */
export interface LabJob {
  id: string;
  type: "resume_flow";
  sessionId: string;
  nodeId: string;
  runAt: string;
  status: "pending" | "done" | "skipped";
}

export type LabAuthor = "client" | "bot" | "agent";

export interface LabButton {
  title: string;
  type: "postback" | "url";
  payload?: string;
  url?: string;
}

export interface LabQuickReply {
  title: string;
  payload: string;
}

export interface LabCarouselElement {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttons?: LabButton[];
}

export interface LabMessage {
  id: string;
  at: string;
  author: LabAuthor;
  /** Texto tal como lo recibe el cliente en ese canal (con opciones numeradas si el canal no admite botones). */
  text: string;
  /** "template" = plantilla de WhatsApp (ventana de 24 h cerrada o plantilla automática). */
  kind: "text" | "template";
  /** Botones y respuestas rápidas tal como se ven en el canal. */
  buttons?: LabButton[];
  quickReplies?: LabQuickReply[];
  carousel?: LabCarouselElement[];
  imageUrl?: string;
  attachment?: { type: string; url: string };
  template?: { name: string; language: string; params: string[] };
  /** Cómo se adaptó el mensaje al canal ("las opciones se enviaron como lista numerada"...). */
  adaptation?: string[];
  /** Quién lo envió: flujo y nodo (bot), o asesor. */
  flowId?: string;
  flowName?: string;
  nodeId?: string;
  authorName?: string;
  /** Solo en mensajes del cliente que pulsaron un botón o respuesta rápida. */
  payload?: string;
  /** La plantilla no se pudo enviar (motivo): el motor real deja el mensaje como fallido. */
  failed?: string;
}

export interface LabEventRecord {
  id: number;
  at: string;
  /** Ver TraceKind. */
  kind: string;
  text: string;
  flowId?: string;
  nodeId?: string;
  caseId?: string;
}

export interface LabMemberState {
  availability: MemberAvailability;
  lastAssignedAt: string | null;
}

export interface LabState {
  version: 1;
  /** Reloj simulado (ISO). */
  clock: string;
  channel: LabChannel;
  /** Flujos activos en la simulación: null = todos los publicados; si no, los elegidos (también borradores). */
  enabledFlowIds: string[] | null;
  contact: LabContact;
  cases: LabCase[];
  sessions: LabSession[];
  jobs: LabJob[];
  messages: LabMessage[];
  /** Automatización de la conversación en pausa (la pausa un asesor o el nodo Atención humana). */
  automationPaused: boolean;
  /** Disponibilidad y último reparto de cada miembro. */
  members: Record<string, LabMemberState>;
  /** Registro de eventos (los últimos MAX_EVENTS). */
  events: LabEventRecord[];
  /** Contadores para ids estables. */
  counters: { case: number; session: number; job: number; message: number; event: number; seq: number; order?: number };
}

// ── Entrada de las acciones ─────────────────────────────────────────────────

export type ClientInput =
  | { kind: "text"; text: string }
  | {
      kind: "button";
      /** Carga (payload) del botón o respuesta rápida pulsada. */
      payload: string;
      /** Texto del botón: es lo que llega como mensaje. */
      title?: string;
      /** postback (botón) o quick_reply (respuesta rápida). Por defecto postback. */
      buttonType?: "postback" | "quick_reply";
    };

export interface LabOptions {
  /** Número entre 0 y 1 para las pruebas A/B (por defecto Math.random). */
  random?: () => number;
  /** Respuesta que devolvería cada nodo Solicitud HTTP (por id de nodo); sin ella no se hace la solicitud. */
  httpResponses?: Record<string, unknown>;
}

export interface CloseCaseInput {
  /** Resultado: ganada, perdida o resuelta (usa la primera etapa de cierre de esa clase). */
  kind?: OutcomeKind;
  /** Etapa de cierre concreta (en vez de kind). */
  stageId?: string;
  outcomeReasonId?: string | null;
  /** undefined = conservar la categoría actual. */
  categoryId?: string | null;
  note?: string | null;
  /** Fecha clave "YYYY-MM-DD" si una regla la pide (vencimiento de membresía). */
  keyDate?: string | null;
  /** Fecha de la gestión programada que elige el asesor, o no programar nada. */
  scheduleOverride?: { scheduleAt?: string | null; skip?: boolean };
  /** Gestión a cerrar (por defecto la abierta más reciente). */
  caseId?: string;
}

// ── Traza ───────────────────────────────────────────────────────────────────

export type TraceKind =
  | "info"
  | "warning"
  | "error"
  | "client_message"
  | "agent_message"
  | "case_opened"
  | "case_reused"
  | "case_reopened"
  | "case_classified"
  | "case_stage_changed"
  | "case_assigned"
  | "case_unassigned"
  | "case_team_changed"
  | "case_category_changed"
  | "case_closed"
  | "case_scheduled"
  | "case_activated"
  | "case_note"
  | "contact_changed"
  | "rule_applied"
  | "bot_paused"
  | "bot_resumed"
  | "global_keyword"
  | "trigger_evaluation"
  | "flow_started"
  | "flow_completed"
  | "flow_waiting"
  | "flow_resumed"
  | "flow_cancelled"
  | "node"
  | "condition"
  | "variable_set"
  | "tag_changed"
  | "custom_field_set"
  | "subscription_changed"
  | "message_sent"
  | "message_skipped"
  | "case_event"
  | "off_hours_reply"
  | "auto_template"
  | "time_advanced"
  | "window_closed"
  | "session_expired";

export interface TraceStep {
  /** Orden dentro de la traza (1, 2, 3...). */
  n: number;
  /** Reloj simulado cuando ocurrió. */
  at: string;
  kind: TraceKind;
  level: "info" | "ok" | "warning" | "error";
  /** Frase en español para mostrar tal cual. */
  text: string;
  flowId?: string;
  flowName?: string;
  /** Nodo del flujo (para iluminarlo en el mapa). */
  nodeId?: string;
  nodeLabel?: string;
  caseId?: string;
  messageId?: string;
  /** Detalle propio de cada tipo (ver README.md). */
  data?: Record<string, unknown>;
}

export interface TriggerCandidateTrace {
  triggerId: string;
  flowId: string;
  flowName: string;
  type: string;
  /** Cómo se lee el disparador ("palabras clave: precio, catálogo"). */
  description: string;
  /** El disparador elegido, o el motivo por el que no coincidió. */
  outcome: "matched" | "not_matched";
  why: string;
  nodeId?: string;
}

export interface LabTrace {
  /** Acción que se ejecutó. */
  action: string;
  /** Frase en español de lo que se hizo ("El cliente escribe: «hola»"). */
  title: string;
  startedAt: string;
  endedAt: string;
  steps: TraceStep[];
  /** Nodos recorridos en orden (flujo y nodo), para iluminarlos en el mapa. */
  visited: { flowId: string; nodeId: string; step: number }[];
  /** Mensajes que se generaron en esta acción (del bot, del asesor o el del cliente). */
  messages: LabMessage[];
  /** Avisos: lo que la simulación no pudo hacer o hizo distinto. */
  warnings: string[];
  /** Si la acción no se pudo aplicar (el estado queda igual). */
  error?: string;
}

export interface LabResult {
  state: LabState;
  trace: LabTrace;
}

export const MAX_EVENTS = 1000;

export interface LabProfile {
  id: string;
  name: string;
  description: string;
  contact: LabContact;
  /** Gestiones iniciales (vacío = el contacto aún no tiene ninguna). */
  cases: LabCase[];
  /** Mensajes previos de la conversación. */
  messages: LabMessage[];
  /** Reloj sugerido (ISO), si el perfil depende de una fecha. */
  clock?: string;
  /** Lo que no se encontró en el catálogo al armar el perfil. */
  notices: string[];
}
