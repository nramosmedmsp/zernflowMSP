import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.test-helper";
import { setConversationBotPaused } from "./bot-pause";

const WS = "ws-1";
const OTHER_WS = "ws-2";
const ANA = "u-ana";

let fake: FakeDb;
let conversationId: string;
let contactId: string;
let caseId: string;

const db = () => fake.asDb();
const paused = () => fake.rows("conversations").find((c) => c.id === conversationId)!.is_automation_paused as boolean;

beforeEach(() => {
  fake = new FakeDb();
  fake.seed("workspaces", [
    { id: WS, name: "Tienda", slug: "tienda", settings: {} },
    { id: OTHER_WS, name: "Otra", slug: "otra", settings: {} },
  ]);
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María" }]);
  contactId = contact.id as string;
  const [conversation] = fake.seed("conversations", [
    { workspace_id: WS, contact_id: contactId, channel_id: "ch", late_conversation_id: "conv-1", is_automation_paused: false },
  ]);
  conversationId = conversation.id as string;
  const [row] = fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, status: "open" }]);
  caseId = row.id as string;
});

describe("setConversationBotPaused", () => {
  it("pausa y reanuda el bot de la conversación y lo registra en la actividad con quién lo hizo", async () => {
    expect(await setConversationBotPaused(db(), { workspaceId: WS, conversationId, paused: true, actorId: ANA, caseId })).toEqual({
      ok: true,
      paused: true,
      changed: true,
    });
    expect(paused()).toBe(true);
    expect(await setConversationBotPaused(db(), { workspaceId: WS, conversationId, paused: false, actorId: ANA, caseId })).toEqual({
      ok: true,
      paused: false,
      changed: true,
    });
    expect(paused()).toBe(false);

    expect(fake.rows("activity")).toMatchObject([
      { workspace_id: WS, type: "automation_paused", case_id: caseId, contact_id: contactId, conversation_id: conversationId, actor_id: ANA, from_value: "active", to_value: "paused" },
      { workspace_id: WS, type: "automation_resumed", case_id: caseId, contact_id: contactId, conversation_id: conversationId, actor_id: ANA, from_value: "paused", to_value: "active" },
    ]);
  });

  it("si ya estaba en ese estado no cambia nada ni registra actividad", async () => {
    const result = await setConversationBotPaused(db(), { workspaceId: WS, conversationId, paused: false, actorId: ANA });
    expect(result).toEqual({ ok: true, paused: false, changed: false });
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("no toca una conversación de otro espacio", async () => {
    const result = await setConversationBotPaused(db(), { workspaceId: OTHER_WS, conversationId, paused: true, actorId: ANA });
    expect(result).toEqual({ error: "Conversación no encontrada." });
    expect(paused()).toBe(false);
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("una conversación que no existe devuelve el error", async () => {
    expect(await setConversationBotPaused(db(), { workspaceId: WS, conversationId: "nada", paused: true, actorId: ANA })).toEqual({
      error: "Conversación no encontrada.",
    });
  });
});
