import { describe, expect, it, vi } from "vitest";
import { FakeDb } from "./cases/fake-db.test-helper";
import { zernioMessenger } from "./cases/messaging";
import { demoConversationByLateId, demoConversationByPhone, storeDemoMessage } from "./demo-messages";

// En canales de prueba nunca se debe pedir la clave de Zernio ni crear el cliente.
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

const WS = "ws-1";

function seed() {
  const db = new FakeDb();
  const [channel] = db.seed("channels", [
    { workspace_id: WS, platform: "whatsapp", late_account_id: "demo-whatsapp-001" },
  ]);
  const [contact] = db.seed("contacts", [{ workspace_id: WS, display_name: "Camila (Prueba)" }]);
  db.seed("contact_channels", [
    { contact_id: contact.id, channel_id: channel.id, platform_sender_id: "51900000001" },
  ]);
  const [conversation] = db.seed("conversations", [
    {
      workspace_id: WS,
      channel_id: channel.id,
      contact_id: contact.id,
      platform: "whatsapp",
      late_conversation_id: "demo-conv-camila",
    },
  ]);
  return { db, channel, contact, conversation };
}

describe("storeDemoMessage", () => {
  it("guarda el mensaje y actualiza la vista previa de la conversación", async () => {
    const { db, conversation } = seed();
    const res = await storeDemoMessage(db.asDb(), {
      conversationId: conversation.id as string,
      direction: "outbound",
      text: "Hola, ¿en qué te ayudo?",
      at: "2026-10-18T15:00:00.000Z",
      sentByUserId: "user-1",
    });
    expect(res.ok).toBe(true);
    const [message] = db.rows("messages");
    expect(message).toMatchObject({
      conversation_id: conversation.id,
      direction: "outbound",
      text: "Hola, ¿en qué te ayudo?",
      status: "sent",
      sent_by_user_id: "user-1",
    });
    expect(String(message.platform_message_id)).toMatch(/^demo-/);
    const [conv] = db.rows("conversations");
    expect(conv.last_message_at).toBe("2026-10-18T15:00:00.000Z");
    expect(conv.last_message_preview).toBe("Hola, ¿en qué te ayudo?");
  });

  it("no toca la conversación con touchConversation en false", async () => {
    const { db, conversation } = seed();
    await storeDemoMessage(db.asDb(), {
      conversationId: conversation.id as string,
      direction: "inbound",
      text: "Hola",
      touchConversation: false,
    });
    expect(db.rows("conversations")[0].last_message_preview).toBeUndefined();
    expect(db.rows("messages")).toHaveLength(1);
  });
});

describe("conversaciones de prueba", () => {
  it("busca por ID de conversación falso y por teléfono", async () => {
    const { db, conversation } = seed();
    expect(await demoConversationByLateId(db.asDb(), WS, "demo-conv-camila")).toBe(conversation.id);
    expect(await demoConversationByLateId(db.asDb(), WS, "otra")).toBeNull();
    const params = { workspaceId: WS, lateAccountId: "demo-whatsapp-001" };
    expect(await demoConversationByPhone(db.asDb(), { ...params, phone: "51900000001" })).toBe(conversation.id);
    expect(await demoConversationByPhone(db.asDb(), { ...params, phone: "+51 900 000 001" })).toBe(conversation.id);
    expect(await demoConversationByPhone(db.asDb(), { ...params, phone: "51999999999" })).toBeNull();
  });

  it("crea la conversación si el contacto está vinculado al canal y aún no tiene", async () => {
    const { db, channel } = seed();
    const [other] = db.seed("contacts", [{ workspace_id: WS, display_name: "Bruno (Prueba)" }]);
    db.seed("contact_channels", [{ contact_id: other.id, channel_id: channel.id, platform_sender_id: "51900000016" }]);
    const id = await demoConversationByPhone(db.asDb(), {
      workspaceId: WS,
      lateAccountId: "demo-whatsapp-001",
      phone: "51900000016",
    });
    expect(id).toBeTruthy();
    const created = db.rows("conversations").find((c) => c.id === id);
    expect(created).toMatchObject({ contact_id: other.id, platform: "whatsapp" });
    expect(String(created?.late_conversation_id)).toMatch(/^demo-conv-/);
  });
});

describe("zernioMessenger en canales de prueba", () => {
  it("sendText guarda el mensaje sin llamar a Zernio (respuesta fuera de horario, difusiones, secuencias)", async () => {
    const { db, conversation } = seed();
    const res = await zernioMessenger(db.asDb()).sendText({
      workspaceId: WS,
      lateConversationId: "demo-conv-camila",
      lateAccountId: "demo-whatsapp-001",
      text: "Estamos fuera de horario. Abrimos el lunes 9:00",
    });
    expect(res.ok).toBe(true);
    expect(db.rows("messages")).toHaveLength(1);
    expect(db.rows("messages")[0]).toMatchObject({
      conversation_id: conversation.id,
      direction: "outbound",
      text: "Estamos fuera de horario. Abrimos el lunes 9:00",
    });
  });

  it("sendTemplate guarda el texto de la plantilla con sus variables", async () => {
    const { db, conversation } = seed();
    const res = await zernioMessenger(db.asDb()).sendTemplate({
      workspaceId: WS,
      lateAccountId: "demo-whatsapp-001",
      phone: "51900000001",
      templateName: "recordatorio_recompra",
      language: "es",
      params: ["Camila"],
    });
    expect(res.ok).toBe(true);
    const [message] = db.rows("messages");
    expect(message.conversation_id).toBe(conversation.id);
    expect(String(message.text)).toContain("Hola Camila,");
    expect(String(message.text)).not.toContain("{{");
    expect(String(db.rows("conversations")[0].last_message_preview)).toContain("Camila");
  });

  it("storeDemoMessages en false no guarda (el nodo de plantilla de los flujos guarda el suyo)", async () => {
    const { db } = seed();
    const res = await zernioMessenger(db.asDb(), { storeDemoMessages: false }).sendTemplate({
      workspaceId: WS,
      lateAccountId: "demo-whatsapp-001",
      phone: "51900000001",
      templateName: "recordatorio_recompra",
      language: "es",
      params: ["Camila"],
    });
    expect(res.ok).toBe(true);
    expect(db.rows("messages")).toHaveLength(0);
  });

  it("avisa si no existe la conversación de prueba", async () => {
    const { db } = seed();
    const res = await zernioMessenger(db.asDb()).sendText({
      workspaceId: WS,
      lateConversationId: "no-existe",
      lateAccountId: "demo-whatsapp-001",
      text: "Hola",
    });
    expect(res.ok).toBe(false);
  });
});
