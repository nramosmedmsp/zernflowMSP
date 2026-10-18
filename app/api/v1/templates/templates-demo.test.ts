import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({
  db: null as unknown,
  humanOutbound: [] as unknown[],
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiMember: async () => ({
    ok: true,
    ctx: { supabase: state.db, user: { id: "user-1" }, workspaceId: "ws-1", role: "member" },
  }),
  requireApiAdmin: async () => ({
    ok: true,
    ctx: { supabase: state.db, user: { id: "user-1" }, workspaceId: "ws-1", role: "admin" },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.db,
}));
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

import { GET, POST as createTemplate } from "./route";
import { POST as sendTemplate } from "./send/route";

function seed(lateAccountId = "demo-whatsapp-001") {
  const db = new FakeDb();
  state.db = db;
  const [channel] = db.seed("channels", [
    { workspace_id: "ws-1", platform: "whatsapp", late_account_id: lateAccountId },
  ]);
  const [contact] = db.seed("contacts", [{ workspace_id: "ws-1", display_name: "Camila (Prueba)" }]);
  const [conversation] = db.seed("conversations", [
    {
      workspace_id: "ws-1",
      channel_id: channel.id,
      contact_id: contact.id,
      platform: "whatsapp",
      late_conversation_id: "demo-conv-camila",
      channels: { late_account_id: lateAccountId, platform: "whatsapp" },
    },
  ]);
  return { db, channel, conversation };
}

beforeEach(() => {
  state.humanOutbound = [];
});

describe("GET /api/v1/templates en canal de prueba", () => {
  it("devuelve las dos plantillas de prueba aprobadas", async () => {
    const { conversation } = seed();
    const res = await GET(new NextRequest(`http://localhost/api/v1/templates?conversationId=${conversation.id}`));
    expect(res.status).toBe(200);
    const { templates } = (await res.json()) as { templates: Array<Record<string, unknown>> };
    expect(templates.map((t) => [t.name, t.status, t.variableCount])).toEqual([
      ["recordatorio_recompra", "APPROVED", 1],
      ["seguimiento_pedido", "APPROVED", 2],
    ]);
  });

  it("también por canal", async () => {
    const { channel } = seed();
    const res = await GET(new NextRequest(`http://localhost/api/v1/templates?channelId=${channel.id}`));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/v1/templates en canal de prueba", () => {
  it("no permite crear plantillas", async () => {
    const { channel } = seed();
    const res = await createTemplate(
      new NextRequest("http://localhost/api/v1/templates", {
        method: "POST",
        body: JSON.stringify({ channelId: channel.id, name: "nueva", category: "UTILITY", body: "Hola mundo" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/templates/send en canal de prueba", () => {
  it("guarda el texto de la plantilla con sus variables en lugar de enviarla", async () => {
    const { db, conversation } = seed();
    const res = await sendTemplate(
      new NextRequest("http://localhost/api/v1/templates/send", {
        method: "POST",
        body: JSON.stringify({
          conversationId: conversation.id,
          templateName: "seguimiento_pedido",
          language: "es",
          params: ["Camila", "MS-10482"],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(String(json.text)).toContain("Hola Camila");
    expect(String(json.text)).toContain("MS-10482");
    expect(String(json.text)).not.toContain("{{");
    expect(json).toMatchObject({ direction: "outbound", status: "sent", sent_by_user_id: "user-1" });

    const [saved] = db.rows("messages");
    expect(saved).toMatchObject({ conversation_id: conversation.id, direction: "outbound", text: json.text });
    expect(String(db.rows("conversations")[0].last_message_preview)).toContain("Camila");
    expect(state.humanOutbound).toHaveLength(1);
    expect(state.humanOutbound[0]).toMatchObject({ conversationId: conversation.id, userId: "user-1" });
  });

  it("sigue exigiendo todas las variables", async () => {
    const { db, conversation } = seed();
    const res = await sendTemplate(
      new NextRequest("http://localhost/api/v1/templates/send", {
        method: "POST",
        body: JSON.stringify({ conversationId: conversation.id, templateName: "seguimiento_pedido", language: "es", params: ["Camila", ""] }),
      }),
    );
    expect(res.status).toBe(400);
    expect(db.rows("messages")).toHaveLength(0);
  });
});
