import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({
  db: null as unknown,
  user: { id: "user-1" } as { id: string } | null,
  humanOutbound: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => {
  const client = () => {
    const db = state.db as FakeDb;
    return {
      from: (table: string) => db.from(table),
      rpc: (name: string, args: Record<string, unknown>) => db.rpc(name, args),
      auth: { getUser: async () => ({ data: { user: state.user } }) },
    };
  };
  return { createClient: async () => client(), createServiceClient: async () => client() };
});
vi.mock("@/lib/cases", () => ({
  handleHumanOutboundForConversation: vi.fn(async (_db: unknown, params: unknown) => {
    state.humanOutbound.push(params);
  }),
}));
// Ni la clave ni el cliente de Zernio deben tocarse en canales de prueba.
vi.mock("@/lib/workspace-secrets", () => ({
  getLateApiKey: vi.fn(() => {
    throw new Error("getLateApiKey no debe llamarse en canales de prueba");
  }),
}));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: vi.fn(() => {
    throw new Error("Zernio no debe llamarse en canales de prueba");
  }),
}));

import { GET, POST } from "./route";

/** Conversación sin ID de Zernio (las de prueba no lo necesitan) con su canal embebido. */
function seed(lateAccountId: string) {
  const db = new FakeDb();
  state.db = db;
  const [conversation] = db.seed("conversations", [
    {
      workspace_id: "ws-1",
      channel_id: "ch-1",
      contact_id: "ct-1",
      platform: "whatsapp",
      late_conversation_id: null,
      channels: { late_account_id: lateAccountId },
    },
  ]);
  return { db, conversation };
}

function get(conversationId: string, extra = "") {
  return GET(new NextRequest(`http://localhost/api/v1/messages?conversationId=${conversationId}${extra}`));
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/v1/messages", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  state.user = { id: "user-1" };
  state.humanOutbound = [];
});

describe("GET /api/v1/messages en canal de prueba", () => {
  it("devuelve los mensajes locales ordenados por fecha, en el formato de siempre", async () => {
    const { db, conversation } = seed("demo-whatsapp-001");
    db.seed("messages", [
      { conversation_id: conversation.id, direction: "outbound", text: "segundo", status: "sent", created_at: "2026-10-18T10:05:00.000Z" },
      { conversation_id: conversation.id, direction: "inbound", text: "primero", status: "sent", created_at: "2026-10-18T10:00:00.000Z" },
      { conversation_id: "otra", direction: "inbound", text: "de otra conversación", status: "sent", created_at: "2026-10-18T10:01:00.000Z" },
    ]);
    const res = await get(conversation.id as string);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { messages: Array<Record<string, unknown>>; hasMore: boolean; olderCursor: string | null };
    expect(json.messages.map((m) => m.text)).toEqual(["primero", "segundo"]);
    expect(json.messages[0]).toMatchObject({ conversation_id: conversation.id, direction: "inbound", status: "sent", error: null });
    for (const key of ["id", "conversation_id", "direction", "text", "status", "created_at"]) {
      expect(Object.keys(json.messages[0])).toContain(key);
    }
    expect(json).toMatchObject({ hasMore: false, olderCursor: null });
  });

  it("pagina de los más nuevos a los más antiguos con el cursor", async () => {
    const { db, conversation } = seed("demo-whatsapp-001");
    db.seed(
      "messages",
      [1, 2, 3, 4, 5].map((n) => ({
        conversation_id: conversation.id,
        direction: "inbound",
        text: `m${n}`,
        status: "sent",
        created_at: `2026-10-18T10:0${n}:00.000Z`,
      })),
    );
    const first = (await (await get(conversation.id as string, "&limit=2")).json()) as {
      messages: Array<{ text: string }>;
      hasMore: boolean;
      olderCursor: string;
    };
    expect(first.messages.map((m) => m.text)).toEqual(["m4", "m5"]);
    expect(first.hasMore).toBe(true);

    const second = (await (await get(conversation.id as string, `&limit=2&cursor=${encodeURIComponent(first.olderCursor)}`)).json()) as {
      messages: Array<{ text: string }>;
      hasMore: boolean;
    };
    expect(second.messages.map((m) => m.text)).toEqual(["m2", "m3"]);
    expect(second.hasMore).toBe(true);
  });

  it("sin sesión responde 401", async () => {
    const { conversation } = seed("demo-whatsapp-001");
    state.user = null;
    expect((await get(conversation.id as string)).status).toBe(401);
  });

  it("un canal real sin ID de Zernio sigue respondiendo 404", async () => {
    const { conversation } = seed("69709fcdc955c6705a96ed84");
    const res = await get(conversation.id as string);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/messages en canal de prueba", () => {
  it("guarda el saliente, actualiza la vista previa y corre el motor de gestiones", async () => {
    const { db, conversation } = seed("demo-whatsapp-001");
    const res = await post({ conversationId: conversation.id, text: "Hola, ¿te ayudo con tu pedido?" });
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      conversation_id: conversation.id,
      direction: "outbound",
      text: "Hola, ¿te ayudo con tu pedido?",
      status: "sent",
      sent_by_user_id: "user-1",
    });

    const [saved] = db.rows("messages");
    expect(saved).toMatchObject({
      conversation_id: conversation.id,
      direction: "outbound",
      status: "sent",
      sent_by_user_id: "user-1",
    });
    expect(json.id).toBe(saved.id);

    const [conv] = db.rows("conversations");
    expect(conv.last_message_preview).toBe("Hola, ¿te ayudo con tu pedido?");
    expect(conv.last_message_at).toBe(saved.created_at);

    expect(state.humanOutbound).toHaveLength(1);
    expect(state.humanOutbound[0]).toMatchObject({ conversationId: conversation.id, userId: "user-1" });
  });

  it("valida el cuerpo y la sesión", async () => {
    const { conversation } = seed("demo-whatsapp-001");
    expect((await post({ conversationId: conversation.id })).status).toBe(400);
    expect((await post({ conversationId: conversation.id, text: "Hola", clientMessageId: "no-es-uuid" })).status).toBe(400);
    state.user = null;
    expect((await post({ conversationId: conversation.id, text: "Hola" })).status).toBe(401);
  });
});
