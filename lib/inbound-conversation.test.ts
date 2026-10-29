import { describe, expect, it } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { prepareInboundMessage, recordInboundConversation } from "./inbound-conversation";

function message(db: FakeDb, contactId: string, preview: string) {
  return recordInboundConversation(db.asDb(), {
    workspaceId: "ws-1",
    channelId: "ch-1",
    contactId,
    platform: "whatsapp",
    lateConversationId: "zconv-1",
    preview,
    at: "2026-10-27T10:00:00.000Z",
  });
}

describe("recordInboundConversation", () => {
  it("un chat nuevo queda con 1 no leído", async () => {
    const db = new FakeDb();
    await message(db, "ct-1", "Hola");
    expect(db.rows("conversations")).toHaveLength(1);
    expect(db.rows("conversations")[0]).toMatchObject({ unread_count: 1, last_message_preview: "Hola", status: "open" });
  });

  it("cada mensaje de un cliente que vuelve suma uno (antes se quedaba en 2)", async () => {
    const db = new FakeDb();
    db.seed("conversations", [{ workspace_id: "ws-1", channel_id: "ch-1", contact_id: "ct-1", platform: "whatsapp", unread_count: 0 }]);
    await message(db, "ct-1", "uno");
    await message(db, "ct-1", "dos");
    await message(db, "ct-1", "tres");
    expect(db.rows("conversations")).toHaveLength(1);
    expect(db.rows("conversations")[0]).toMatchObject({ unread_count: 3, last_message_preview: "tres" });
  });
});

describe("recordInboundConversation: último mensaje del cliente (A-8)", () => {
  it("sella last_inbound_at con cada mensaje entrante, también en canales reales", async () => {
    const db = new FakeDb();
    await message(db, "ct-1", "Hola");
    expect(db.rows("conversations")[0].last_inbound_at).toBe("2026-10-27T10:00:00.000Z");
    await recordInboundConversation(db.asDb(), {
      workspaceId: "ws-1",
      channelId: "ch-1",
      contactId: "ct-1",
      platform: "whatsapp",
      lateConversationId: "zconv-1",
      preview: "Otra",
      at: "2026-10-28T09:00:00.000Z",
    });
    expect(db.rows("conversations")[0].last_inbound_at).toBe("2026-10-28T09:00:00.000Z");
  });

  it("si no se puede sumar el no leído devuelve null para que el webhook pida reintento (M-16)", async () => {
    const db = new FakeDb();
    db.asDb().rpc = (async () => ({ data: null, error: { message: "caída" } })) as never;
    expect(await message(db, "ct-1", "Hola")).toBeNull();
  });

  it("si falla el guardado de la conversación devuelve null (M-16)", async () => {
    const db = new FakeDb();
    db.failNext.set("conversations", "upsert");
    expect(await message(db, "ct-1", "Hola")).toBeNull();
  });
});

describe("prepareInboundMessage (M-8, M-16)", () => {
  const channel = { id: "ch-1", workspace_id: "ws-1", platform: "whatsapp" as const };
  const input = (over: Partial<Parameters<typeof prepareInboundMessage>[1]> = {}) => ({
    channel,
    senderId: "51999",
    senderName: "Lucía",
    senderPicture: null,
    senderUsername: null,
    lateConversationId: "zconv-1",
    preview: "Hola",
    at: "2026-10-27T10:00:00.000Z",
    ...over,
  });

  it("un número nuevo crea contacto, vínculo, chat y un no leído", async () => {
    const db = new FakeDb();
    db.unique("contact_channels", ["channel_id", "platform_sender_id"]);
    const res = await prepareInboundMessage(db.asDb(), input());
    expect(res).toMatchObject({ ok: true, existed: false });
    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("contact_channels")).toHaveLength(1);
    expect(db.rows("conversations")[0]).toMatchObject({ unread_count: 1 });
  });

  it("dos mensajes casi simultáneos de un número nuevo dejan un solo contacto y un solo chat", async () => {
    const db = new FakeDb();
    db.unique("contact_channels", ["channel_id", "platform_sender_id"]);
    // Mientras el segundo mensaje crea su contacto, el primero registra el vínculo primero.
    let winner = "";
    db.beforeInsert.set("contact_channels", () => {
      db.beforeInsert.delete("contact_channels");
      const [c] = db.seed("contacts", [{ workspace_id: "ws-1", display_name: "Lucía" }]);
      winner = c.id as string;
      db.seed("contact_channels", [{ contact_id: winner, channel_id: "ch-1", platform_sender_id: "51999" }]);
    });
    const res = await prepareInboundMessage(db.asDb(), input());
    expect(res).toMatchObject({ ok: true, existed: true, contactId: winner });
    // El contacto recién creado por el perdedor se borró: no queda un huérfano.
    expect(db.rows("contacts").map((c) => c.id)).toEqual([winner]);
    expect(db.rows("contact_channels")).toHaveLength(1);
    expect(db.rows("conversations")).toHaveLength(1);
    expect(db.rows("conversations")[0].contact_id).toBe(winner);
    // Y solo el ganador registra el evento de contacto creado.
    expect(db.rows("analytics_events").filter((e) => e.event_type === "contact_created")).toHaveLength(0);
  });

  it("si no se puede guardar el contacto avisa del fallo en vez de seguir", async () => {
    const db = new FakeDb();
    db.failNext.set("contacts", "insert");
    const res = await prepareInboundMessage(db.asDb(), input());
    expect(res).toMatchObject({ ok: false });
  });

  it("si falla el chat avisa del fallo (el webhook responde con error y Zernio reintenta)", async () => {
    const db = new FakeDb();
    db.failNext.set("conversations", "upsert");
    const res = await prepareInboundMessage(db.asDb(), input());
    expect(res).toMatchObject({ ok: false });
    // El contacto nuevo no queda a medias: el reintento lo trata como número nuevo (con bienvenida).
    expect(db.rows("contacts")).toHaveLength(0);
  });

  it("un número que ya existe se reconoce y no se vuelve a crear", async () => {
    const db = new FakeDb();
    db.unique("contact_channels", ["channel_id", "platform_sender_id"]);
    await prepareInboundMessage(db.asDb(), input());
    const again = await prepareInboundMessage(db.asDb(), input({ preview: "Otra vez" }));
    expect(again).toMatchObject({ ok: true, existed: true });
    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("conversations")[0]).toMatchObject({ unread_count: 2 });
  });
});
