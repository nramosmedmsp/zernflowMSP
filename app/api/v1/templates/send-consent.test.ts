// SEG-08 / PRIV-05: el envío manual de plantillas respeta el consentimiento según la
// categoría de la plantilla (servicio o publicidad).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { clearTemplateKindCache } from "@/lib/template-category";

const state = vi.hoisted(() => ({
  db: null as unknown,
  sent: 0,
  category: "MARKETING" as string | null,
  lookupFails: false,
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
      createInboxConversation: async () => {
        state.sent++;
        return { data: { data: { messageId: "wamid-1" } }, response: { status: 200 } };
      },
    },
    whatsapp: {
      getWhatsAppTemplate: async () =>
        state.lookupFails
          ? { data: undefined, error: { error: "no" }, response: { status: 404 } }
          : { data: { template: { category: state.category } }, response: { status: 200 } },
    },
  }),
}));

import { POST } from "./send/route";

function seed(contact: Record<string, unknown>, lateAccountId = "acc-1") {
  const db = new FakeDb();
  state.db = db;
  db.seed("contacts", [{ id: "ct-1", workspace_id: "ws-1", phone: "+51 987 654 321", ...contact }]);
  db.seed("conversations", [
    {
      id: "cv-1",
      workspace_id: "ws-1",
      channel_id: "ch-1",
      contact_id: "ct-1",
      platform: "whatsapp",
      channels: { late_account_id: lateAccountId, platform: "whatsapp" },
    },
  ]);
}

function post(templateName = "promo") {
  return POST(
    new NextRequest("http://localhost/api/v1/templates/send", {
      method: "POST",
      body: JSON.stringify({ conversationId: "cv-1", templateName, language: "es", params: ["Ana"] }),
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  clearTemplateKindCache();
  state.sent = 0;
  state.category = "MARKETING";
  state.lookupFails = false;
});

describe("plantilla de publicidad", () => {
  it("no sale a quien se dio de baja y explica que solo hay plantillas de servicio", async () => {
    seed({ marketing_status: "opted_out", is_subscribed: false });
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "opted_out", error: expect.stringContaining("plantillas de servicio") });
    expect(state.sent).toBe(0);
  });

  it("no sale a quien no tiene consentimiento registrado", async () => {
    seed({ marketing_status: "unknown" });
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "consent_required", error: expect.stringContaining("aún no aceptó") });
    expect(state.sent).toBe(0);
  });

  it("sale a quien aceptó publicidad", async () => {
    seed({ marketing_status: "accepted" });
    expect((await post()).status).toBe(201);
    expect(state.sent).toBe(1);
  });
});

describe("plantilla de servicio", () => {
  it("sale a cualquiera, también a quien se dio de baja", async () => {
    state.category = "UTILITY";
    for (const contact of [{ marketing_status: "opted_out", is_subscribed: false }, { marketing_status: "unknown" }, {}]) {
      seed(contact);
      expect((await post()).status).toBe(201);
    }
    expect(state.sent).toBe(3);
  });
});

describe("categoría que no se puede saber", () => {
  it("se trata como publicidad y se le dice a la persona en palabras claras", async () => {
    state.lookupFails = true;
    seed({ marketing_status: "unknown" });
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("No pudimos saber si esta plantilla es de servicio o de publicidad");
    expect(state.sent).toBe(0);
  });

  it("con consentimiento igual sale", async () => {
    state.lookupFails = true;
    seed({ marketing_status: "accepted" });
    expect((await post()).status).toBe(201);
  });
});

describe("canal de prueba", () => {
  it("usa la categoría de las plantillas de prueba", async () => {
    seed({ marketing_status: "unknown" }, "demo-whatsapp-001");
    const blocked = await post("recordatorio_recompra");
    expect(blocked.status).toBe(403);
    const allowed = await post("seguimiento_pedido");
    expect(allowed.status).toBe(201);
  });
});
