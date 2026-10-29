// Tanda 3 (antes de conectar canales reales): lo que hace el motor del bot
// cuando el canal es real. Base en memoria; Zernio y su clave simulados.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { executeFlow, MAX_GOTO_CHAIN } from "./engine";
import type { FlowExecutionContext } from "./types";

const { sendInboxMessage } = vi.hoisted(() => ({ sendInboxMessage: vi.fn() }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ messages: { sendInboxMessage } }),
}));
vi.mock("@/lib/workspace-secrets", () => ({
  getLateApiKey: async () => "key",
  getWorkspaceSecrets: async () => ({ lateApiKey: "key", aiApiKey: null, webhookSecret: null }),
}));

type Row = Record<string, unknown>;

const WS = "ws-1";
const CH = "ch-1";
let fake: FakeDb;

const triggerNode = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "keyword" } };
const send = (id: string, text: string) => ({ id, type: "sendMessage", position: { x: 0, y: 0 }, data: { messages: [{ text }] } });
const action = (id: string, data: Record<string, unknown>) => ({ id, type: "action", position: { x: 0, y: 0 }, data });
const wait = (id: string) => action(id, { actionType: "smartDelay", timeout: 30, timeoutUnit: "minutes" });
const chain = (ids: string[]) => ids.slice(0, -1).map((source, i) => ({ id: `e${i}`, source, target: ids[i + 1] }));

function seedFlow(id: string, nodes: Row[], status = "published", workspace = WS) {
  fake.seed("flows", [{ id, workspace_id: workspace, status, nodes: [triggerNode, ...nodes], edges: chain(["t", ...nodes.map((n) => n.id as string)]) }]);
}

const ctx = (over: Partial<FlowExecutionContext> = {}): FlowExecutionContext => ({
  triggerId: "tr",
  flowId: "f1",
  channelId: CH,
  contactId: "ct-1",
  conversationId: "cv-1",
  workspaceId: WS,
  lateConversationId: "z-1",
  incomingMessage: { text: "hola" },
  startFresh: true,
  variables: {},
  ...over,
});

beforeEach(() => {
  sendInboxMessage.mockReset();
  sendInboxMessage.mockResolvedValue({ data: { data: { messageId: "wamid.1" } } });
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Muscle Shop", slug: "ms", settings: {} }]);
  fake.seed("channels", [{ id: CH, workspace_id: WS, platform: "instagram", late_account_id: "acc-real" }]);
  fake.seed("contacts", [{ id: "ct-1", workspace_id: WS, display_name: "María López", is_subscribed: true }]);
  fake.seed("conversations", [{ id: "cv-1", workspace_id: WS, channel_id: CH, contact_id: "ct-1", platform: "instagram", late_conversation_id: "z-1" }]);
});
afterEach(() => vi.restoreAllMocks());

const sentTexts = () => sendInboxMessage.mock.calls.map((c) => (c[0] as { body: { message: string } }).body.message);

describe("M-9: lo que contesta el bot se ve en vivo", () => {
  it("en un canal real el envío mueve la última actividad y la vista previa de la conversación", async () => {
    seedFlow("f1", [send("m", "Hola, ¿en qué te ayudo?")]);
    await executeFlow(fake.asDb(), ctx());
    const conv = fake.rows("conversations")[0];
    expect(conv.last_message_at).toBeTruthy();
    expect(conv.last_message_preview).toBe("Hola, ¿en qué te ayudo?");
  });
});

describe("M-10: si Zernio falla, el flujo se detiene y queda aviso", () => {
  it("cancela la sesión, guarda el mensaje fallido con el motivo y deja una nota en la gestión", async () => {
    sendInboxMessage.mockRejectedValue(Object.assign(new Error("rechazado"), { name: "ZernioApiError", statusCode: 400, body: { error: "Fuera de la ventana de 24 horas" } }));
    fake.seed("cases", [{ id: "case-1", workspace_id: WS, contact_id: "ct-1", status: "open" }]);
    seedFlow("f1", [send("m", "Menú: 1) Precios 2) Pedido"), wait("w"), send("after", "No debería salir")]);
    await executeFlow(fake.asDb(), ctx());

    const session = fake.rows("flow_sessions")[0];
    expect(session).toMatchObject({ status: "cancelled", waiting_for_input: false });
    const failed = fake.rows("messages").find((m) => m.status === "failed");
    expect(failed).toMatchObject({ direction: "outbound", sent_by_flow_id: "f1" });
    expect(String(failed?.error_text)).toContain("Fuera de la ventana");
    expect(fake.rows("case_notes")[0].body).toContain("no pudo enviar");
    // La conversación se mueve para que la bandeja la refresque y muestre el fallo.
    expect(fake.rows("conversations")[0].last_message_at).toBeTruthy();
    expect(sendInboxMessage).toHaveBeenCalledTimes(1);
  });

  it("sin clave de Zernio tampoco sigue como si hubiera salido", async () => {
    sendInboxMessage.mockResolvedValue({ error: { message: "x" }, response: { status: 401 } });
    seedFlow("f1", [send("m", "Hola"), wait("w")]);
    await executeFlow(fake.asDb(), ctx());
    expect(fake.rows("flow_sessions")[0].status).toBe("cancelled");
  });
});

