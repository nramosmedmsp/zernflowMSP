import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

// Canal real: la ruta consulta Zernio con un cliente falso.
const state = vi.hoisted(() => ({
  db: null as unknown,
  listCalls: [] as unknown[],
  sendCalls: [] as unknown[],
  listResult: null as unknown,
  sendResult: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => {
  const client = () => {
    const db = state.db as FakeDb;
    return {
      from: (table: string) => db.from(table),
      rpc: (name: string, args: Record<string, unknown>) => db.rpc(name, args),
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    };
  };
  return { createClient: async () => client(), createServiceClient: async () => client() };
});
vi.mock("@/lib/cases", () => ({ handleHumanOutboundForConversation: vi.fn(async () => {}) }));
vi.mock("@/lib/workspace-secrets", () => ({ getLateApiKey: vi.fn(async () => "sk-test") }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: vi.fn(() => ({
    messages: {
      getInboxConversationMessages: vi.fn(async (args: unknown) => {
        state.listCalls.push(args);
        return state.listResult;
      }),
      sendInboxMessage: vi.fn(async (args: unknown) => {
        state.sendCalls.push(args);
        return state.sendResult;
      }),
    },
  })),
}));

import { GET, POST } from "./route";

function seed() {
  const db = new FakeDb();
  state.db = db;
  const [conversation] = db.seed("conversations", [
    {
      workspace_id: "ws-1",
      channel_id: "ch-1",
      contact_id: "ct-1",
      platform: "whatsapp",
      late_conversation_id: "zconv-1",
      channels: { late_account_id: "acc-real-1" },
    },
  ]);
  return conversation.id as string;
}

beforeEach(() => {
  state.listCalls = [];
  state.sendCalls = [];
});

describe("GET /api/v1/messages en canal real", () => {
  it("pide la página más reciente, la devuelve en orden de chat y entrega el cursor anterior", async () => {
    const id = seed();
    state.listResult = {
      data: {
        messages: [
          { id: "wamid.3", direction: "outgoing", message: "¡Sí!", createdAt: "2026-10-27T10:03:00Z", deliveryStatus: "read" },
          { id: "wamid.2", direction: "incoming", message: "¿Tienen isolate?", createdAt: "2026-10-27T10:02:00Z" },
        ],
        pagination: { hasMore: true, nextCursor: "cur-2" },
      },
      response: { status: 200 },
    };
    const res = await GET(new NextRequest(`http://localhost/api/v1/messages?conversationId=${id}&limit=2`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(state.listCalls[0]).toMatchObject({
      path: { conversationId: "zconv-1" },
      query: { accountId: "acc-real-1", limit: 2, sortOrder: "desc" },
    });
    expect(json.messages.map((m: { id: string }) => m.id)).toEqual(["wamid.2", "wamid.3"]);
    expect(json.messages[1]).toMatchObject({ direction: "outbound", status: "read" });
    expect(json).toMatchObject({ hasMore: true, olderCursor: "cur-2" });
  });

  it("pasa el cursor para la página anterior", async () => {
    const id = seed();
    state.listResult = { data: { messages: [], pagination: { hasMore: false, nextCursor: null } }, response: { status: 200 } };
    const res = await GET(new NextRequest(`http://localhost/api/v1/messages?conversationId=${id}&cursor=cur-2`));
    expect((state.listCalls[0] as { query: { cursor?: string } }).query.cursor).toBe("cur-2");
    expect(await res.json()).toMatchObject({ messages: [], hasMore: false, olderCursor: null });
  });

  it("si Zernio falla responde 502 en vez de un chat vacío", async () => {
    const id = seed();
    state.listResult = { data: undefined, error: { error: "boom" }, response: { status: 500 } };
    const res = await GET(new NextRequest(`http://localhost/api/v1/messages?conversationId=${id}`));
    expect(res.status).toBe(502);
  });
});

describe("POST /api/v1/messages en canal real", () => {
  const post = (body: unknown) =>
    POST(
      new NextRequest("http://localhost/api/v1/messages", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );

  it("manda el id del navegador como Idempotency-Key", async () => {
    const id = seed();
    state.sendResult = { data: { success: true, data: { messageId: "wamid.9" } }, response: { status: 200 } };
    const key = "6f1c7a7e-3a52-4c0e-9b8e-2a1d0c9e5f11";
    const res = await post({ conversationId: id, text: "Hola", clientMessageId: key });
    expect(res.status).toBe(201);
    expect(state.sendCalls[0]).toMatchObject({ headers: { "Idempotency-Key": key } });
    expect(await res.json()).toMatchObject({ id: "wamid.9", platform_message_id: "wamid.9", status: "sent" });
  });

  it("un 409 de Zernio (mismo envío en curso) no es un rechazo", async () => {
    const id = seed();
    state.sendResult = { data: undefined, error: { error: "in flight" }, response: { status: 409 } };
    const res = await post({ conversationId: id, text: "Hola", clientMessageId: "6f1c7a7e-3a52-4c0e-9b8e-2a1d0c9e5f11" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "in_progress" });
  });

  it("un rechazo de Zernio responde 502 con el motivo", async () => {
    const id = seed();
    state.sendResult = { data: undefined, error: { error: "Recipient not reachable" }, response: { status: 400 } };
    const res = await post({ conversationId: id, text: "Hola" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Recipient not reachable");
  });
});
