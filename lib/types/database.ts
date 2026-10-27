import type { Platform } from "@/lib/platforms";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type { Platform };

export type FlowStatus = "draft" | "published" | "archived";
export type ConversationStatus = "open" | "closed" | "snoozed";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export type MessageMediaKind = "image" | "video" | "audio" | "file" | "sticker";
export type MessageMediaStatus = "stored" | "too_large" | "failed" | "expired";
export type BroadcastStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "completed"
  | "cancelled";
export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type TriggerType =
  | "keyword"
  | "postback"
  | "quick_reply"
  | "welcome"
  | "default"
  | "comment_keyword"
  // Fase 2 (00021) y 00022: eventos de gestión (lib/flow-engine/case-triggers.ts).
  | "case_opened"
  | "case_stage_changed"
  | "case_closed"
  | "client_no_reply";

/**
 * triggers.config de los disparadores de gestión (fase 2). Todas las claves
 * son opcionales: sin ellas el disparador aplica a cualquier tipo o etapa.
 */
export interface CaseTriggerConfig {
  case_type_id?: string;
  stage_id?: string;
  outcome?: "won" | "lost" | "resolved";
  /** client_no_reply: minutos sin respuesta del cliente (por defecto 60). */
  minutes?: number;
  /** case_opened: solo gestiones que quedaron sin tipo de gestión. */
  only_unclassified?: boolean;
  /** case_opened: solo si el cliente es de alguno de estos tipos de contacto. */
  contact_type_ids?: string[];
}
export type FlowSessionStatus =
  | "active"
  | "completed"
  | "expired"
  | "cancelled";
export type NodeType =
  | "trigger"
  | "sendMessage"
  | "condition"
  | "delay"
  | "addTag"
  | "removeTag"
  | "setCustomField"
  | "httpRequest"
  | "goToFlow"
  | "subscribe"
  | "unsubscribe"
  | "humanTakeover"
  | "commentReply"
  | "privateReply"
  | "abSplit"
  | "smartDelay"
  | "aiResponse"
  | "enrollSequence";

export type SequenceStatus = "draft" | "active" | "paused";
export type SequenceEnrollmentStatus = "active" | "completed" | "cancelled";

export interface SequenceStep {
  type: "message" | "delay" | "template";
  /** Message text (for message steps) */
  content?: string;
  /** Delay in minutes (for delay steps) */
  delayMinutes?: number;
  /**
   * Fase 2: en un paso 'template', la plantilla a enviar; en un paso
   * 'message', la plantilla alternativa si la ventana de 24 h está cerrada.
   */
  template?: TemplateMessageContent | null;
}

// ── Fase 2 (00021): plantillas en envíos automáticos ─────────────────────

/**
 * Plantilla de WhatsApp como contenido de una difusión o de un paso de
 * secuencia. `params` son los valores en el orden de la plantilla
 * (encabezado, cuerpo, botones) y admiten variables: {nombre}, {empresa},
 * {fecha_clave}, {campo:slug}...
 */
export interface TemplateMessageContent {
  kind: "template";
  template_name: string;
  language: string;
  params: string[];
}

/** Texto libre (formato de la fase 1; `kind` puede faltar). */
export interface TextMessageContent {
  kind?: "text";
  text: string;
}

/** broadcasts.message_content */
export type BroadcastMessageContent = TextMessageContent | TemplateMessageContent;

/**
 * case_types.auto_template: plantilla que se envía al activarse una gestión
 * proactiva (Recompra, Renovación). Variables en `params`: {nombre},
 * {fecha_clave}, {empresa}, {sede}, {asesor} y {campo:slug}.
 */
export interface CaseTypeAutoTemplate {
  template_name: string;
  language: string;
  params: string[];
}

// ── Fase 1 (00019): roles, equipos y gestiones ───────────────────────────

/** Rol en el espacio (workspace_members.role). */
export type WorkspaceRole = "owner" | "admin" | "member";
/** workspace_members.availability */
export type MemberAvailability = "available" | "away";
/** Rol dentro de un equipo (team_members.role). */
export type TeamRole = "supervisor" | "agent";
/** Qué ve un asesor (workspaces.settings.agent_visibility). */
export type AgentVisibility = "own" | "own_and_unassigned" | "team";
/** Modo de reparto (teams.assignment_mode y workspaces.settings.assignment_mode). */
export type AssignmentMode = "round_robin" | "least_load" | "manual";
export type BusinessTemplate = "ecommerce" | "gym" | "general" | "blank";

/** Contenido de workspaces.settings (todas las claves son opcionales). */
export interface WorkspaceSettings {
  /** Por defecto 'own'. */
  agent_visibility?: AgentVisibility;
  /** Solo si el espacio no tiene equipos. Por defecto 'round_robin'. */
  assignment_mode?: AssignmentMode;
  business_template?: BusinessTemplate;
  /** "Última compra", "Vencimiento de membresía"... */
  key_date_label?: string;
  /**
   * Un asesor puede devolver a la cola (dejar sin responsable) sus propias
   * gestiones. Por defecto false: solo supervisores y administradores.
   */
  agent_can_return_to_queue?: boolean;
  /** Fase 2: horario de la empresa (y de los equipos sin horario propio). Sin él = 24 horas. */
  business_hours?: BusinessHours | null;
  /** Fase 2: respuesta automática a mensajes que llegan fuera de horario. */
  off_hours_reply?: OffHoursReplySettings | null;
  /** Fase 2: minutos hábiles de espera antes de reasignar (null = desactivada). */
  reassign_after_minutes?: number | null;
}

