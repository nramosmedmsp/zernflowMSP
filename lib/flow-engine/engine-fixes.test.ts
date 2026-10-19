// Correcciones del motor de flujos sobre la base en memoria: categoría al
// clasificar, nota de atención humana, condiciones (formato del panel y formato
// antiguo) y esperas de respuesta.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { executeFlow } from "./engine";
import { executeCaseAction } from "./nodes/case-actions";
import type { FlowExecutionContext } from "./types";
import { claimWaitingSession, findWaitingSession, smartDelayTimeoutMs } from "./waiting-session";

type Row = Record<string, unknown>;

const WS = "ws-1";
const CH = "ch-1";
let fake: FakeDb;
let contactId: string;
let conversationId: string;

const byName = (table: string, name: string): Row => fake.rows(table).find((r) => r.name === name)!;

async function setup() {
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [{ workspace_id: WS, user_id: "u-1", role: "member" }]);
  await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "ecommerce");
  fake.seed("channels", [{ id: CH, workspace_id: WS, platform: "instagram", late_account_id: null }]);
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María", is_subscribed: true, contact_tags: [], contact_custom_fields: [] }]);
  contactId = contact.id as string;
  const [conversation] = fake.seed("conversations", [{ workspace_id: WS, contact_id: contactId, channel_id: CH }]);
  conversationId = conversation.id as string;
}

const context = (over: Partial<FlowExecutionContext> = {}): FlowExecutionContext => ({
  triggerId: "tr1",
  flowId: "flow-1",
  channelId: CH,
  contactId,
  conversationId,
  workspaceId: WS,
  incomingMessage: { text: "" },
  startFresh: true,
  variables: {},
  ...over,
});

function openCase(typeName?: string) {
  const [row] = fake.seed("cases", [
    {
      workspace_id: WS,
      contact_id: contactId,
      status: "open",
      case_type_id: typeName ? byName("case_types", typeName).id : null,
    },
  ]);
  return row;
}

const categoryOf = (caseType: string, name: string) =>
  fake.rows("case_categories").find((c) => c.name === name && c.case_type_id === byName("case_types", caseType).id)!;

describe("Clasificar gestión con categoría", () => {
  beforeEach(setup);
  afterEach(() => vi.restoreAllMocks());

  it("clasifica y asigna la categoría del tipo", async () => {
    const row = openCase();
    const category = categoryOf("Postventa", "Estado de pedido");
    await executeCaseAction(fake.asDb(), "classifyCase", {
      caseTypeId: byName("case_types", "Postventa").id,
      categoryId: category.id,
      categoryName: "Estado de pedido",
    }, context());
    const saved = fake.rows("cases").find((c) => c.id === row.id)!;
    expect(saved.case_type_id).toBe(byName("case_types", "Postventa").id);
    expect(saved.category_id).toBe(category.id);
    expect(fake.rows("analytics_events").filter((e) => e.event_type === "case_category_ignored")).toHaveLength(0);
  });

  it("si la gestión ya tenía otra categoría, el flujo la cambia", async () => {
    const row = openCase("Postventa");
    row.category_id = categoryOf("Postventa", "Reclamo").id;
    await executeCaseAction(fake.asDb(), "classifyCase", {
      caseTypeId: byName("case_types", "Postventa").id,
      categoryId: categoryOf("Postventa", "Estado de pedido").id,
    }, context());
    expect(fake.rows("cases")[0].category_id).toBe(categoryOf("Postventa", "Estado de pedido").id);
  });

  it("una categoría que no es del tipo se ignora con registro, y la gestión se clasifica igual", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openCase();
    const foreign = categoryOf("Postventa", "Estado de pedido");
    await executeCaseAction(fake.asDb(), "classifyCase", {
      caseTypeId: byName("case_types", "Venta").id,
      categoryId: foreign.id,
      categoryName: "Estado de pedido",
    }, context());
    const saved = fake.rows("cases")[0];
    expect(saved.case_type_id).toBe(byName("case_types", "Venta").id);
    expect(saved.category_id ?? null).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("categoría"));
    const event = fake.rows("analytics_events").find((e) => e.event_type === "case_category_ignored");
    expect(event).toMatchObject({ flow_id: "flow-1", metadata: { categoryId: foreign.id } });
  });

  it("sin categoría en el nodo no toca la categoría", async () => {
    openCase();
    await executeCaseAction(fake.asDb(), "classifyCase", { caseTypeId: byName("case_types", "Postventa").id }, context());
    expect(fake.rows("cases")[0].category_id ?? null).toBeNull();
  });
});