describe("M-7: la baja se respeta en los flujos automáticos", () => {
  it("un flujo de evento no envía al cliente dado de baja", async () => {
    fake.rows("contacts")[0].is_subscribed = false;
    seedFlow("f1", [send("m", "Recordatorio de pago")]);
    await executeFlow(fake.asDb(), ctx({ incomingMessage: {} }));
    expect(sendInboxMessage).not.toHaveBeenCalled();
    expect(fake.rows("analytics_events").find((e) => e.event_type === "message_skipped")).toMatchObject({
      metadata: { reason: "unsubscribed", detail: "El contacto pidió la baja" },
    });
    expect(fake.rows("flow_sessions")[0].status).toBe("cancelled");
  });

  it("una respuesta al mensaje que el cliente acaba de escribir sí sale", async () => {
    fake.rows("contacts")[0].is_subscribed = false;
    seedFlow("f1", [send("m", "Hola de nuevo")]);
    await executeFlow(fake.asDb(), ctx({ incomingMessage: { text: "hola" } }));
    expect(sentTexts()).toEqual(["Hola de nuevo"]);
  });

  it("un cliente suscrito recibe el flujo de evento", async () => {
    seedFlow("f1", [send("m", "Recordatorio de pago")]);
    await executeFlow(fake.asDb(), ctx({ incomingMessage: {} }));
    expect(sentTexts()).toEqual(["Recordatorio de pago"]);
  });
});

describe("M-31: variables del contacto", () => {
  it("{{nombre}} lleva el primer nombre y {{empresa}} el nombre del espacio", async () => {
    seedFlow("f1", [send("m", "Hola {{nombre}}, bienvenida a {{empresa}}")]);
    await executeFlow(fake.asDb(), ctx());
    expect(sentTexts()).toEqual(["Hola María, bienvenida a Muscle Shop"]);
  });

  it("una variable desconocida no llega con llaves: queda vacía", async () => {
    seedFlow("f1", [send("m", "Tu código es {{no_existe}}.")]);
    await executeFlow(fake.asDb(), ctx());
    expect(sentTexts()).toEqual(["Tu código es."]);
  });

  it("si el nombre no parece de persona, {{nombre}} queda vacío", async () => {
    fake.rows("contacts")[0].display_name = "+51 999 111 222";
    seedFlow("f1", [send("m", "Hola {{nombre}}!")]);
    await executeFlow(fake.asDb(), ctx());
    expect(sentTexts()).toEqual(["Hola!"]);
  });
});

describe("M-6: una sola espera por contacto y canal", () => {
  it("cuando un segundo flujo queda esperando, la espera anterior se cancela", async () => {
    seedFlow("f1", [send("a", "Bienvenida"), wait("w1")]);
    seedFlow("f2", [send("b", "Precios"), wait("w2")]);
    await executeFlow(fake.asDb(), ctx({ flowId: "f1" }));
    await executeFlow(fake.asDb(), ctx({ flowId: "f2" }));
    const sessions = fake.rows("flow_sessions");
    expect(sessions.find((s) => s.flow_id === "f1")).toMatchObject({ status: "cancelled", waiting_for_input: false });
    expect(sessions.find((s) => s.flow_id === "f2")).toMatchObject({ status: "active", waiting_for_input: true });
  });

  it("no toca las esperas de otros contactos", async () => {
    fake.seed("flow_sessions", [{ id: "otro", contact_id: "ct-2", flow_id: "f1", channel_id: CH, status: "active", waiting_for_input: true }]);
    seedFlow("f2", [send("b", "Precios"), wait("w2")]);
    await executeFlow(fake.asDb(), ctx({ flowId: "f2" }));
    expect(fake.rows("flow_sessions").find((s) => s.id === "otro")).toMatchObject({ status: "active", waiting_for_input: true });
  });
});

