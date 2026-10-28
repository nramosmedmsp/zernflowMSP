import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  availableScopes,
  buildRows,
  caseMatchesScope,
  caseMatchesState,
  emptyText,
  filtersForScope,
  parseStoredView,
  scopeLabel,
  viewHint,
  whatsAppWindowChip,
  groupCasesByContact,
  mentionQueryAt,
  mentionedIds,
  outsideWhatsAppWindow,
  waitingText,
  type InboxCase,
  type InboxConversation,
  type InboxMeta,
  messageAuthor,
} from "./inbox-model";

const ME = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
const TEAM = "00000000-0000-0000-0000-0000000000aa";
const NOW = new Date("2026-10-18T15:00:00Z"); // 10:00 en Lima

function meta(overrides: Partial<InboxMeta> = {}): InboxMeta {
  return {
    userId: ME,
    isAdmin: false,
    agentSeesQueue: false,
    supervisedTeamIds: [],
    myTeamIds: [],
    workspaceHasTeams: false,
    workspaceName: "Muscle Shop",
    caseTypes: [],
    teams: [],
    members: [],
    ...overrides,
  };
}

function kase(overrides: Partial<InboxCase>): InboxCase {
  return {
    id: "case-1",
    workspace_id: "ws",
    contact_id: "contact-1",
    case_type_id: null,
    stage_id: null,
    category_id: null,
    status: "open",
    team_id: null,
    assignee_id: null,
    origin: "inbound",
    scheduled_for: null,
    opened_at: "2026-10-10T10:00:00Z",
    last_inbound_at: null,
    last_outbound_at: null,
    waiting_since: null,
    first_response_at: null,
    next_action_at: null,
    next_action_note: null,
    next_action_notified_at: null,
    closed_at: null,
    closed_by: null,
    outcome_reason_id: null,
    outcome_note: null,
    legal_due_at: null,
    priority: "normal",
    created_by: null,
    off_hours_reply_sent_at: null,
    auto_template_sent_at: null,
    reassigned_count: 0,
    assigned_at: null,
    wait_alerted_at: null,
    no_reply_event_outbound_at: null,
    no_reply_event_minutes: null,
    sla_first_response_breached_at: null,
    sla_resolution_breached_at: null,
    solution_status: null,
    solution_note: null,
    solution_at: null,
    solution_by: null,
    solution_clock_at: null,
    deadline_alerted_at: null,
    commitment_alerted_at: null,
    close_request: null,
    created_at: "2026-10-10T10:00:00Z",
    updated_at: "2026-10-10T10:00:00Z",
    ...overrides,
  };
}

function conv(id: string, contactId: string, lastMessageAt: string | null = null): InboxConversation {
  return {
    id,
    workspace_id: "ws",
    channel_id: "ch",
    contact_id: contactId,
    late_conversation_id: null,
    platform: "whatsapp",
    status: "open",
    assigned_to: null,
    last_message_at: lastMessageAt,
    last_message_preview: null,
    unread_count: 0,
    is_automation_paused: false,
    complaint_flagged_at: null,
    complaint_excerpt: null,
    complaint_alerted_at: null,
    complaint_dismissed_at: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    contacts: null,
  };
}

describe("availableScopes", () => {
  it("asesor: solo Míos", () => {
    expect(availableScopes(meta())).toEqual(["mine"]);
  });
  it("asesor con cola visible: suma Sin asignar", () => {
    expect(availableScopes(meta({ agentSeesQueue: true }))).toEqual(["mine", "unassigned"]);
  });
  it("supervisor: suma Sin asignar y Equipo", () => {
    expect(availableScopes(meta({ supervisedTeamIds: [TEAM] }))).toEqual(["mine", "unassigned", "team"]);
  });
  it("administrador: todos", () => {
    expect(availableScopes(meta({ isAdmin: true }))).toEqual(["mine", "unassigned", "team", "all"]);
  });
});

