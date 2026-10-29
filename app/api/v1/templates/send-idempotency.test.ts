// M-17: reintentar el envío de una plantilla (respuesta cortada, doble clic) no
// la manda dos veces.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({
  db: null as unknown,
  calls: [] as { headers?: Record<string, string>; body: { templateName: string } }[],
  status: 200,
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiMember: async () => ({
    ok: true,
    ctx: { supabase: state.db, user: { id: "user-1" }, workspaceId: "ws-1", role: "member" },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db }));
vi.mock("@/lib/cases", () => ({ handleHumanOutboundForConversation: vi.fn(async () => {}) }));
vi.mock("@/lib/workspace-secrets", () => ({ getLateApiKey: vi.fn(async () => "key") }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({
    messages: {
      createInboxConversation: async (opts: { headers?: Record<string, string>; body: { templateName: string } }) => {
        state.calls.push(opts);
        if (state.status === 409) return { data: undefined, error: { error: "busy" }, response: { status: 409 } };
        return { data: { data: { messageId: "wamid-1" } }, response: { status: 200 } };
      },
    },
    whatsapp: { getWhatsAppTemplate: async () => ({ data: undefined, error: { error: "no" }, response: { status: 404 } }) },
  }),
}));

import { POST } from "./send/route";

const KEY = "5c0d6f0e-3b0f-4a52-9b53-0a5a1a3f9d11";

function seed() {
  const db = new FakeDb();
  state.db = db;
  state.calls = [];
  state.status = 200;
  db.seed("contacts", [{ id: "ct-1", workspace_id: "ws-1", phone: "+51 987 654 321" }]);
  db.seed("conversations", [
    {
      id: "cv-1",
      workspace_id: "ws-1",
      channel_id: "ch-1",
      contact_id: "ct-1",
      platform: "whatsapp",
      channels: { late_account_id: "acc-1", platform: "whatsapp" },
    },
  ]);
  return db;
}

function post(extra: Record<string, unknown> = {}) {
  return POST(
    new NextRequest("http://localhost/api/v1/templates/send", {
      method: "POST",
      body: JSON.stringify({ conversationId: "cv-1", templateName: "promo", language: "es", params: ["Ana"], ...extra }),
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  seed();
});

describe("POST /api/v1/templates/send con clave de una sola vez", () => {
  it("manda la clave a Zernio como Idempotency-Key", async () => {
    const res = await post({ clientMessageId: KEY });
    expect(res.status).toBe(201);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].headers).toEqual({ "Idempotency-Key": KEY });
  });

  it("el reintento con la misma clave devuelve el mismo mensaje sin volver a enviar", async () => {
    const first = await post({ clientMessageId: KEY });
    const retry = await post({ clientMessageId: KEY });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(state.calls).toHaveLength(1);
    expect(((state.db as FakeDb).rows("messages") ?? []).filter((m) => m.client_message_id === KEY)).toHaveLength(1);
  });

  it("una clave distinta es otro envío", async () => {
    await post({ clientMessageId: KEY });
    await post({ clientMessageId: "7a1b6f0e-3b0f-4a52-9b53-0a5a1a3f9d22" });
    expect(state.calls).toHaveLength(2);
  });

  it("si Zernio todavía procesa la misma clave (409) responde que ya se está enviando", async () => {
    state.status = 409;
    const res = await post({ clientMessageId: KEY });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("in_progress");
    expect((state.db as FakeDb).rows("messages")).toHaveLength(0);
  });

  it("rechaza una clave que no es un UUID", async () => {
    const res = await post({ clientMessageId: "no-es-uuid" });
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it("sin clave sigue funcionando como antes", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(state.calls[0].headers).toBeUndefined();
  });
});