describe("M-15: Ir a flujo", () => {
  it("un flujo que salta a sí mismo se corta en vez de repetir sin fin", async () => {
    seedFlow("f1", [send("a", "Menú"), action("g", { actionType: "goToFlow", flowId: "f1" })]);
    await executeFlow(fake.asDb(), ctx());
    expect(sentTexts()).toEqual(["Menú"]);
    expect(fake.rows("analytics_events").some((e) => e.event_type === "flow_loop_blocked")).toBe(true);
    expect(fake.rows("flow_sessions").every((s) => s.status !== "active")).toBe(true);
  });

  it("un ciclo entre dos flujos también se corta", async () => {
    seedFlow("f1", [send("a", "Uno"), action("g1", { actionType: "goToFlow", flowId: "f2" })]);
    seedFlow("f2", [send("b", "Dos"), action("g2", { actionType: "goToFlow", flowId: "f1" })]);
    await executeFlow(fake.asDb(), ctx());
    expect(sentTexts()).toEqual(["Uno", "Dos"]);
    expect(MAX_GOTO_CHAIN).toBeGreaterThan(2);
  });

  it("salta al flujo de destino y la sesión de origen termina", async () => {
    seedFlow("f1", [send("a", "Te paso con ventas"), action("g", { actionType: "goToFlow", flowId: "f2" })]);
    seedFlow("f2", [send("b", "Ventas: dime tu pedido")]);
    await executeFlow(fake.asDb(), ctx());
    expect(sentTexts()).toEqual(["Te paso con ventas", "Ventas: dime tu pedido"]);
    expect(fake.rows("flow_sessions").find((s) => s.flow_id === "f1")?.status).toBe("completed");
  });

  it("no ejecuta un flujo de otro espacio", async () => {
    seedFlow("ajeno", [send("x", "Flujo de otra tienda")], "published", "ws-otro");
    seedFlow("f1", [action("g", { actionType: "goToFlow", flowId: "ajeno" })]);
    await executeFlow(fake.asDb(), ctx());
    expect(sendInboxMessage).not.toHaveBeenCalled();
  });

  it("no inscribe en una secuencia de otro espacio", async () => {
    fake.seed("sequences", [{ id: "seq-x", workspace_id: "ws-otro", status: "active", steps: [{ type: "message" }] }]);
    seedFlow("f1", [action("e", { actionType: "enrollSequence", sequenceId: "seq-x" })]);
    await executeFlow(fake.asDb(), ctx());
    expect(fake.rows("sequence_enrollments")).toHaveLength(0);
  });
});

describe("M-2: nodo Solicitud HTTP", () => {
  const httpFlow = (data: Record<string, unknown>) =>
    seedFlow("f1", [action("h", { actionType: "httpRequest", method: "POST", ...data }), send("m", "Respuesta: {{resp.ok}}")]);

  it("codifica el texto del cliente: una comilla no rompe el JSON ni la dirección", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: "sí" }), { status: 200 }));
    httpFlow({ url: "https://8.8.8.8/buscar?q={{message}}", body: '{"texto":"{{message}}"}', responseVariable: "resp" });
    await executeFlow(fake.asDb(), ctx({ incomingMessage: { text: 'dijo "hola"&x=1' } }));
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("https://8.8.8.8/buscar?q=dijo%20%22hola%22%26x%3D1");
    expect(JSON.parse(init.body as string)).toEqual({ texto: 'dijo "hola"&x=1' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe("manual");
    expect(sentTexts()).toEqual(["Respuesta: sí"]);
  });

  it("un error 500 no se toma como respuesta válida", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Internal error", { status: 500 }));
    httpFlow({ url: "https://8.8.8.8/x", responseVariable: "resp" });
    await executeFlow(fake.asDb(), ctx());
    expect(fake.rows("analytics_events").find((e) => e.event_type === "http_request_failed")).toMatchObject({ metadata: { reason: "respuesta 500" } });
    expect(sentTexts()).toEqual(["Respuesta:"]);
  });

  it("no llama a direcciones internas ni http", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    for (const url of ["http://8.8.8.8/x", "https://169.254.169.254/latest/meta-data", "https://localhost/x", "https://10.0.0.5/x"]) {
      httpFlow({ url });
      await executeFlow(fake.asDb(), ctx());
      fake.tables.flows = [];
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.rows("analytics_events").filter((e) => e.event_type === "http_request_failed")).toHaveLength(4);
  });
});
