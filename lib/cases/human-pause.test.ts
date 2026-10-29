// M-11 y M-12: cuando una persona escribe en el chat, el bot se pausa (haya o
// no una gestión abierta) y se cancelan sus esperas de ese contacto y canal.

import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.test-helper";
import { handleHumanOutboundForConversation } from "./inbound";
import { setConversationBotPaused } from "./bot-pause";

const WS = "ws-1";
let fake: FakeDb;

const waiting = (over: Record<string, unknown> = {}) => ({
  contact_id: "ct-1",
  channel_id: "ch-1",
  flow_id: "f1",
  status: "active",
  waiting_for_input: true,
  ...over,
});

beforeEach(() => {
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "t", settings: {} }]);
  fake.seed("contacts", [{ id: "ct-1", workspace_id: WS, display_name: "María" }]);
  fake.seed("conversations", [{ id: "cv-1", workspace_id: WS, contact_id: "ct-1", channel_id: "ch-1", is_automation_paused: false }]);
});

describe("M-12: pausar el bot aunque no haya gestión abierta", () => {
  it("la respuesta de un asesor sin gestión abierta pausa el bot", async () => {
    await handleHumanOutboundForConversation(fake.asDb(), { conversationId: "cv-1", userId: "u-ana" });
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(true);
  });

  it("con una gestión cerrada también", async () => {
    fake.seed("cases", [{ workspace_id: WS, contact_id: "ct-1", status: "won" }]);
    await handleHumanOutboundForConversation(fake.asDb(), { conversationId: "cv-1", userId: "u-ana" });
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(true);
  });

  it("con una gestión abierta sigue pausando y sellando como antes", async () => {
    fake.seed("cases", [{ id: "case-1", workspace_id: WS, contact_id: "ct-1", status: "open", waiting_since: "2026-10-28T10:00:00Z" }]);
    await handleHumanOutboundForConversation(fake.asDb(), { conversationId: "cv-1", userId: "u-ana", at: "2026-10-28T10:05:00Z" });
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(true);
    expect(fake.rows("cases")[0]).toMatchObject({ waiting_since: null, last_outbound_at: "2026-10-28T10:05:00Z" });
  });
});

describe("M-11: al pausar el bot se cancelan sus esperas", () => {
  it("la respuesta del asesor cancela la espera del menú y las esperas de tiempo de ese canal", async () => {
    fake.seed("flow_sessions", [
      waiting({ id: "menu" }),
      waiting({ id: "tiempo", waiting_for_input: false, waiting_until: "2026-10-28T11:00:00Z" }),
      waiting({ id: "otro-canal", channel_id: "ch-2" }),
      waiting({ id: "otro-contacto", contact_id: "ct-2" }),
      waiting({ id: "terminada", status: "completed" }),
    ]);
    fake.seed("cases", [{ workspace_id: WS, contact_id: "ct-1", status: "open" }]);
    await handleHumanOutboundForConversation(fake.asDb(), { conversationId: "cv-1", userId: "u-ana" });
    const status = (id: string) => fake.rows("flow_sessions").find((s) => s.id === id)?.status;
    expect(status("menu")).toBe("cancelled");
    expect(status("tiempo")).toBe("cancelled");
    expect(status("otro-canal")).toBe("active");
    expect(status("otro-contacto")).toBe("active");
    expect(status("terminada")).toBe("completed");
  });

  it("pausar a mano desde la cabecera del chat también las cancela; reanudar no toca nada", async () => {
    fake.seed("flow_sessions", [waiting({ id: "menu" })]);
    await setConversationBotPaused(fake.asDb(), { workspaceId: WS, conversationId: "cv-1", paused: true, actorId: "u-ana" });
    expect(fake.rows("flow_sessions")[0].status).toBe("cancelled");

    fake.seed("flow_sessions", [waiting({ id: "nueva" })]);
    await setConversationBotPaused(fake.asDb(), { workspaceId: WS, conversationId: "cv-1", paused: false, actorId: "u-ana" });
    expect(fake.rows("flow_sessions").find((s) => s.id === "nueva")?.status).toBe("active");
  });
});
