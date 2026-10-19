// Estado de la simulación: creación, copia y consultas. Todo es JSON.

import type { LabCase, LabCatalog, LabChannel, LabContact, LabProfile, LabState } from "./types";

export function emptyContact(overrides: Partial<LabContact> = {}): LabContact {
  return {
    name: "Cliente de prueba",
    phone: "51999999999",
    contactTypeId: null,
    tags: [],
    customFields: {},
    subscribed: true,
    ownerId: null,
    teamId: null,
    keyDate: null,
    existed: false,
    ...overrides,
  };
}

export interface CreateStateInput {
  channel?: LabChannel;
  /** Reloj inicial (ISO). Por defecto, ahora. */
  clock?: string;
  profile?: Pick<LabProfile, "contact" | "cases" | "messages" | "clock">;
  contact?: Partial<LabContact>;
  /** Flujos activos: null/omitido = todos los publicados. */
  enabledFlowIds?: string[] | null;
}

function counterFrom(items: readonly { id: string }[], prefix: string): number {
  return items.reduce((max, item) => {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(item.id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
}

export function createLabState(catalog: LabCatalog, input: CreateStateInput = {}): LabState {
  const profile = input.profile;
  const cases = profile ? structuredClone(profile.cases) : [];
  const messages = profile ? structuredClone(profile.messages) : [];
  return {
    version: 1,
    clock: input.clock ?? profile?.clock ?? new Date().toISOString(),
    channel: input.channel ?? "whatsapp",
    enabledFlowIds: input.enabledFlowIds === undefined ? null : input.enabledFlowIds,
    contact: emptyContact({ ...(profile?.contact ? structuredClone(profile.contact) : {}), ...input.contact }),
    cases,
    sessions: [],
    jobs: [],
    messages,
    automationPaused: false,
    members: Object.fromEntries(
      catalog.members.map((m) => [m.userId, { availability: m.availability, lastAssignedAt: m.lastAssignedAt }]),
    ),
    events: [],
    counters: {
      case: counterFrom(cases, "case"),
      session: 0,
      job: 0,
      message: counterFrom(messages, "msg"),
      event: 0,
      seq: 0,
    },
  };
}

/** Copia profunda del estado (las acciones nunca modifican el que reciben). */
export function cloneState(state: LabState): LabState {
  return structuredClone(state);
}

export function nextId(state: LabState, kind: "case" | "session" | "job" | "message"): string {
  state.counters[kind] += 1;
  const prefix = kind === "message" ? "msg" : kind;
  return `${prefix}-${state.counters[kind]}`;
}

/** Orden de "más reciente": abierta más tarde primero (sin fecha al final) y luego la creada más tarde. */
export function compareLatestOpen(a: LabCase, b: LabCase): number {
  const ao = a.openedAt ? new Date(a.openedAt).getTime() : Number.NEGATIVE_INFINITY;
  const bo = b.openedAt ? new Date(b.openedAt).getTime() : Number.NEGATIVE_INFINITY;
  if (ao !== bo) return bo - ao;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/** Gestión abierta más reciente del contacto. */
export function latestOpenCase(state: Pick<LabState, "cases">): LabCase | null {
  return state.cases.filter((c) => c.status === "open").sort(compareLatestOpen)[0] ?? null;
}

export function caseById(state: Pick<LabState, "cases">, id: string | null | undefined): LabCase | null {
  return id ? (state.cases.find((c) => c.id === id) ?? null) : null;
}

/** La gestión "actual" para mostrar: la abierta más reciente, o la última cerrada o programada. */
export function currentCase(state: Pick<LabState, "cases">): LabCase | null {
  const open = latestOpenCase(state);
  if (open) return open;
  const rest = [...state.cases].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rest[0] ?? null;
}

/** Último mensaje entrante de cualquier gestión del contacto (para la ventana de 24 h). */
export function lastInboundAt(state: Pick<LabState, "cases">): string | null {
  let best: string | null = null;
  for (const c of state.cases) {
    if (c.lastInboundAt && (!best || new Date(c.lastInboundAt) > new Date(best))) best = c.lastInboundAt;
  }
  return best;
}

export function newCaseTemplate(id: string, createdAt: string): LabCase {
  return {
    id,
    caseTypeId: null,
    stageId: null,
    categoryId: null,
    status: "open",
    origin: "inbound",
    teamId: null,
    assigneeId: null,
    assignedAt: null,
    scheduledFor: null,
    openedAt: null,
    createdAt,
    lastInboundAt: null,
    lastOutboundAt: null,
    waitingSince: null,
    firstResponseAt: null,
    closedAt: null,
    closedFromStageId: null,
    outcomeReasonId: null,
    offHoursReplySentAt: null,
    autoTemplateSentAt: null,
    noReplyEventOutboundAt: null,
    noReplyEventMinutes: null,
    notes: [],
  };
}

/** ¿Está abierta la ventana de 24 h de WhatsApp en este momento? (null = nunca escribió) */
export function lastClientMessageAt(state: Pick<LabState, "messages">): string | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].author === "client") return state.messages[i].at;
  }
  return null;
}