describe("Atención humana: nota interna", () => {
  beforeEach(setup);

  const takeoverFlow = (message?: string) => ({
    id: "flow-1",
    workspace_id: WS,
    status: "published",
    nodes: [
      { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "keyword" } },
      { id: "h", type: "action", position: { x: 0, y: 0 }, data: { actionType: "humanTakeover", ...(message ? { message } : {}) } },
    ],
    edges: [{ id: "e", source: "t", target: "h" }],
  });

  it("guarda el texto como nota interna sin autor en la gestión abierta", async () => {
    fake.seed("flows", [takeoverFlow("Solicitud de {{tema}}: revisa los datos.")]);
    const row = openCase("Postventa");
    await executeFlow(fake.asDb(), context({ variables: { tema: "congelamiento" } }));

    const notes = fake.rows("case_notes");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      workspace_id: WS,
      case_id: row.id,
      contact_id: contactId,
      conversation_id: conversationId,
      author_id: null,
      body: "Solicitud de congelamiento: revisa los datos.",
      mentions: [],
    });
    expect(fake.rows("activity").some((a) => a.type === "note_added" && a.case_id === row.id && a.actor_id === null)).toBe(true);
    // Sigue pausando la automatización y cerrando la sesión.
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(true);
    expect(fake.rows("flow_sessions")[0]).toMatchObject({ status: "completed" });
  });

  it("sin texto no crea nota", async () => {
    fake.seed("flows", [takeoverFlow()]);
    openCase();
    await executeFlow(fake.asDb(), context());
    expect(fake.rows("case_notes")).toHaveLength(0);
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(true);
  });

  it("sin gestión abierta no guarda la nota, pero el traspaso sigue", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.seed("flows", [takeoverFlow("Nota")]);
    await executeFlow(fake.asDb(), context());
    expect(fake.rows("case_notes")).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(true);
    warn.mockRestore();
  });
});

describe("condiciones en el motor", () => {
  beforeEach(setup);

  /** Flujo Condición -> Atención humana con una nota distinta por rama (la nota delata qué rama siguió). */
  function branchFlow(conditions: Array<{ field: string; operator: string; value: string }>, logic = "and") {
    fake.seed("flows", [
      {
        id: "flow-1",
        workspace_id: WS,
        status: "published",
        nodes: [
          { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "keyword" } },
          { id: "c", type: "condition", position: { x: 0, y: 0 }, data: { conditions, logic } },
          { id: "y", type: "action", position: { x: 0, y: 0 }, data: { actionType: "humanTakeover", message: "SI" } },
          { id: "n", type: "action", position: { x: 0, y: 0 }, data: { actionType: "humanTakeover", message: "NO" } },
        ],
        edges: [
          { id: "e0", source: "t", target: "c" },
          { id: "e1", source: "c", target: "y", sourceHandle: "yes" },
          { id: "e2", source: "c", target: "n", sourceHandle: "no" },
        ],
      },
    ]);
  }

  async function branch(variables: Record<string, string> = {}): Promise<string> {
    await executeFlow(fake.asDb(), context({ variables }));
    return fake.rows("case_notes")[0].body as string;
  }

  beforeEach(() => {
    openCase();
  });

  it("variable:<nombre> ignora mayúsculas y tildes", async () => {
    branchFlow([{ field: "variable:message", operator: "contains", value: "envio" }]);
    expect(await branch({ message: "¿Dónde está mi ENVÍO?" })).toBe("SI");
  });

  it("equals ignora mayúsculas y tildes", async () => {
    branchFlow([{ field: "variable:message", operator: "equals", value: "sede 2" }]);
    expect(await branch({ message: "SEDE 2" })).toBe("SI");
  });

  it("not_equals", async () => {
    branchFlow([{ field: "variable:message", operator: "not_equals", value: "si" }]);
    expect(await branch({ message: "Sí" })).toBe("NO");
  });

  it("tag:<nombre> con la etiqueta del contacto", async () => {
    fake.rows("contacts")[0].contact_tags = [{ tag_id: "g1", tags: { name: "VIP" } }];
    branchFlow([{ field: "tag:VIP", operator: "equals", value: "true" }]);
    expect(await branch()).toBe("SI");
  });

  it("tag:<nombre> sin la etiqueta sigue por No", async () => {
    branchFlow([{ field: "tag:VIP", operator: "equals", value: "true" }]);
    expect(await branch()).toBe("NO");
  });

  it("formato antiguo: tag sin nombre y campo con slug sin prefijo", async () => {
    fake.rows("contacts")[0].contact_tags = [{ tag_id: "g1", tags: { name: "VIP" } }];
    branchFlow([{ field: "tag", operator: "equals", value: "VIP" }]);
    expect(await branch()).toBe("SI");
  });

  it("campo personalizado en formato actual y antiguo", async () => {
    fake.rows("contacts")[0].contact_custom_fields = [{ value: "PE-9", custom_field_definitions: { slug: "numero_pedido" } }];
    branchFlow([
      { field: "custom_field:numero_pedido", operator: "equals", value: "pe-9" },
      { field: "numero_pedido", operator: "exists", value: "" },
    ]);
    expect(await branch()).toBe("SI");
  });

  it("plataforma e is_subscribed", async () => {
    branchFlow([
      { field: "platform", operator: "equals", value: "instagram" },
      { field: "is_subscribed", operator: "equals", value: "true" },
    ]);
    expect(await branch()).toBe("SI");
  });
});

