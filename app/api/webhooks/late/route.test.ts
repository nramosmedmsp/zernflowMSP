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
  // SEG-03: el webhook descarta lo viejo; el evento de prueba nace "ahora".
  timestamp: new Date().toISOString(),
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
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
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

  it("si la base falla al registrar la conversación responde 500 y deja el evento pendiente para el reintento", async () => {
    db.failNext.set("conversations", "upsert");
    const res = await call();
    expect(res.status).toBe(500);
    // CONF-06: el evento NO se pierde ni se da por visto: queda guardado, sin candado, con su cuerpo y el error.
    expect(db.rows("webhook_events")).toHaveLength(1);
    expect(db.rows("webhook_events")[0]).toMatchObject({ status: "received", locked_until: null, attempts: 1 });
    expect(db.rows("webhook_events")[0].payload).toMatchObject({ text: "Hola" });
    expect(db.rows("webhook_events")[0].last_error).toBeTruthy();
    expect(state.after).toHaveLength(0);

    // Reintento de Zernio con el mismo id: ahora sí se procesa (no es duplicado).
    const retry = await call();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ queued: true });
    expect(db.rows("conversations")).toHaveLength(1);
    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("webhook_events")[0]).toMatchObject({ status: "stored", attempts: 2 });
    // Sigue siendo un número nuevo: conserva el flujo de bienvenida.
    for (const cb of state.after) await cb();
    expect((runInboundPipeline.mock.calls[0] as unknown[])[1]).toMatchObject({ isFirstMessage: true });
    expect(db.rows("webhook_events")[0]).toMatchObject({ status: "processed", payload: null });
  });

  it("si la función se corta tras guardar el chat (el trabajo posterior nunca corre), el reintento lo retoma sin duplicar", async () => {
    const first = await call();
    expect(first.status).toBe(200);
    // La función murió: los after() del primer intento no llegan a ejecutarse.
    state.after = [];
    expect(runInboundPipeline).not.toHaveBeenCalled();
    // Mientras sigue el candado, la repetición es un duplicado (otro lo está procesando).
    expect(await (await call()).json()).toMatchObject({ skipped: true, reason: "duplicate_event" });

    db.rows("webhook_events")[0].locked_until = new Date(Date.now() - 1000).toISOString();
    const retry = await call();
    expect(await retry.json()).toMatchObject({ queued: true });
    for (const cb of state.after) await cb();

    expect(runInboundPipeline).toHaveBeenCalledOnce();
    expect(db.rows("conversations")).toHaveLength(1);
    expect(db.rows("conversations")[0].unread_count).toBe(1);
    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("webhook_events")[0]).toMatchObject({ status: "processed", attempts: 2 });
  });

  it("si el trabajo posterior falla, el evento queda pendiente (con el error) para el barrido del cron", async () => {
    runInboundPipeline.mockRejectedValueOnce(new Error("Zernio caído"));
    await call();
    for (const cb of state.after) await cb(); // no lanza
    expect(db.rows("webhook_events")[0]).toMatchObject({ status: "stored", last_error: "Zernio caído" });
    expect(db.rows("conversations")[0].unread_count).toBe(1);
  });

  it("un evento repetido ya procesado se ignora", async () => {
    await call();
    const again = await call();
    expect(await again.json()).toMatchObject({ skipped: true, reason: "duplicate_event" });
    expect(db.rows("conversations")[0].unread_count).toBe(1);
  });

  it("el mismo evento dos veces seguidas procesa el mensaje una sola vez", async () => {
    await call();
    await call();
    for (const cb of state.after) await cb();
    expect(runInboundPipeline).toHaveBeenCalledOnce();
    expect(db.rows("conversations")[0].unread_count).toBe(1);
    expect(db.rows("webhook_events")).toHaveLength(1);
  });

  it("un evento sin id queda igual en la bandeja (por el id del mensaje) y se deduplica", async () => {
    const noId = { ...payload, id: undefined };
    const send = () => POST(new NextRequest("https://app.test/api/webhooks/late", { method: "POST", body: JSON.stringify(noId), headers: { "x-late-signature": "x" } }));
    await send();
    expect(db.rows("webhook_events")[0].event_id).toBe("pm:acc-real:wamid.1");
    expect(await (await send()).json()).toMatchObject({ skipped: true });
  });
});