describe("caseMatchesState", () => {
  it("Seguimiento hoy: próximo contacto vencido o de hoy, o activada hoy", () => {
    expect(caseMatchesState(kase({ next_action_at: "2026-10-18T22:00:00Z" }), "today", NOW)).toBe(true);
    expect(caseMatchesState(kase({ next_action_at: "2026-10-10T22:00:00Z" }), "today", NOW)).toBe(true);
    expect(caseMatchesState(kase({ next_action_at: "2026-10-19T15:00:00Z" }), "today", NOW)).toBe(false);
    expect(
      caseMatchesState(kase({ scheduled_for: "2026-10-18T14:00:00Z", opened_at: "2026-10-18T14:00:01Z" }), "today", NOW),
    ).toBe(true);
    expect(caseMatchesState(kase({ status: "scheduled", next_action_at: "2026-10-18T12:00:00Z" }), "today", NOW)).toBe(false);
  });
  it("Por responder: tiene waiting_since; Todo no restringe", () => {
    expect(caseMatchesState(kase({ waiting_since: "2026-10-18T14:00:00Z" }), "waiting", NOW)).toBe(true);
    expect(caseMatchesState(kase({}), "waiting", NOW)).toBe(false);
    expect(caseMatchesState(kase({}), "all", NOW)).toBe(true);
  });
});

describe("caseMatchesScope", () => {
  it("Míos y Sin asignar", () => {
    const m = meta();
    expect(caseMatchesScope(kase({ assignee_id: ME }), "mine", m, null)).toBe(true);
    expect(caseMatchesScope(kase({ assignee_id: OTHER }), "mine", m, null)).toBe(false);
    expect(caseMatchesScope(kase({ assignee_id: null }), "unassigned", m, null)).toBe(true);
    expect(caseMatchesScope(kase({ assignee_id: null, status: "scheduled" }), "unassigned", m, null)).toBe(false);
  });

  it("Equipo: equipo de la gestión o del contacto", () => {
    const m = meta({ supervisedTeamIds: [TEAM] });
    expect(caseMatchesScope(kase({ team_id: TEAM }), "team", m, null)).toBe(true);
    expect(caseMatchesScope(kase({ team_id: null }), "team", m, TEAM)).toBe(true);
    expect(caseMatchesScope(kase({ team_id: "otro" }), "team", m, null)).toBe(false);
  });
});

describe("scopeLabel", () => {
  it("Equipo usa el nombre si hay uno solo", () => {
    const teams = [{ id: TEAM, name: "Ventas" }, { id: "otro", name: "Soporte" }];
    expect(scopeLabel(meta({ supervisedTeamIds: [TEAM], teams }), "team")).toBe("Ventas");
    expect(scopeLabel(meta({ supervisedTeamIds: [TEAM, "otro"], teams }), "team")).toBe("Equipo");
    expect(scopeLabel(meta({ isAdmin: true, teams }), "team")).toBe("Equipo");
    expect(scopeLabel(meta({ isAdmin: true, myTeamIds: [TEAM], teams }), "team")).toBe("Ventas");
    expect(scopeLabel(meta({ supervisedTeamIds: [TEAM] }), "team")).toBe("Equipo");
    expect(scopeLabel(meta(), "mine")).toBe("Míos");
    expect(scopeLabel(meta(), "all")).toBe("Todos");
  });
});

describe("textos de la vista", () => {
  it("pista y lista vacía", () => {
    expect(viewHint("mine", "all")).toBe("Chats asignados a ti. Primero los que más esperan.");
    expect(viewHint("unassigned", "waiting")).toContain("sin asignar");
    expect(emptyText("mine", "waiting", false)).toBe("No tienes chats por responder");
    expect(emptyText("all", "today", false)).toBe("Nadie tiene seguimientos para hoy");
    expect(emptyText("mine", "all", false)).toBe("No tienes chats asignados");
    expect(emptyText("mine", "waiting", true)).toBe("No se encontraron conversaciones");
  });
});

