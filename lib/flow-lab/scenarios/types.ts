// Formato de un escenario guardado del laboratorio: una conversación de prueba
// (pasos) con lo que debe cumplirse (expectativas). Todo es JSON y se refiere a
// tipos de gestión, etapas, motivos, categorías, equipos, miembros y flujos
// POR NOMBRE, para que el escenario sobreviva a un cambio de ids (otro espacio,
// un tipo de gestión recreado...).

import type { BusinessTemplate, OutcomeKind } from "@/lib/types/database";
import type { LabChannel, LabState, LabTrace } from "../types";

export const SCENARIO_VERSION = 1 as const;

// ── Perfil inicial ──────────────────────────────────────────────────────────

export type ScenarioProfile =
  /** Uno de los perfiles de ejemplo del laboratorio, por su nombre ("Prospecto nuevo"). */
  | { kind: "sample"; name: string }
  /** Contacto armado a mano. */
  | {
      kind: "custom";
      name: string;
      /** Tipo de contacto por nombre (null = sin tipo). */
      contactType: string | null;
      tags: string[];
      /** ¿Ya existe como contacto? (si no, su primer mensaje dispara la bienvenida) */
      existed: boolean;
      /** Gestión inicial abierta: tipo y etapa por nombre. */
      caseType: string | null;
      stage: string | null;
      /** Escribió hace menos de 24 h (ventana de WhatsApp abierta). */
      recentInbound: boolean;
    };

// ── Pasos (las acciones del simulador) ──────────────────────────────────────

export type ScenarioStep =
  | { type: "client_text"; text: string }
  /** El cliente pulsa un botón o una respuesta rápida. */
  | { type: "client_button"; title: string; payload: string; buttonType?: "postback" | "quick_reply" }
  | { type: "advance"; minutes: number }
  | { type: "agent_reply"; text: string; agent?: string | null }
  /** Etapa de la gestión abierta (por nombre; `caseType` solo si el nombre se repite entre tipos). */
  | { type: "change_stage"; stage: string; caseType?: string }
  | { type: "classify"; caseType: string }
  | { type: "set_category"; category: string | null }
  | { type: "assign"; member: string | null }
  | {
      type: "close";
      /** Resultado (usa la primera etapa de cierre de esa clase) o una etapa de cierre por nombre. */
      outcome?: OutcomeKind;
      stage?: string;
      reason?: string | null;
      category?: string | null;
      /** Fecha clave "YYYY-MM-DD" si una regla la pide. */
      keyDate?: string | null;
      note?: string | null;
      /** No programar la próxima gestión. */
      skipSchedule?: boolean;
    }
  | { type: "pause_bot"; paused: boolean };

export type ScenarioStepType = ScenarioStep["type"];

export const STEP_TYPES: readonly ScenarioStepType[] = [
  "client_text",
  "client_button",
  "advance",
  "agent_reply",
  "change_stage",
  "classify",
  "set_category",
  "assign",
  "close",
  "pause_bot",
];

// ── Expectativas ────────────────────────────────────────────────────────────

export type ExpectedCaseStatus = "open" | "won" | "lost" | "resolved" | "scheduled";

export const EXPECTED_STATUSES: readonly ExpectedCaseStatus[] = ["open", "won", "lost", "resolved", "scheduled"];

/** Dónde se busca un flujo o un mensaje: en toda la conversación hasta ese punto, o solo en lo que provocó el paso. */
export type ExpectationScope = "conversation" | "step";

