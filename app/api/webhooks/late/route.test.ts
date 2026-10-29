// M-16: el contacto y el chat se guardan ANTES de responder "ok" a Zernio. Si
// fallan, el webhook responde con error y libera el id del evento para que el
// reintento de Zernio no se tome por duplicado.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const { state, runInboundPipeline } = vi.hoisted(() => ({
  state: { db: null as unknown, after: [] as Array<() => Promise<void> | void> },
  runInboundPipeline: vi.fn(async () => undefined),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (cb: () => Promise<void> | void) => {
    state.after.push(cb);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db }));
vi.mock("@/lib/zernio-webhook", () => ({
  pickChannelBySignature: async (_s: unknown, channels: unknown[]) => ({ ok: true, channel: channels[0] }),
}));
vi.mock("@/lib/inbound-pipeline", () => ({ runInboundPipeline }));
vi.mock("@/lib/workspace-secrets", () => ({ getLateApiKey: async () => null }));

import { NextRequest } from "next/server";
import { POST } from "./route";

const payload = {
  id: "evt-1",
  event: "message.received",
  message: {
    id: "m1",
    conversationId: "z-1",
    platform: "whatsapp",
    platformMessageId: "wamid.1",
    direction: "incoming",
    text: "Hola",
    attachments: [],
    sender: { id: "51999111222", name: "Lucía", username: null, picture: null },
    sentAt: "2026-10-28T10:00:00Z",
    isRead: false,
  },
  conversation: { id: "z-1", platformConversationId: null, participantId: "51999111222", participantName: "Lucía", participantUsername: null, participantPicture: null, status: "active" },
  account: { id: "acc-real", platform: "whatsapp", username: "tienda", displayName: "Tienda" },
  timestamp: "2026-10-28T10:00:00Z",
};

const call = () =>
  POST(new NextRequest("https://app.test/api/webhooks/late", { method: "POST", body: JSON.stringify(payload), headers: { "x-late-signature": "x" } }));

let db: FakeDb;
beforeEach(() => {
  runInboundPipeline.mockClear();
  state.after = [];
  db = new FakeDb();
  db.unique("webhook_events", ["event_id"]);
  db.unique("contact_channels", ["channel_id", "platform_sender_id"]);
  db.seed("channels", [{ id: "ch-1", workspace_id: "ws-1", platform: "whatsapp", late_account_id: "acc-real", is_active: true, username: "tienda" }]);
  state.db = db;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("webhook de mensajes entrantes", () => {
  it("guarda contacto y chat antes de responder y deja el resto para después", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("conversations")[0]).toMatchObject({ unread_count: 1, last_message_preview: "Hola" });
    expect(db.rows("conversations")[0].last_inbound_at).toBeTruthy();
    // Aún no corrió el bot: va en after().
    expect(runInboundPipeline).not.toHaveBeenCalled();
    for (const cb of state.after) await cb();
    expect(runInboundPipeline).toHaveBeenCalledOnce();
    expect(runInboundPipeline.mock.calls[0]).toBeDefined();
  });

  it("si la base falla al registrar la conversación responde 500 y libera el evento para el reintento", async () => {
    db.failNext.set("conversations", "upsert");
    const res = await call();
    expect(res.status).toBe(500);
    expect(db.rows("webhook_events")).toHaveLength(0);
    expect(state.after).toHaveLength(0);

    // Reintento de Zernio con el mismo id: ahora sí se procesa (no es duplicado).
    const retry = await call();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ queued: true });
    expect(db.rows("conversations")).toHaveLength(1);
    expect(db.rows("contacts")).toHaveLength(1);
    // Sigue siendo un número nuevo: conserva el flujo de bienvenida.
    for (const cb of state.after) await cb();
    expect((runInboundPipeline.mock.calls[0] as unknown[])[1]).toMatchObject({ isFirstMessage: true });
  });

  it("un evento repetido ya procesado se ignora", async () => {
    await call();
    const again = await call();
    expect(await again.json()).toMatchObject({ skipped: true, reason: "duplicate_event" });
    expect(db.rows("conversations")[0].unread_count).toBe(1);
  });
});