describe("esperas de respuesta", () => {
  beforeEach(setup);

  it("Espera inteligente deja la sesión esperando y vence según su tiempo límite", async () => {
    fake.seed("flows", [
      {
        id: "flow-1",
        workspace_id: WS,
        status: "published",
        nodes: [
          { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "keyword" } },
          { id: "w", type: "action", position: { x: 0, y: 0 }, data: { actionType: "smartDelay", timeout: 2, timeoutUnit: "hours" } },
        ],
        edges: [{ id: "e", source: "t", target: "w" }],
      },
    ]);
    const before = Date.now();
    await executeFlow(fake.asDb(), context());
    const session = fake.rows("flow_sessions")[0];
    expect(session).toMatchObject({ waiting_for_input: true, current_node_id: "w", status: "active" });
    const until = new Date(session.waiting_until as string).getTime();
    expect(until - before).toBeGreaterThanOrEqual(2 * 3_600_000 - 1000);
    expect(until - before).toBeLessThan(2 * 3_600_000 + 5000);
  });

  it("tiempo límite por defecto (30 minutos, como el panel) y unidades", () => {
    expect(smartDelayTimeoutMs({})).toBe(30 * 60_000);
    expect(smartDelayTimeoutMs({ timeout: 1, timeoutUnit: "days" })).toBe(86_400_000);
    expect(smartDelayTimeoutMs({ timeout: 0 })).toBe(30 * 60_000);
  });

  function session(over: Row = {}) {
    return fake.seed("flow_sessions", [
      {
        contact_id: contactId,
        flow_id: "flow-1",
        channel_id: CH,
        status: "active",
        waiting_for_input: true,
        waiting_until: new Date(Date.now() + 60_000).toISOString(),
        ...over,
      },
    ])[0];
  }

  it("findWaitingSession devuelve la sesión que espera y no ha vencido", async () => {
    const s = session();
    expect((await findWaitingSession(fake.asDb(), { contactId, channelId: CH }))?.id).toBe(s.id);
  });

  it("ignora sesiones de otro canal, de otro contacto o que no esperan respuesta", async () => {
    session({ channel_id: "otro" });
    session({ contact_id: "otro" });
    session({ waiting_for_input: false });
    session({ status: "completed" });
    expect(await findWaitingSession(fake.asDb(), { contactId, channelId: CH })).toBeNull();
  });

  it("una espera vencida no se retoma y se marca como vencida", async () => {
    const s = session({ waiting_until: new Date(Date.now() - 1000).toISOString() });
    expect(await findWaitingSession(fake.asDb(), { contactId, channelId: CH })).toBeNull();
    expect(fake.rows("flow_sessions").find((x) => x.id === s.id)).toMatchObject({ status: "expired", waiting_for_input: false });
  });

  it("sin fecha límite (esperas antiguas) sigue esperando", async () => {
    const s = session({ waiting_until: null });
    expect((await findWaitingSession(fake.asDb(), { contactId, channelId: CH }))?.id).toBe(s.id);
  });

  it("con varias, toma la más reciente y deja pasar las vencidas", async () => {
    const old = session({ updated_at: "2026-01-01T00:00:00.000Z" });
    const expired = session({ waiting_until: new Date(Date.now() - 1000).toISOString(), updated_at: "2026-12-01T00:00:00.000Z" });
    const recent = session({ updated_at: "2026-06-01T00:00:00.000Z" });
    void old;
    void expired;
    expect((await findWaitingSession(fake.asDb(), { contactId, channelId: CH }))?.id).toBe(recent.id);
  });

  it("claimWaitingSession solo la entrega una vez", async () => {
    const s = session();
    expect(await claimWaitingSession(fake.asDb(), s.id as string)).toBe(true);
    expect(await claimWaitingSession(fake.asDb(), s.id as string)).toBe(false);
  });
});
