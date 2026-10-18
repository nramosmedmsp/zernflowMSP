// Tipos de scripts/datos-prueba-lib.mjs (para las pruebas en TypeScript).

export const DEMO_SUFFIX: string;
export const DEMO_EMAIL_DOMAIN: string;
export const DEMO_CHANNEL_PREFIX: string;
export const DEMO_TAG_NAME: string;
export const DEMO_DATA_KEY: string;
export const DEMO_DATA_VERSION: number;

export interface TeamSpec {
  key: string;
  name: string;
  assignment_mode: "round_robin" | "least_load" | "manual";
  wantsDefault: boolean;
}
export interface AdvisorSpec {
  key: string;
  name: string;
  email: string;
  team: string;
  teamRole: "supervisor" | "agent";
  availability: "available" | "away";
}
export interface ChannelSpec {
  key: string;
  platform: "whatsapp" | "instagram";
  late_account_id: string;
  display_name: string;
  username: string;
}
export interface ContactSpec {
  key: string;
  first: string;
  last: string;
  type: string;
  channel: "wa" | "ig";
  handle?: string;
  email: boolean;
  tags: string[];
  keyDateAgo?: number;
}
export type MessageTuple = [from: string, content: string | { template: string }, minutesAgo: number];
export interface ConversationSpec {
  contact: string;
  messages: MessageTuple[];
}
export interface CaseSpec {
  key: string;
  contact: string;
  type: string | null;
  stage: string | null;
  status: "open" | "scheduled" | "won" | "lost" | "resolved";
  origin: "inbound" | "proactive" | "manual";
  team?: string | null;
  assignee?: string | null;
  priority?: string;
  category?: string;
  reason?: string;
  note?: string;
  reached?: string;
  fromConv?: boolean;
  openedAgo?: number;
  closedAgo?: number;
  scheduledIn?: number;
  scheduledAgo?: number;
  scheduledAt?: { days: number; hour: number };
  createdAgo?: number;
  nextActionIn?: number;
  nextActionAgo?: number;
  nextActionNote?: string;
  autoTemplate?: boolean;
  stamps?: { firstResponse?: [number, number] };
  setsContactType?: { from: string; to: string };
}
export interface NoteSpec {
  case: string;
  author: string;
  ago: number;
  mentions: string[];
  body: string;
}
export interface NotificationSpec {
  type: string;
  case: string;
  ago: number;
  read: boolean;
  title: string;
  body: string;
}
export interface SavedReplySpec {
  scope: "workspace" | "personal";
  title: string;
  shortcut: string;
  body: string;
}

export const TEAMS: TeamSpec[];
export const ADVISORS: AdvisorSpec[];
export const CHANNELS: ChannelSpec[];
export const ROUTING_OVERRIDES: { caseType: string; routing: string; team: string }[];
export const CONTACTS: ContactSpec[];
export const CONTACT_ASSIGNMENTS: Record<string, { team: string; owner: string }>;
export const CONVERSATIONS: ConversationSpec[];
export const CASES: CaseSpec[];
export const NOTES: NoteSpec[];
export const NOTIFICATIONS: NotificationSpec[];
export const SAVED_REPLIES: SavedReplySpec[];
export const BROADCAST: { name: string; status: string; message_content: Record<string, unknown> };

export function agoIso(now: Date, minutes: number): string;
export function inIso(now: Date, minutes: number): string;
export function limaDate(iso: string): string;
export function limaAtIso(now: Date, days: number, hour: number): string;

export function contactDisplayName(c: Pick<ContactSpec, "first" | "last">): string;
export function contactPhone(index: number): string;
export function contactEmail(c: ContactSpec): string | null;
export function contactSenderId(c: ContactSpec, index: number): string;
export function savedReplyTitle(r: Pick<SavedReplySpec, "title">): string;
export function previewOf(text: string | null | undefined): string;

export interface BuiltMessage {
  direction: "inbound" | "outbound";
  text: string;
  created_at: string;
  sent_by_user_id: string | null;
  platform_message_id: string;
  status: "sent";
  by: string;
}
export interface BuiltConversation {
  messages: BuiltMessage[];
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  hasHumanReply: boolean;
}
export function buildConversation(
  spec: ConversationSpec,
  ctx: { now: Date; advisorId: (key: string) => string; contactName: string },
): BuiltConversation;

