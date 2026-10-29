// A-8: la "Respuesta con IA" arma el historial con los mensajes de Zernio (en
// canales reales no están en `messages`), agrega lo que el cliente acaba de
// escribir y usa instrucciones en español por defecto.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import type { FlowExecutionContext } from "../types";
import { aiMessagesFromLocal, aiMessagesFromZernio, DEFAULT_AI_SYSTEM_PROMPT, withCurrentMessage } from "./ai-history";

const { generateText, getMessages, sendMessage } = vi.hoisted(() => ({
  generateText: vi.fn(),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock("ai", () => ({ generateText, createGateway: () => (model: string) => model }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ messages: { getInboxConversationMessages: getMessages, sendInboxMessage: sendMessage } }),
}));
vi.mock("@/lib/workspace-secrets", () => ({
  getWorkspaceSecrets: async () => ({ lateApiKey: "key", aiApiKey: "ai-key" }),
}));

import { executeAiResponse } from "./ai-response";

const zmsg = (id: string, direction: "incoming" | "outgoing", message: string, at: string) => ({ id, direction, message, createdAt: at });

describe("historial de la IA", () => {
  it("de Zernio: ordena del más antiguo al más nuevo, limita y traduce roles", () => {
    const out = aiMessagesFromZernio(
      [
        zmsg("3", "outgoing", "Claro, vale 80 soles", "2026-10-28T10:02:00Z"),
        zmsg("1", "incoming", "Hola", "2026-10-28T10:00:00Z"),
        zmsg("2", "outgoing", "Hola, ¿en qué te ayudo?", "2026-10-28T10:01:00Z"),
        zmsg("4", "incoming", "", "2026-10-28T10:03:00Z"),
      ],
      3,
    );
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(out.map((m) => m.content)).toEqual(["Hola", "Hola, ¿en qué te ayudo?", "Claro, vale 80 soles"]);
    // Con un límite menor quedan los más recientes.
    expect(aiMessagesFromZernio([zmsg("1", "incoming", "a", "2026-10-28T10:00:00Z"), zmsg("2", "incoming", "b", "2026-10-28T10:01:00Z")], 1)).toEqual([
      { role: "user", content: "b" },
    ]);
  });

  it("local: invierte el orden de más reciente a más antiguo", () => {
    expect(
      aiMessagesFromLocal([
        { direction: "outbound", text: "b" },
        { direction: "inbound", text: "a" },
        { direction: "inbound", text: null },
      ]),
    ).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
  });

  it("agrega el mensaje actual solo si el historial no lo trae", () => {
    const history = [{ role: "user" as const, content: "precio" }];
    expect(withCurrentMessage(history, "precio")).toEqual(history);
    expect(withCurrentMessage(history, "¿y el envío?")).toEqual([...history, { role: "user", content: "¿y el envío?" }]);
    expect(withCurrentMessage([], "hola")).toEqual([{ role: "user", content: "hola" }]);
    expect(withCurrentMessage([], undefined)).toEqual([]);
  });

  it("las instrucciones por defecto están en español", () => {
    expect(DEFAULT_AI_SYSTEM_PROMPT).toMatch(/español/);
    expect(DEFAULT_AI_SYSTEM_PROMPT).not.toMatch(/helpful customer support agent/i);
  });
});

describe("executeAiResponse en un canal real", () => {
  let db: FakeDb;
  const context = (over: Partial<FlowExecutionContext> = {}): FlowExecutionContext => ({
    triggerId: "t",
    flowId: "f1",
    channelId: "ch-1",
    contactId: "ct-1",
    conversationId: "cv-1",
    workspaceId: "ws-1",
    lateConversationId: "z-1",
    lateAccountId: "acc-real",
    incomingMessage: { text: "¿Cuánto cuesta el envío?" },
    variables: {},
    ...over,
  });

  beforeEach(() => {
    generateText.mockReset();
    getMessages.mockReset();
    sendMessage.mockReset();
    db = new FakeDb();
    db.seed("channels", [{ id: "ch-1", workspace_id: "ws-1", platform: "whatsapp", late_account_id: "acc-real" }]);
    db.seed("conversations", [{ id: "cv-1", workspace_id: "ws-1", channel_id: "ch-1", contact_id: "ct-1", platform: "whatsapp" }]);
    db.seed("flow_sessions", [{ id: "s1", contact_id: "ct-1", flow_id: "f1", channel_id: "ch-1", status: "active" }]);
    generateText.mockResolvedValue({ text: "El envío cuesta 10 soles." });
    sendMessage.mockResolvedValue({ data: { data: { messageId: "wamid.OUT" } } });
  });

  it("usa los mensajes de Zernio y el actual, sin leer `messages`", async () => {
    getMessages.mockResolvedValue({
      data: {
        messages: [
          zmsg("a", "incoming", "Hola", "2026-10-28T10:00:00Z"),
          zmsg("b", "outgoing", "Hola, ¿qué necesitas?", "2026-10-28T10:00:30Z"),
        ],
      },
    });
    await executeAiResponse(db.asDb(), { contextMessages: 10 } as never, context(), "s1");

    expect(getMessages).toHaveBeenCalledWith(
      expect.objectContaining({ path: { conversationId: "z-1" }, query: expect.objectContaining({ accountId: "acc-real", sortOrder: "desc" }) }),
    );
    const call = generateText.mock.calls[0][0];
    expect(call.messages).toEqual([
      { role: "user", content: "Hola" },
      { role: "assistant", content: "Hola, ¿qué necesitas?" },
      { role: "user", content: "¿Cuánto cuesta el envío?" },
    ]);
    expect(call.system).toBe(DEFAULT_AI_SYSTEM_PROMPT);
    expect(sendMessage).toHaveBeenCalledOnce();
    // La respuesta mueve la última actividad (M-9).
    expect(db.rows("conversations")[0].last_message_at).toBeTruthy();
    expect(db.rows("conversations")[0].last_message_preview).toBe("El envío cuesta 10 soles.");
  });

  it("si Zernio no devuelve el historial, responde con el mensaje actual", async () => {
    getMessages.mockResolvedValue({ error: { message: "boom" }, response: { status: 500 } });
    await executeAiResponse(db.asDb(), {} as never, context(), "s1");
    expect(generateText.mock.calls[0][0].messages).toEqual([{ role: "user", content: "¿Cuánto cuesta el envío?" }]);
  });

  it("si Zernio rechaza el envío, deja el mensaje fallido y cancela el flujo (M-10)", async () => {
    getMessages.mockResolvedValue({ data: { messages: [] } });
    sendMessage.mockResolvedValue({ error: { message: "ventana cerrada" }, response: { status: 400 } });
    await executeAiResponse(db.asDb(), {} as never, context(), "s1");
    const failed = db.rows("messages").find((m) => m.status === "failed");
    expect(failed).toMatchObject({ direction: "outbound", sent_by_flow_id: "f1" });
    expect(db.rows("flow_sessions")[0].status).toBe("cancelled");
  });
});
