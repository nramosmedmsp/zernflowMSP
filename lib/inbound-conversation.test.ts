import { describe, expect, it } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { recordInboundConversation } from "./inbound-conversation";

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
