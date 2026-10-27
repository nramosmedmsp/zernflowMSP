import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "./cases/fake-db.test-helper";
import { applyDeliveryEvent, nextDeliveryStatus, recordOutboundSend } from "./outbound-log";

let fake: FakeDb;
const db = () => fake.asDb();
const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  fake = new FakeDb();
  fake.seed("conversations", [{ id: "conv-1", late_conversation_id: "z-1" }]);
});

describe("recordOutboundSend", () => {
  it("guarda el autor y no duplica un reintento con el mismo id", async () => {
    const input = { conversationId: "conv-1", platformMessageId: "wamid.1", text: "Hola", userId: ANA, clientMessageId: "k1", at: "2026-10-27T10:00:00.000Z" };
    await recordOutboundSend(db(), input);
    await recordOutboundSend(db(), input);
    expect(fake.rows("messages")).toHaveLength(1);
    expect(fake.rows("messages")[0]).toMatchObject({ direction: "outbound", sent_by_user_id: ANA, platform_message_id: "wamid.1", status: "sent", client_message_id: "k1" });
  });
});

describe("avisos de entrega", () => {
  it("los ticks avanzan y nunca retroceden", () => {
    expect(nextDeliveryStatus("sent", "message.delivered")).toBe("delivered");
    expect(nextDeliveryStatus("delivered", "message.read")).toBe("read");
    expect(nextDeliveryStatus("read", "message.delivered")).toBeNull();
    expect(nextDeliveryStatus("sent", "message.failed")).toBe("failed");
  });

  it("actualiza el mensaje registrado y guarda el motivo en español", async () => {
    fake.seed("messages", [{ id: "m1", conversation_id: "conv-1", platform_message_id: "wamid.1", direction: "outbound", status: "sent" }]);
    expect(
      await applyDeliveryEvent(db(), {
        lateConversationId: "z-1",
        platformMessageId: "wamid.1",
        event: "message.failed",
        statusAt: "2026-10-27T10:01:00.000Z",
        error: { code: 131047, title: "Re-engagement message" },
      }),
    ).toBe("updated");
    expect(fake.rows("messages")[0]).toMatchObject({
      status: "failed",
      error_code: 131047,
      error_text: "pasaron más de 24 horas desde el último mensaje del cliente",
    });
  });

  it("ignora mensajes que no salieron del CRM", async () => {
    expect(await applyDeliveryEvent(db(), { lateConversationId: "z-1", platformMessageId: "otro", event: "message.read", statusAt: null })).toBe(
      "not_found",
    );
  });
});