describe("parseStoredView", () => {
  it("lee lo guardado y valida el alcance", () => {
    const raw = JSON.stringify({ scope: "team", state: "waiting" });
    expect(parseStoredView(raw, ["mine", "team"])).toEqual({ scope: "team", state: "waiting" });
    expect(parseStoredView(raw, ["mine"])).toEqual({ scope: "mine", state: "waiting" });
    expect(parseStoredView("no json", ["mine"])).toEqual({ scope: "mine", state: "all" });
    expect(parseStoredView(null, ["mine"])).toEqual({ scope: "mine", state: "all" });
  });
});

describe("buildRows", () => {
  it("ordena por espera y elige la gestión mía", () => {
    const cases = [
      kase({ id: "a", contact_id: "c1", assignee_id: ME, waiting_since: "2026-10-18T14:00:00Z" }),
      kase({ id: "b", contact_id: "c2", assignee_id: ME, waiting_since: "2026-10-18T10:00:00Z" }),
      kase({ id: "c", contact_id: "c3", assignee_id: ME }),
      kase({ id: "d", contact_id: "c1", assignee_id: OTHER, waiting_since: "2026-10-18T09:00:00Z" }),
    ];
    const rows = buildRows(
      [conv("x1", "c1"), conv("x2", "c2"), conv("x3", "c3", "2026-10-18T14:30:00Z"), conv("x4", "c4")],
      groupCasesByContact(cases),
      "mine",
      "all",
      EMPTY_FILTERS,
      meta(),
      NOW,
    );
    expect(rows.map((r) => [r.conversation.id, r.case?.id])).toEqual([
      ["x2", "b"],
      ["x1", "a"],
      ["x3", "c"],
    ]);
  });

  it("Todas incluye chats sin gestión y el filtro Sin gestión los aísla", () => {
    const cases = [kase({ id: "a", contact_id: "c1" })];
    const grouped = groupCasesByContact(cases);
    const convs = [conv("x1", "c1"), conv("x2", "c2")];
    const admin = meta({ isAdmin: true });
    expect(buildRows(convs, grouped, "all", "all", EMPTY_FILTERS, admin, NOW)).toHaveLength(2);
    const none = buildRows(convs, grouped, "all", "all", { ...EMPTY_FILTERS, status: "none" }, admin, NOW);
    expect(none.map((r) => r.conversation.id)).toEqual(["x2"]);
  });

  it("filtra por estado Por responder y por responsable", () => {
    const cases = [
      kase({ id: "a", contact_id: "c1", waiting_since: "2026-10-18T14:00:00Z" }),
      kase({ id: "b", contact_id: "c2", assignee_id: OTHER }),
    ];
    const grouped = groupCasesByContact(cases);
    const convs = [conv("x1", "c1"), conv("x2", "c2")];
    const admin = meta({ isAdmin: true });
    expect(buildRows(convs, grouped, "all", "waiting", EMPTY_FILTERS, admin, NOW).map((r) => r.case?.id)).toEqual(["a"]);
    expect(buildRows(convs, grouped, "all", "waiting", { ...EMPTY_FILTERS, status: "none" }, admin, NOW)).toEqual([]);
    expect(buildRows(convs, grouped, "all", "all", { ...EMPTY_FILTERS, assigneeId: OTHER }, admin, NOW).map((r) => r.case?.id)).toEqual(["b"]);
    expect(buildRows(convs, grouped, "all", "all", { ...EMPTY_FILTERS, assigneeId: "none" }, admin, NOW).map((r) => r.case?.id)).toEqual(["a"]);
  });
});

describe("textos y ventana", () => {
  it("waitingText", () => {
    expect(waitingText("hace 5 min")).toBe("Esperando hace 5 min");
    expect(waitingText("ayer")).toBe("Esperando ayer");
    expect(waitingText("3 oct 2026")).toBe("Esperando desde 3 oct 2026");
  });

  it("ventana de 24 horas solo en WhatsApp", () => {
    const now = NOW.getTime();
    expect(outsideWhatsAppWindow("whatsapp", "2026-10-17T14:00:00Z", now)).toBe(true);
    expect(outsideWhatsAppWindow("whatsapp", "2026-10-17T16:00:00Z", now)).toBe(false);
    expect(outsideWhatsAppWindow("instagram", "2026-10-01T00:00:00Z", now)).toBe(false);
    expect(outsideWhatsAppWindow("whatsapp", null, now)).toBe(false);
  });
});