// SEG-02: nada interno hacia fuera y nada de revientos antes de verificar la firma.
describe("webhook: respuestas genéricas", () => {
  const raw = (body: string) =>
    POST(new NextRequest("https://app.test/api/webhooks/late", { method: "POST", body, headers: { "x-late-signature": "x" } }));

  it("un cuerpo incompleto responde 400 genérico, sin lanzar ni tocar la base", async () => {
    const touched = vi.spyOn(db, "from");
    for (const body of [
      JSON.stringify({ event: "message.received" }),
      JSON.stringify({ event: "message.received", message: { direction: "incoming" }, account: { id: "acc-real" } }),
      JSON.stringify({ event: "message.received", message: { sender: {} }, conversation: { id: "z" }, account: { id: "a" } }),
      JSON.stringify({ event: "comment.received" }),
      JSON.stringify({ event: "comment.received", comment: { id: "c" } }),
      "[]",
      "null",
    ]) {
      const res = await raw(body);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(JSON.stringify(json)).not.toMatch(/undefined|Cannot read|TypeError/);
    }
    expect(touched).not.toHaveBeenCalled();
  });

  it("un cuerpo que no es JSON responde 400", async () => {
    expect((await raw("{no es json")).status).toBe(400);
  });

  it("si algo interno falla responde 500 genérico y el detalle solo va al registro", async () => {
    state.db = {
      from() {
        throw new Error("password authentication failed for user postgres at 10.0.0.5");
      },
    };
    const res = await call();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ error: "Internal server error" }));
    expect(text).not.toMatch(/password|postgres|10\.0/);
    expect(console.error).toHaveBeenCalledWith("Webhook handler error:", expect.any(Error));
  });

  it("un evento ignorado (otro tipo) sigue respondiendo ok", async () => {
    const res = await raw(JSON.stringify({ event: "algo.raro", id: "e" }));
    expect(await res.json()).toMatchObject({ ok: true, skipped: true });
  });
});

// SEG-03: reenvíos viejos y el id del evento.
describe("webhook: reenvíos viejos y id del evento", () => {
  const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const send = (body: unknown, headers: Record<string, string> = {}) =>
    POST(
      new NextRequest("https://app.test/api/webhooks/late", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "x-late-signature": "x", ...headers },
      }),
    );

  it("descarta un mensaje firmado de hace días (200 para que Zernio no reintente) sin guardar nada", async () => {
    const res = await send({ ...payload, id: "evt-viejo", timestamp: hours(72) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: true, reason: "stale_event" });
    expect(db.rows("webhook_events")).toHaveLength(0);
    expect(db.rows("contacts")).toHaveLength(0);
    expect(db.rows("conversations")).toHaveLength(0);
  });

  it("acepta un reintento atrasado de unas horas (reintento normal de Zernio)", async () => {
    const res = await send({ ...payload, id: "evt-tarde", timestamp: hours(5) });
    expect(await res.json()).toMatchObject({ queued: true });
    expect(db.rows("webhook_events")).toHaveLength(1);
  });

  it("descarta también estados de entrega y comentarios viejos", async () => {
    const delivery = await send({
      id: "evt-d",
      event: "message.delivered",
      message: { conversationId: "z-1", platformMessageId: "wamid.9" },
      account: { id: "acc-real" },
      timestamp: hours(100),
    });
    expect(await delivery.json()).toMatchObject({ skipped: true, reason: "stale_event" });
    const comment = await send({
      id: "evt-c",
      event: "comment.received",
      comment: { id: "c1", postId: "p", platformPostId: "pp", platform: "instagram", text: "hola", author: { id: "a" }, createdAt: hours(100), isReply: false, parentCommentId: null },
      account: { id: "acc-real", platform: "instagram", username: "otra" },
      timestamp: hours(100),
    });
    expect(await comment.json()).toMatchObject({ skipped: true, reason: "stale_event" });
    expect(db.rows("webhook_events")).toHaveLength(0);
  });

  it("la cabecera x-late-event-id (sin firma) no sirve para evitar la anti-repetición", async () => {
    await send(payload, { "x-late-event-id": "uno" });
    const again = await send(payload, { "x-late-event-id": "otro-distinto" });
    expect(await again.json()).toMatchObject({ skipped: true, reason: "duplicate_event" });
    expect(db.rows("webhook_events")).toHaveLength(1);
    expect(db.rows("webhook_events")[0].event_id).toBe("evt-1");
  });

  it("sin id en el cuerpo y sin id de mensaje se deriva del cuerpo (no de la cabecera) y se deduplica", async () => {
    const body = { ...payload, id: undefined, message: { ...payload.message, platformMessageId: "" } };
    await send(body, { "x-late-event-id": "a" });
    const again = await send(body, { "x-late-event-id": "b" });
    expect(await again.json()).toMatchObject({ skipped: true, reason: "duplicate_event" });
    expect(db.rows("webhook_events")).toHaveLength(1);
    expect(String(db.rows("webhook_events")[0].event_id)).toMatch(/^body:[0-9a-f]{64}$/);
  });

  it("un estado de entrega sin la cuenta responde 400 genérico", async () => {
    const res = await send({ id: "e", event: "message.read", message: {} });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid payload" });
  });
});