// ── Fase 2 (00021): horarios ─────────────────────────────────────────────

/** Días de business_hours (claves en inglés, como en la base). */
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/**
 * Tramo de atención en hora de Lima: ["09:00", "13:00"]. El fin puede ser
 * "24:00"; si es menor que el inicio, el tramo cruza la medianoche
 * (["22:00", "02:00"] termina a las 2:00 del día siguiente).
 */
export type TimeRange = [string, string];

/**
 * teams.business_hours y workspaces.settings.business_hours:
 * { "mon": [["09:00","13:00"],["14:00","19:00"]], ..., "sun": [] }.
 * Un día ausente o vacío está cerrado. null (o sin ningún tramo) = 24 horas.
 * Para leerlo de la base usa parseBusinessHours (lib/business-hours.ts).
 */
export type BusinessHours = { [day in Weekday]?: TimeRange[] };

/** workspaces.settings.off_hours_reply (leer con parseOffHoursReply). */
export interface OffHoursReplySettings {
  enabled: boolean;
  /** Texto con variables {nombre}, {empresa}, {sede} y {apertura}. */
  text: string;
  /** Horas mínimas para repetirla en la misma gestión (null = una sola vez por gestión). */
  min_hours_between: number | null;
}

/** case_types.routing */
export type CaseRouting = "contact_owner" | "contact_team" | "fixed_team";
/** case_stages.kind */
export type StageKind = "open" | "won" | "lost" | "resolved";
/** case_outcome_reasons.kind (y clase de una etapa final). */
export type OutcomeKind = "won" | "lost" | "resolved";
/** cases.status */
export type CaseStatus = "scheduled" | "open" | "won" | "lost" | "resolved" | "cancelled";
/** Estados no cerrados de una gestión. */
export type ActiveCaseStatus = Extract<CaseStatus, "scheduled" | "open">;
/** Estados cerrados de una gestión. */
export type ClosedCaseStatus = Exclude<CaseStatus, ActiveCaseStatus>;
/** cases.origin */
export type CaseOrigin = "inbound" | "proactive" | "manual";
/** cases.priority */
export type CasePriority = "low" | "normal" | "high" | "urgent";
/** case_rules.trigger */
export type CaseRuleTrigger = "on_open" | "on_stage" | "on_won" | "on_lost" | "on_resolved";
/** case_rules.action */
export type CaseRuleAction = "set_contact_type" | "schedule_case" | "ask_key_date";

/** case_rules.condition */
export interface CaseRuleCondition {
  category_id?: string;
  outcome_reason_id?: string;
  contact_type_id?: string;
}

/** case_rules.params según la acción (docs/FASE-1-TECNICO.md 3.4). */
export interface SetContactTypeParams {
  contact_type_id: string;
  /** Desde la N-ésima gestión ganada del contacto (Cliente frecuente). */
  from_nth_win?: number;
}
export interface ScheduleCaseParams {
  case_type_id: string;
  days_after?: number;
  days_before_key_date?: number;
}
export interface AskKeyDateParams {
  label: string;
}
export type CaseRuleParams = SetContactTypeParams | ScheduleCaseParams | AskKeyDateParams;

/** saved_replies.scope */
export type SavedReplyScope = "workspace" | "team" | "personal";

/** activity.type */
export type ActivityType =
  | "case_opened"
  | "case_scheduled"
  | "case_activated"
  | "case_classified"
  | "stage_changed"
  | "assigned"
  | "unassigned"
  | "transferred"
  | "case_closed"
  | "case_reopened"
  | "contact_type_changed"
  | "owner_changed"
  | "team_changed"
  | "note_added"
  | "first_response"
  | "next_action_set"
  | "automation_paused"
  | "automation_resumed"
  | "config_changed"
  // Fase 2 (00021)
  | "off_hours_reply_sent"
  | "auto_template_sent"
  | "auto_template_failed"
  | "auto_template_skipped"
  | "contacts_imported"
  | "sequence_step_failed"
  // Fase 3 (00024)
  | "human_reply"
  | "sla_breached";

