// Tipos locales de las métricas (docs/FASE-3-TECNICO.md 3). Son independientes
// de lib/types/database.ts a propósito: parte de estos datos (actividad
// `human_reply`, eventos `message_received`, columnas `sla_*_breached_at`)
// puede no existir todavía en la base y se trata como opcional.

import type { BusinessHours } from "@/lib/business-hours";

export type MetricCaseStatus = "scheduled" | "open" | "won" | "lost" | "resolved" | "cancelled";
export type MetricOrigin = "inbound" | "proactive" | "manual";

export interface MetricCase {
  id: string;
  contact_id: string;
  case_type_id: string | null;
  stage_id: string | null;
  status: MetricCaseStatus;
  origin: MetricOrigin;
  team_id: string | null;
  assignee_id: string | null;
  outcome_reason_id: string | null;
  opened_at: string | null;
  first_response_at: string | null;
  waiting_since: string | null;
  closed_at: string | null;
  next_action_at: string | null;
  created_at: string;
  /** Tipo del contacto (puede faltar). */
  contact_type_id?: string | null;
  contact_name?: string | null;
  sla_first_response_breached_at?: string | null;
  sla_resolution_breached_at?: string | null;
}

export interface MetricActivity {
  case_id: string | null;
  type: string;
  actor_id: string | null;
  from_value: string | null;
  to_value: string | null;
  meta: unknown;
  created_at: string;
}

export interface MetricStage {
  id: string;
  case_type_id: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost" | "resolved";
}

export interface MetricCaseType {
  id: string;
  name: string;
  is_proactive: boolean;
  sla_first_response_minutes: number | null;
  sla_resolution_hours: number | null;
}

export interface MetricReason {
  id: string;
  name: string;
  case_type_id?: string;
  kind: "won" | "lost" | "resolved";
}

export interface MetricMember {
  userId: string;
  name: string;
}

export interface MetricTeam {
  id: string;
  name: string;
}

/** Mensaje entrante (analytics_events.message_received). */
export interface MetricInboundEvent {
  created_at: string;
  platform: string | null;
}

/** Horario efectivo para medir tiempos "en horario". */
export interface MetricSchedule {
  hours: BusinessHours | null;
  holidays: ReadonlySet<string>;
}

export type ScheduleResolver = (teamId: string | null) => MetricSchedule;

export type MetricPeriod = "today" | "7d" | "30d" | "90d" | "custom";

export interface MetricFilters {
  period: MetricPeriod;
  /** Día de Lima "YYYY-MM-DD" (solo con period = custom). */
  from?: string;
  to?: string;
  caseTypeId?: string;
  teamId?: string;
  assigneeId?: string;
  /** Plataforma de la conversación del contacto (whatsapp, instagram...). */
  channel?: string;
  origin?: MetricOrigin;
  contactTypeId?: string;
}

export interface MetricsInput {
  now: Date;
  cases: MetricCase[];
  activity: MetricActivity[];
  stages: MetricStage[];
  caseTypes: MetricCaseType[];
  reasons: MetricReason[];
  members: MetricMember[];
  teams: MetricTeam[];
  inbound: MetricInboundEvent[];
  /** contact_id -> plataforma de su conversación más reciente. */
  platformByContact: ReadonlyMap<string, string>;
  scheduleFor: ScheduleResolver;
  staleStageDays: number;
}

/** Resumen estadístico en segundos. */
export interface TimeStats {
  count: number;
  mean: number | null;
  median: number | null;
  p90: number | null;
}

/** Un mismo tiempo medido con reloj y en horario. */
export interface DualStats {
  clock: TimeStats;
  business: TimeStats;
}