describe("menciones", () => {
  it("detecta la consulta tras @", () => {
    expect(mentionQueryAt("Hola @Ana", 9)).toEqual({ start: 5, query: "Ana" });
    expect(mentionQueryAt("correo@dominio", 14)).toBeNull();
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
  });
  it("solo envía las menciones que siguen en el texto", () => {
    const picked = new Map([
      [ME, "Ana Pérez"],
      [OTHER, "Luis"],
    ]);
    expect(mentionedIds("Revisa esto @Ana Pérez", picked)).toEqual([ME]);
  });
});

describe("filtersForScope", () => {
  it("quita el filtro oculto «Sin gestión» fuera del alcance Todos", () => {
    const none = { ...EMPTY_FILTERS, status: "none" as const };
    expect(filtersForScope(none, "mine").status).toBe("");
    expect(filtersForScope(none, "team").status).toBe("");
    expect(filtersForScope(none, "all").status).toBe("none");
    expect(filtersForScope({ ...EMPTY_FILTERS, status: "open" }, "mine").status).toBe("open");
  });
  it("activeFilterCount ya no cuenta el estado", () => {
    expect(activeFilterCount({ ...EMPTY_FILTERS, status: "open", platform: "whatsapp" })).toBe(2);
  });
});

describe("whatsAppWindowChip", () => {
  const last = "2026-10-27T10:00:00.000Z";
  const at = (iso: string) => new Date(iso).getTime();
  it("cuenta las horas que quedan", () => {
    expect(whatsAppWindowChip("whatsapp", last, at("2026-10-27T13:00:00.000Z"))).toEqual({ text: "Quedan 21 h", urgent: false });
  });
  it("en la última hora cuenta minutos y es urgente", () => {
    expect(whatsAppWindowChip("whatsapp", last, at("2026-10-28T09:20:00.000Z"))).toEqual({ text: "Quedan 40 min", urgent: true });
  });
  it("no aplica fuera de WhatsApp ni con la ventana cerrada", () => {
    expect(whatsAppWindowChip("instagram", last, at("2026-10-27T13:00:00.000Z"))).toBeNull();
    expect(whatsAppWindowChip("whatsapp", last, at("2026-10-28T10:00:01.000Z"))).toBeNull();
    expect(whatsAppWindowChip("whatsapp", null, at("2026-10-27T13:00:00.000Z"))).toBeNull();
  });
});

describe("messageAuthor", () => {
  const members = [{ userId: "u-ana", name: "Ana Torres", email: null, availability: "available" as const, teams: [] }];
  const msg = (extra: Partial<{ direction: string; sent_by_user_id: string | null; sent_by_flow_id: string | null; flow_name: string | null }>) => ({
    direction: "outbound",
    sent_by_user_id: null,
    sent_by_flow_id: null,
    ...extra,
  });
  it("nombre del asesor, Tú, o el bot con su flujo", () => {
    expect(messageAuthor(msg({ sent_by_user_id: "u-ana" }), members, "u-yo")).toBe("Ana Torres");
    expect(messageAuthor(msg({ sent_by_user_id: "u-yo" }), members, "u-yo")).toBe("Tú");
    expect(messageAuthor(msg({ sent_by_flow_id: "f1", flow_name: "Bienvenida" }), members, "u-yo")).toBe("Bot · Bienvenida");
    expect(messageAuthor(msg({ sent_by_user_id: "u-x" }), members, "u-yo")).toBe("Otro asesor");
    expect(messageAuthor(msg({}), members, "u-yo")).toBeNull();
    expect(messageAuthor(msg({ direction: "inbound", sent_by_user_id: "u-ana" }), members, "u-yo")).toBeNull();
  });
});