export interface CaseStamps {
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  waitingSince: string | null;
  firstResponse: { waitStart: string; at: string } | null;
}
export function deriveCaseStamps(
  messages: BuiltMessage[],
  ctx: { openedAt: string; closedAt: string | null; now: Date },
): CaseStamps;

export interface IdResolvers {
  contact: (key: string) => string;
  advisor: (key: string) => string;
  team: (key: string) => string;
  contactType: (name: string) => string;
  type: (name: string) => string;
  stage: (type: string, name: string) => string;
  category: (type: string, name: string) => string;
  reason: (type: string, name: string) => string;
  openStages: (type: string) => string[];
}
export interface ActivityRow {
  workspace_id: string;
  contact_id: string;
  conversation_id: string | null;
  type: string;
  created_at: string;
  actor_id: string | null;
  from_value: string | null;
  to_value: string | null;
  meta: Record<string, unknown>;
}
export interface CaseRow {
  workspace_id: string;
  contact_id: string;
  case_type_id: string | null;
  stage_id: string | null;
  category_id: string | null;
  status: string;
  team_id: string | null;
  assignee_id: string | null;
  assigned_at: string | null;
  origin: string;
  scheduled_for: string | null;
  opened_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  waiting_since: string | null;
  first_response_at: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  closed_at: string | null;
  closed_by: string | null;
  outcome_reason_id: string | null;
  outcome_note: string | null;
  priority: string;
  auto_template_sent_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}
export function buildCase(
  spec: CaseSpec,
  ctx: {
    workspaceId: string;
    now: Date;
    ids: IdResolvers;
    ownerId?: string | null;
    conversation: BuiltConversation | null;
    conversationId?: string | null;
    contactFirstName?: string;
  },
): { row: CaseRow; activities: ActivityRow[] };
export function withContactTypeChanges(cases: CaseSpec[]): CaseSpec[];
export function keyDatesByContact(cases: CaseSpec[], now: Date): Map<string, string>;

export function buildContact(
  spec: ContactSpec,
  index: number,
  ctx: {
    now: Date;
    workspaceId: string;
    ids: Pick<IdResolvers, "contactType" | "team" | "advisor">;
    keyDates: Map<string, string>;
    lastInteractionAgo?: number;
    firstCaseAgo?: number;
  },
): {
  workspace_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  contact_type_id: string;
  team_id: string | null;
  owner_id: string | null;
  key_date: string | null;
  source: { demo: true };
  metadata: { demo: true };
  is_subscribed: boolean;
  last_interaction_at: string;
  created_at: string;
};

export function markerProblems(): string[];

export interface DemoData {
  version: number;
  status: "loading" | "ready";
  created_at: string;
  user_ids: string[];
  invite_ids: string[];
  team_ids: string[];
  channel_ids: string[];
  contact_ids: string[];
  case_ids: string[];
  tag_ids: string[];
  saved_reply_ids: string[];
  broadcast_ids: string[];
  notification_ids: string[];
  restore: {
    case_types: { id: string; name: string; routing: string; fixed_team_id: string | null }[];
  };
}
export function emptyDemoData(now?: Date): DemoData;
export function hasDemoData(settings: Record<string, unknown> | null | undefined): boolean;
export function withDemoData(settings: Record<string, unknown> | null | undefined, demoData: unknown): Record<string, unknown>;
export function withoutDemoData(settings: Record<string, unknown> | null | undefined): Record<string, unknown>;

export interface DeletionStep {
  kind: string;
  table: string;
  ids: string[];
  column?: string;
  alsoByContactLink?: string[];
  restore?: DemoData["restore"]["case_types"];
}
export function deletionPlan(demoData: Partial<DemoData> | null | undefined): DeletionStep[];
export function deletionCount(plan: DeletionStep[]): number;
export function chunk<T>(list: T[], size: number): T[][];
export function fillNames(text: string, names: Record<string, string>): string;