export type ExpectationCheck =
  /** Se activó el flujo (hay una sesión suya; con `scope: "step"`, arrancó en ese paso). */
  | { kind: "flow_activated"; flow: string; scope?: ExpectationScope }
  /** Algún mensaje del bot (o plantilla) contiene el texto (sin importar mayúsculas ni tildes). */
  | { kind: "bot_message_contains"; text: string; scope?: ExpectationScope }
  /** Se envió una plantilla de WhatsApp (de ese nombre, si se indica). */
  | { kind: "template_sent"; name?: string; scope?: ExpectationScope }
  /** Tipo de la gestión actual. */
  | { kind: "case_type"; caseType: string }
  /** `of` = tipo de la gestión a mirar (la última de ese tipo); sin él, la gestión actual. */
  | { kind: "case_stage"; stage: string; of?: string }
  | { kind: "case_status"; status: ExpectedCaseStatus; of?: string }
  | { kind: "assigned"; assigned: boolean; member?: string; of?: string }
  | { kind: "case_team"; team: string; of?: string }
  | { kind: "tag"; tag: string; present: boolean }
  | { kind: "contact_type"; contactType: string }
  | { kind: "custom_field"; field: string; value: string }
  | { kind: "subscribed"; subscribed: boolean }
  /** Hay una gestión programada del tipo, para dentro de `inDays` días (fecha de Lima respecto del reloj de ese momento). */
  | { kind: "scheduled_case"; caseType: string; inDays: number }
  | { kind: "bot_paused"; paused: boolean }
  /** El paso no envió ningún mensaje del bot. */
  | { kind: "nothing_sent" };

export type ExpectationKind = ExpectationCheck["kind"];

export const EXPECTATION_KINDS: readonly ExpectationKind[] = [
  "flow_activated",
  "bot_message_contains",
  "template_sent",
  "case_type",
  "case_stage",
  "case_status",
  "assigned",
  "case_team",
  "tag",
  "contact_type",
  "custom_field",
  "subscribed",
  "scheduled_case",
  "bot_paused",
  "nothing_sent",
];

export type ScenarioExpectation = {
  /** Identificador estable dentro del escenario. */
  id: string;
  /** Número de paso (1 = el primero) tras el cual se comprueba; null o ausente = al final. */
  after?: number | null;
} & ExpectationCheck;

// ── Escenario ───────────────────────────────────────────────────────────────

export interface ScenarioDefinition {
  version: typeof SCENARIO_VERSION;
  /** Negocio para el que se escribió (informativo). */
  business: BusinessTemplate | null;
  profile: ScenarioProfile;
  channel: LabChannel;
  /** "published" = todos los publicados; si no, los flujos elegidos (por nombre, también borradores). */
  flows: "published" | string[];
  /** Reloj inicial (ISO). Sin él, la hora actual. */
  startAt?: string | null;
  steps: ScenarioStep[];
  expectations: ScenarioExpectation[];
}

/** Escenario con nombre y descripción (lo que se guarda y lo que traen los de ejemplo). */
export interface NamedScenario {
  name: string;
  description: string;
  definition: ScenarioDefinition;
}

// ── Resultado ───────────────────────────────────────────────────────────────

export interface ExpectationResult {
  id: string;
  /** Frase de la expectativa ("El flujo «X» se activó"). */
  description: string;
  after: number | null;
  ok: boolean;
  expected: string;
  actual: string;
}

export interface StepError {
  /** Número de paso (1 = el primero); 0 = no se pudo armar el punto de partida. */
  step: number;
  /** Frase del paso. */
  text: string;
  message: string;
}

/** Lo que se guarda en `lab_scenarios.last_result` (sin trazas). */
export interface ScenarioResult {
  ok: boolean;
  ranAt: string;
  total: number;
  passed: number;
  failed: number;
  /** El escenario se detuvo en un paso que no se pudo aplicar (o en el punto de partida). */
  stepError: StepError | null;
  expectations: ExpectationResult[];
}

export interface ScenarioRun {
  result: ScenarioResult;
  /** Una traza por paso ejecutado. */
  traces: LabTrace[];
  /** Estado de partida (null si no se pudo armar). */
  initialState: LabState | null;
  /** Estado después de cada paso ejecutado. */
  states: LabState[];
  finalState: LabState | null;
}