export interface Database {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          /** Obsoleta: vacía desde 00019 (constraint). Usa lib/workspace-secrets.ts. */
          late_api_key_encrypted: string | null;
          /** Obsoleta: vacía desde 00019 (constraint). Usa lib/workspace-secrets.ts. */
          ai_api_key: string | null;
          /** Obsoleta: vacía desde 00019 (constraint). Usa lib/workspace-secrets.ts. */
          webhook_secret: string | null;
          ai_provider: string;
          global_keywords: Json | null;
          /** Ver WorkspaceSettings. */
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          late_api_key_encrypted?: null;
          ai_api_key?: null;
          webhook_secret?: null;
          ai_provider?: string;
          global_keywords?: Json | null;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          late_api_key_encrypted?: null;
          ai_api_key?: null;
          webhook_secret?: null;
          ai_provider?: string;
          global_keywords?: Json | null;
          settings?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspace_secrets: {
        Row: {
          workspace_id: string;
          late_api_key: string | null;
          ai_api_key: string | null;
          webhook_secret: string | null;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          late_api_key?: string | null;
          ai_api_key?: string | null;
          webhook_secret?: string | null;
          updated_at?: string;
        };
        Update: {
          late_api_key?: string | null;
          ai_api_key?: string | null;
          webhook_secret?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_secrets_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: WorkspaceRole;
          availability: MemberAvailability;
          last_assigned_at: string | null;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: WorkspaceRole;
          availability?: MemberAvailability;
          last_assigned_at?: string | null;
          created_at?: string;
        };
        Update: {
          role?: WorkspaceRole;
          availability?: MemberAvailability;
          last_assigned_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      channels: {
        Row: {
          id: string;
          workspace_id: string;
          platform: Platform;
          late_account_id: string;
          username: string | null;
          display_name: string | null;
          profile_picture: string | null;
          webhook_id: string | null;
          webhook_secret: string | null;
          is_active: boolean;
          last_comment_cursor: string | null;
          comment_rules: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          platform: Platform;
          late_account_id: string;
          username?: string | null;
          display_name?: string | null;
          profile_picture?: string | null;
          webhook_id?: string | null;
          webhook_secret?: string | null;
          is_active?: boolean;
          last_comment_cursor?: string | null;
          comment_rules?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          platform?: Platform;
          late_account_id?: string;
          username?: string | null;
          display_name?: string | null;
          profile_picture?: string | null;
          webhook_id?: string | null;
          webhook_secret?: string | null;
          is_active?: boolean;
          last_comment_cursor?: string | null;
          comment_rules?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "channels_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contacts: {
        Row: {
          id: string;
          workspace_id: string;
          display_name: string | null;
          email: string | null;
          avatar_url: string | null;
          is_subscribed: boolean;
          last_interaction_at: string | null;
          metadata: Json | null;
          contact_type_id: string | null;
          team_id: string | null;
          owner_id: string | null;
          source: Json;
          phone: string | null;
          /** Fecha clave (YYYY-MM-DD): última compra, vencimiento de membresía... */
          key_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          display_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          is_subscribed?: boolean;
          last_interaction_at?: string | null;
          metadata?: Json | null;
          contact_type_id?: string | null;
          team_id?: string | null;
          owner_id?: string | null;
          source?: Json;
          phone?: string | null;
          key_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          is_subscribed?: boolean;
          last_interaction_at?: string | null;
          metadata?: Json | null;
          contact_type_id?: string | null;
          team_id?: string | null;
          owner_id?: string | null;
          source?: Json;
          phone?: string | null;
          key_date?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contacts_contact_type_id_fkey";
            columns: ["contact_type_id"];
            isOneToOne: false;
            referencedRelation: "contact_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contacts_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_channels: {
        Row: {
          id: string;
          contact_id: string;
          channel_id: string;
          platform_sender_id: string;
          platform_username: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          channel_id: string;
          platform_sender_id: string;
          platform_username?: string | null;
          created_at?: string;
        };
        Update: {
          platform_username?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contact_channels_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_channels_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      tags: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          color?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          color?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tags_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_tags: {
        Row: {
          contact_id: string;
          tag_id: string;
          created_at: string;
        };
        Insert: {
          contact_id: string;
          tag_id: string;
          created_at?: string;
        };
        Update: {
          contact_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      custom_field_definitions: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          slug: string;
          type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          slug: string;
          type: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          slug?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "custom_field_definitions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_custom_fields: {
        Row: {
          contact_id: string;
          field_id: string;
          value: string;
          updated_at: string;
        };
        Insert: {
          contact_id: string;
          field_id: string;
          value: string;
          updated_at?: string;
        };
        Update: {
          value?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contact_custom_fields_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_custom_fields_field_id_fkey";
            columns: ["field_id"];
            isOneToOne: false;
            referencedRelation: "custom_field_definitions";
            referencedColumns: ["id"];
          },
        ];
      };
      flow_versions: {
        Row: {
          id: string;
          flow_id: string;
          version: number;
          nodes: Json;
          edges: Json;
          viewport: Json | null;
          name: string;
          published_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          flow_id: string;
          version: number;
          nodes: Json;
          edges: Json;
          viewport?: Json | null;
          name: string;
          published_by?: string | null;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "flow_versions_flow_id_fkey";
            columns: ["flow_id"];
            isOneToOne: false;
            referencedRelation: "flows";
            referencedColumns: ["id"];
          },
        ];
      };
      flows: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          status: FlowStatus;
          nodes: Json;
          edges: Json;
          viewport: Json | null;
          version: number;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          status?: FlowStatus;
          nodes?: Json;
          edges?: Json;
          viewport?: Json | null;
          version?: number;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          status?: FlowStatus;
          nodes?: Json;
          edges?: Json;
          viewport?: Json | null;
          version?: number;
          published_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "flows_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      triggers: {
        Row: {
          id: string;
          flow_id: string;
          channel_id: string | null;
          type: TriggerType;
          config: Json;
          priority: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          flow_id: string;
          channel_id?: string | null;
          type: TriggerType;
          config?: Json;
          priority?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          channel_id?: string | null;
          type?: TriggerType;
          config?: Json;
          priority?: number;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "triggers_flow_id_fkey";
            columns: ["flow_id"];
            isOneToOne: false;
            referencedRelation: "flows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "triggers_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      flow_sessions: {
        Row: {
          id: string;
          contact_id: string;
          flow_id: string;
          channel_id: string;
          status: FlowSessionStatus;
          current_node_id: string | null;
          variables: Json;
          flow_stack: Json;
          waiting_until: string | null;
          waiting_for_input: boolean;
          human_takeover_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          flow_id: string;
          channel_id: string;
          status?: FlowSessionStatus;
          current_node_id?: string | null;
          variables?: Json;
          flow_stack?: Json;
          waiting_until?: string | null;
          waiting_for_input?: boolean;
          human_takeover_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: FlowSessionStatus;
          current_node_id?: string | null;
          variables?: Json;
          flow_stack?: Json;
          waiting_until?: string | null;
          waiting_for_input?: boolean;
          human_takeover_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "flow_sessions_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "flow_sessions_flow_id_fkey";
            columns: ["flow_id"];
            isOneToOne: false;
            referencedRelation: "flows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "flow_sessions_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          workspace_id: string;
          channel_id: string;
          contact_id: string;
          late_conversation_id: string | null;
          platform: Platform;
          status: ConversationStatus;
          assigned_to: string | null;
          last_message_at: string | null;
          last_message_preview: string | null;
          unread_count: number;
          is_automation_paused: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          channel_id: string;
          contact_id: string;
          late_conversation_id?: string | null;
          platform: Platform;
          status?: ConversationStatus;
          assigned_to?: string | null;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          unread_count?: number;
          is_automation_paused?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          late_conversation_id?: string | null;
          status?: ConversationStatus;
          assigned_to?: string | null;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          unread_count?: number;
          is_automation_paused?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      message_media: {
        Row: {
          id: string;
          workspace_id: string;
          conversation_id: string;
          platform_message_id: string;
          attachment_index: number;
          direction: MessageDirection;
          kind: MessageMediaKind;
          storage_path: string | null;
          mime_type: string | null;
          file_name: string | null;
          size_bytes: number | null;
          status: MessageMediaStatus;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          conversation_id: string;
          platform_message_id: string;
          attachment_index?: number;
          direction: MessageDirection;
          kind: MessageMediaKind;
          storage_path?: string | null;
          mime_type?: string | null;
          file_name?: string | null;
          size_bytes?: number | null;
          status?: MessageMediaStatus;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: {
          storage_path?: string | null;
          status?: MessageMediaStatus;
        };
        Relationships: [
          {
            foreignKeyName: "message_media_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          direction: MessageDirection;
          text: string | null;
          attachments: Json | null;
          quick_reply_payload: string | null;
          postback_payload: string | null;
          callback_data: string | null;
          platform_message_id: string | null;
          sent_by_flow_id: string | null;
          sent_by_node_id: string | null;
          sent_by_user_id: string | null;
          status: MessageStatus;
          /** Id del navegador (Idempotency-Key) del envío desde la bandeja. */
          client_message_id: string | null;
          /** Cuándo la plataforma informó el estado (webhook). */
          status_at: string | null;
          error_code: number | null;
          /** Motivo en español cuando la plataforma no lo entregó. */
          error_text: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          direction: MessageDirection;
          text?: string | null;
          attachments?: Json | null;
          quick_reply_payload?: string | null;
          postback_payload?: string | null;
          callback_data?: string | null;
          platform_message_id?: string | null;
          sent_by_flow_id?: string | null;
          sent_by_node_id?: string | null;
          sent_by_user_id?: string | null;
          status?: MessageStatus;
          client_message_id?: string | null;
          status_at?: string | null;
          error_code?: number | null;
          error_text?: string | null;
          created_at?: string;
        };
        Update: {
          status?: MessageStatus;
          platform_message_id?: string | null;
          status_at?: string | null;
          error_code?: number | null;
          error_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcasts: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          status: BroadcastStatus;
          message_content: Json;
          segment_filter: Json | null;
          scheduled_for: string | null;
          total_recipients: number;
          sent: number;
          delivered: number;
          failed: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          status?: BroadcastStatus;
          message_content: Json;
          segment_filter?: Json | null;
          scheduled_for?: string | null;
          total_recipients?: number;
          sent?: number;
          delivered?: number;
          failed?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          status?: BroadcastStatus;
          message_content?: Json;
          segment_filter?: Json | null;
          scheduled_for?: string | null;
          total_recipients?: number;
          sent?: number;
          delivered?: number;
          failed?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "broadcasts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcast_recipients: {
        Row: {
          id: string;
          broadcast_id: string;
          contact_id: string;
          channel_id: string;
          status: string;
          sent_at: string | null;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          broadcast_id: string;
          contact_id: string;
          channel_id: string;
          status?: string;
          sent_at?: string | null;
          error_message?: string | null;
        };
        Update: {
          status?: string;
          sent_at?: string | null;
          error_message?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey";
            columns: ["broadcast_id"];
            isOneToOne: false;
            referencedRelation: "broadcasts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      scheduled_jobs: {
        Row: {
          id: string;
          type: string;
          payload: Json;
          run_at: string;
          status: JobStatus;
          attempts: number;
          last_error: string | null;
          claimed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          type: string;
          payload: Json;
          run_at: string;
          status?: JobStatus;
          attempts?: number;
          last_error?: string | null;
          claimed_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: JobStatus;
          attempts?: number;
          last_error?: string | null;
          claimed_at?: string | null;
        };
        Relationships: [];
      };
      analytics_events: {
        Row: {
          id: string;
          workspace_id: string;
          flow_id: string | null;
          contact_id: string | null;
          event_type: string;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          flow_id?: string | null;
          contact_id?: string | null;
          event_type: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          workspace_id?: string;
          flow_id?: string | null;
          contact_id?: string | null;
          event_type?: string;
          metadata?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "analytics_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_invites: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          role: string;
          invited_by: string;
          status: string;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          role?: string;
          invited_by: string;
          status?: string;
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          email?: string;
          role?: string;
          status?: string;
          expires_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      comment_logs: {
        Row: {
          id: string;
          channel_id: string;
          workspace_id: string;
          post_id: string | null;
          platform_comment_id: string;
          author_id: string | null;
          author_name: string | null;
          author_username: string | null;
          comment_text: string;
          matched_trigger_id: string | null;
          dm_sent: boolean;
          reply_sent: boolean;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          channel_id: string;
          workspace_id: string;
          post_id?: string | null;
          platform_comment_id: string;
          author_id?: string | null;
          author_name?: string | null;
          author_username?: string | null;
          comment_text: string;
          matched_trigger_id?: string | null;
          dm_sent?: boolean;
          reply_sent?: boolean;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          matched_trigger_id?: string | null;
          dm_sent?: boolean;
          reply_sent?: boolean;
          error?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "comment_logs_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comment_logs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comment_logs_matched_trigger_id_fkey";
            columns: ["matched_trigger_id"];
            isOneToOne: false;
            referencedRelation: "triggers";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_events: {
        Row: {
          event_id: string;
          received_at: string;
        };
        Insert: {
          event_id: string;
          received_at?: string;
        };
        Update: {
          received_at?: string;
        };
        Relationships: [];
      };
      sequences: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          status: SequenceStatus;
          steps: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          status?: SequenceStatus;
          steps?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          status?: SequenceStatus;
          steps?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sequences_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      sequence_enrollments: {
        Row: {
          id: string;
          sequence_id: string;
          contact_id: string;
          channel_id: string;
          current_step_index: number;
          status: SequenceEnrollmentStatus;
          enrolled_at: string;
          next_step_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          sequence_id: string;
          contact_id: string;
          channel_id: string;
          current_step_index?: number;
          status?: SequenceEnrollmentStatus;
          enrolled_at?: string;
          next_step_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          current_step_index?: number;
          status?: SequenceEnrollmentStatus;
          next_step_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_sequence_id_fkey";
            columns: ["sequence_id"];
            isOneToOne: false;
            referencedRelation: "sequences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_enrollments_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_enrollments_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      // ── Fase 1 (00019): equipos ─────────────────────────────────────────
      teams: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          is_default: boolean;
          assignment_mode: AssignmentMode;
          /** Fase 2: horario propio (ver BusinessHours); null = usa el de la empresa. */
          business_hours: Json | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          is_default?: boolean;
          assignment_mode?: AssignmentMode;
          business_hours?: Json | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          is_default?: boolean;
          assignment_mode?: AssignmentMode;
          business_hours?: Json | null;
          archived_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teams_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      team_members: {
        Row: {
          team_id: string;
          user_id: string;
          role: TeamRole;
          /** null = atiende todos los tipos de gestión */
          case_type_ids: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          team_id: string;
          user_id: string;
          role?: TeamRole;
          case_type_ids?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          role?: TeamRole;
          case_type_ids?: string[] | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      // ── Fase 1 (00019): configuración de gestiones ──────────────────────
      contact_types: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          color: string | null;
          position: number;
          is_default: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          color?: string | null;
          position?: number;
          is_default?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          color?: string | null;
          position?: number;
          is_default?: boolean;
          archived_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contact_types_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      case_types: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          color: string | null;
          icon: string | null;
          position: number;
          is_proactive: boolean;
          suggested_for_contact_type_ids: string[];
          routing: CaseRouting;
          fixed_team_id: string | null;
          sla_first_response_minutes: number | null;
          sla_resolution_hours: number | null;
          require_category: boolean;
          require_outcome_reason: boolean;
          /** Fase 2: plantilla al activarse (ver CaseTypeAutoTemplate), o null. */
          auto_template: Json | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          color?: string | null;
          icon?: string | null;
          position?: number;
          is_proactive?: boolean;
          suggested_for_contact_type_ids?: string[];
          routing?: CaseRouting;
          fixed_team_id?: string | null;
          sla_first_response_minutes?: number | null;
          sla_resolution_hours?: number | null;
          require_category?: boolean;
          require_outcome_reason?: boolean;
          auto_template?: Json | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          color?: string | null;
          icon?: string | null;
          position?: number;
          is_proactive?: boolean;
          suggested_for_contact_type_ids?: string[];
          routing?: CaseRouting;
          fixed_team_id?: string | null;
          sla_first_response_minutes?: number | null;
          sla_resolution_hours?: number | null;
          require_category?: boolean;
          require_outcome_reason?: boolean;
          auto_template?: Json | null;
          archived_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_types_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_types_fixed_team_id_fkey";
            columns: ["fixed_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      case_stages: {
        Row: {
          id: string;
          case_type_id: string;
          name: string;
          color: string | null;
          position: number;
          kind: StageKind;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          case_type_id: string;
          name: string;
          color?: string | null;
          position?: number;
          kind?: StageKind;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          color?: string | null;
          position?: number;
          kind?: StageKind;
          archived_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_stages_case_type_id_fkey";
            columns: ["case_type_id"];
            isOneToOne: false;
            referencedRelation: "case_types";
            referencedColumns: ["id"];
          },
        ];
      };
      case_categories: {
        Row: {
          id: string;
          case_type_id: string;
          name: string;
          position: number;
          is_high_priority: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          case_type_id: string;
          name: string;
          position?: number;
          is_high_priority?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          position?: number;
          is_high_priority?: boolean;
          archived_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_categories_case_type_id_fkey";
            columns: ["case_type_id"];
            isOneToOne: false;
            referencedRelation: "case_types";
            referencedColumns: ["id"];
          },
        ];
      };
      case_outcome_reasons: {
        Row: {
          id: string;
          case_type_id: string;
          name: string;
          kind: OutcomeKind;
          position: number;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          case_type_id: string;
          name: string;
          kind: OutcomeKind;
          position?: number;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          kind?: OutcomeKind;
          position?: number;
          archived_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_outcome_reasons_case_type_id_fkey";
            columns: ["case_type_id"];
            isOneToOne: false;
            referencedRelation: "case_types";
            referencedColumns: ["id"];
          },
        ];
      };
      case_rules: {
        Row: {
          id: string;
          case_type_id: string;
          position: number;
          enabled: boolean;
          trigger: CaseRuleTrigger;
          trigger_stage_id: string | null;
          /** Ver CaseRuleCondition. */
          condition: Json;
          action: CaseRuleAction;
          /** Ver CaseRuleParams. */
          params: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          case_type_id: string;
          position?: number;
          enabled?: boolean;
          trigger: CaseRuleTrigger;
          trigger_stage_id?: string | null;
          condition?: Json;
          action: CaseRuleAction;
          params?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          position?: number;
          enabled?: boolean;
          trigger?: CaseRuleTrigger;
          trigger_stage_id?: string | null;
          condition?: Json;
          action?: CaseRuleAction;
          params?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_rules_case_type_id_fkey";
            columns: ["case_type_id"];
            isOneToOne: false;
            referencedRelation: "case_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_rules_trigger_stage_id_fkey";
            columns: ["trigger_stage_id"];
            isOneToOne: false;
            referencedRelation: "case_stages";
            referencedColumns: ["id"];
          },
        ];
      };
      // ── Laboratorio de flujos (00023): escenarios guardados ─────────────
      lab_scenarios: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string;
          /** Ver ScenarioDefinition (lib/flow-lab/scenarios/types.ts). */
          definition: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          last_run_at: string | null;
          /** Ver ScenarioResult (lib/flow-lab/scenarios/types.ts). */
          last_result: Json | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string;
          definition: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          last_run_at?: string | null;
          last_result?: Json | null;
        };
        Update: {
          name?: string;
          description?: string;
          definition?: Json;
          updated_at?: string;
          last_run_at?: string | null;
          last_result?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "lab_scenarios_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      // ── Fase 1 (00019): gestiones y registro ────────────────────────────
      cases: {
        Row: {
          id: string;
          workspace_id: string;
          contact_id: string;
          /** null = "Sin clasificar" */
          case_type_id: string | null;
          stage_id: string | null;
          category_id: string | null;
          status: CaseStatus;
          team_id: string | null;
          assignee_id: string | null;
          origin: CaseOrigin;
          scheduled_for: string | null;
          opened_at: string | null;
          last_inbound_at: string | null;
          last_outbound_at: string | null;
          waiting_since: string | null;
          first_response_at: string | null;
          next_action_at: string | null;
          next_action_note: string | null;
          /** 00020: cuándo el cron avisó que next_action_at venció (null = pendiente). */
          next_action_notified_at: string | null;
          closed_at: string | null;
          closed_by: string | null;
          outcome_reason_id: string | null;
          outcome_note: string | null;
          legal_due_at: string | null;
          priority: CasePriority;
          created_by: string | null;
          // ── Fase 2 (00021) ──
          /** Última respuesta automática fuera de horario. */
          off_hours_reply_sent_at: string | null;
          /** Plantilla automática enviada al activarse (proactivas). */
          auto_template_sent_at: string | null;
          /** Veces que se reasignó por espera. */
          reassigned_count: number;
          /** Cuándo se asignó al responsable actual (lo mantiene un trigger; null sin responsable). */
          assigned_at: string | null;
          /** Último aviso al supervisor de espera excedida sin a quién reasignar. */
          wait_alerted_at: string | null;
          /** client_no_reply: last_outbound_at para el que se emitió el evento. */
          no_reply_event_outbound_at: string | null;
          /** client_no_reply: umbral (minutos) del último evento emitido. */
          no_reply_event_minutes: number | null;
          // ── Fase 3 (00024) ──
          /** Cuándo el cron avisó que se superó el objetivo de primera respuesta. */
          sla_first_response_breached_at: string | null;
          /** Cuándo el cron avisó que se superó el objetivo de resolución. */
          sla_resolution_breached_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          contact_id: string;
          case_type_id?: string | null;
          stage_id?: string | null;
          category_id?: string | null;
          status?: CaseStatus;
          team_id?: string | null;
          assignee_id?: string | null;
          origin?: CaseOrigin;
          scheduled_for?: string | null;
          opened_at?: string | null;
          last_inbound_at?: string | null;
          last_outbound_at?: string | null;
          waiting_since?: string | null;
          first_response_at?: string | null;
          next_action_at?: string | null;
          next_action_note?: string | null;
          next_action_notified_at?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          outcome_reason_id?: string | null;
          outcome_note?: string | null;
          legal_due_at?: string | null;
          priority?: CasePriority;
          created_by?: string | null;
          off_hours_reply_sent_at?: string | null;
          auto_template_sent_at?: string | null;
          reassigned_count?: number;
          assigned_at?: string | null;
          wait_alerted_at?: string | null;
          no_reply_event_outbound_at?: string | null;
          no_reply_event_minutes?: number | null;
          sla_first_response_breached_at?: string | null;
          sla_resolution_breached_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          case_type_id?: string | null;
          stage_id?: string | null;
          category_id?: string | null;
          status?: CaseStatus;
          team_id?: string | null;
          assignee_id?: string | null;
          origin?: CaseOrigin;
          scheduled_for?: string | null;
          opened_at?: string | null;
          last_inbound_at?: string | null;
          last_outbound_at?: string | null;
          waiting_since?: string | null;
          first_response_at?: string | null;
          next_action_at?: string | null;
          next_action_note?: string | null;
          next_action_notified_at?: string | null;
          closed_at?: string | null;
          closed_by?: string | null;
          outcome_reason_id?: string | null;
          outcome_note?: string | null;
          legal_due_at?: string | null;
          priority?: CasePriority;
          off_hours_reply_sent_at?: string | null;
          auto_template_sent_at?: string | null;
          reassigned_count?: number;
          assigned_at?: string | null;
          wait_alerted_at?: string | null;
          no_reply_event_outbound_at?: string | null;
          no_reply_event_minutes?: number | null;
          sla_first_response_breached_at?: string | null;
          sla_resolution_breached_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cases_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_case_type_id_fkey";
            columns: ["case_type_id"];
            isOneToOne: false;
            referencedRelation: "case_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_stage_id_fkey";
            columns: ["stage_id"];
            isOneToOne: false;
            referencedRelation: "case_stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "case_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_outcome_reason_id_fkey";
            columns: ["outcome_reason_id"];
            isOneToOne: false;
            referencedRelation: "case_outcome_reasons";
            referencedColumns: ["id"];
          },
        ];
      };
      case_notes: {
        Row: {
          id: string;
          workspace_id: string;
          case_id: string;
          contact_id: string;
          conversation_id: string | null;
          author_id: string | null;
          body: string;
          mentions: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          case_id: string;
          contact_id: string;
          conversation_id?: string | null;
          author_id?: string | null;
          body: string;
          mentions?: string[];
          created_at?: string;
        };
        Update: {
          body?: string;
          mentions?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "case_notes_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_notes_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_notes_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      activity: {
        Row: {
          id: number;
          workspace_id: string;
          contact_id: string | null;
          case_id: string | null;
          conversation_id: string | null;
          /** Ver ActivityType. */
          type: string;
          /** null = sistema o bot */
          actor_id: string | null;
          from_value: string | null;
          to_value: string | null;
          meta: Json;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          contact_id?: string | null;
          case_id?: string | null;
          conversation_id?: string | null;
          type: string;
          actor_id?: string | null;
          from_value?: string | null;
          to_value?: string | null;
          meta?: Json;
          created_at?: string;
        };
        Update: {
          meta?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "activity_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          type: string;
          title: string;
          body: string | null;
          link: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          type: string;
          title: string;
          body?: string | null;
          link?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          /** Con el cliente del usuario solo se puede cambiar read_at. */
          read_at?: string | null;
        };
        Relationships: [];
      };
      saved_replies: {
        Row: {
          id: string;
          workspace_id: string;
          scope: SavedReplyScope;
          team_id: string | null;
          user_id: string | null;
          case_type_id: string | null;
          title: string;
          shortcut: string | null;
          body: string;
          attachment_url: string | null;
          attachment_name: string | null;
          attachment_mime: string | null;
          attachment_size: number | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          scope: SavedReplyScope;
          team_id?: string | null;
          user_id?: string | null;
          case_type_id?: string | null;
          title: string;
          shortcut?: string | null;
          body: string;
          attachment_url?: string | null;
          attachment_name?: string | null;
          attachment_mime?: string | null;
          attachment_size?: number | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          scope?: SavedReplyScope;
          team_id?: string | null;
          user_id?: string | null;
          case_type_id?: string | null;
          title?: string;
          shortcut?: string | null;
          body?: string;
          attachment_url?: string | null;
          attachment_name?: string | null;
          attachment_mime?: string | null;
          attachment_size?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_replies_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_replies_case_type_id_fkey";
            columns: ["case_type_id"];
            isOneToOne: false;
            referencedRelation: "case_types";
            referencedColumns: ["id"];
          },
        ];
      };
      // ── Fase 2 (00021) ──────────────────────────────────────────────────
      holidays: {
        Row: {
          id: string;
          workspace_id: string;
          /** null = toda la empresa */
          team_id: string | null;
          /** "YYYY-MM-DD" */
          date: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          team_id?: string | null;
          date: string;
          name: string;
          created_at?: string;
        };
        Update: {
          team_id?: string | null;
          date?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "holidays_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "holidays_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      import_batches: {
        Row: {
          id: string;
          workspace_id: string;
          created_by: string | null;
          file_name: string;
          total: number;
          created: number;
          updated: number;
          skipped: number;
          /** Arreglo de errores por fila (lo define la importación). */
          errors: Json;
          options: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          created_by?: string | null;
          file_name?: string;
          total?: number;
          created?: number;
          updated?: number;
          skipped?: number;
          errors?: Json;
          options?: Json;
          created_at?: string;
        };
        Update: {
          file_name?: string;
          total?: number;
          created?: number;
          updated?: number;
          skipped?: number;
          errors?: Json;
          options?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "import_batches_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      increment_unread: {
        Args: {
          conv_id: string;
          preview: string;
        };
        Returns: undefined;
      };
      increment_broadcast_sent: {
        Args: {
          b_id: string;
        };
        Returns: undefined;
      };
      increment_broadcast_failed: {
        Args: {
          b_id: string;
        };
        Returns: undefined;
      };
      // ── Fase 1 (00019): permisos ────────────────────────────────────────
      is_workspace_member: {
        Args: {
          ws_id: string;
        };
        Returns: boolean;
      };
      ws_role: {
        Args: {
          ws: string;
        };
        Returns: string | null;
      };
      is_ws_admin: {
        Args: {
          ws: string;
        };
        Returns: boolean;
      };
      ws_has_teams: {
        Args: {
          ws: string;
        };
        Returns: boolean;
      };
      is_team_member: {
        Args: {
          team: string;
        };
        Returns: boolean;
      };
      is_team_supervisor: {
        Args: {
          team: string;
        };
        Returns: boolean;
      };
      can_see_contact: {
        Args: {
          contact_id: string;
        };
        Returns: boolean;
      };
      can_see_contact_row: {
        Args: {
          p_workspace_id: string;
          p_contact_id: string;
          p_owner_id: string | null;
          p_team_id: string | null;
        };
        Returns: boolean;
      };
      // ── Fase 1 (00020): motor de gestiones (solo service_role) ──────────
      /** Devuelve { case_id, created }. */
      open_inbound_case: {
        Args: {
          p_workspace_id: string;
          p_contact_id: string;
          p_case_type_id: string | null;
          p_stage_id: string | null;
          p_at: string;
        };
        Returns: Json;
      };
      /** Devuelve { status, assignee_id? }. */
      assign_case_pick: {
        Args: {
          p_case_id: string;
          p_candidates: string[];
          p_mode: "round_robin" | "least_load";
        };
        Returns: Json;
      };
      // ── Fase 2 (00021) ──────────────────────────────────────────────────
      /** Formato de business_hours (lo usan los checks de la base). */
      is_valid_business_hours: {
        Args: { p: Json };
        Returns: boolean;
      };
      /**
       * Gestiones abiertas que esperan respuesta del cliente (último mensaje
       * saliente sin respuesta, sin espera del cliente) y con algún umbral de
       * client_no_reply pendiente. Solo service_role.
       */
      cases_pending_no_reply: {
        Args: {
          p_workspace_id: string;
          p_older_than: string;
          p_max_minutes: number;
          p_after_id: string | null;
          p_limit: number;
        };
        Returns: {
          id: string;
          workspace_id: string;
          contact_id: string;
          case_type_id: string | null;
          stage_id: string | null;
          last_outbound_at: string;
          no_reply_event_outbound_at: string | null;
          no_reply_event_minutes: number | null;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
