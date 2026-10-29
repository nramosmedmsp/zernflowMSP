import { describe, expect, it } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { cancelActiveSessions, cancelOtherWaitingSessions, shouldCancelResumeForPausedBot } from "./waiting-session";

describe("B-16: una espera de tiempo no sigue enviando si un asesor tomó el chat", () => {
  const setup = (paused: boolean) => {
    const db = new FakeDb();
    db.seed("conversations", [{ id: "cv-1", workspace_id: "ws", contact_id: "ct", channel_id: "ch", is_automation_paused: paused }]);
    return db.asDb();
  };

  it("con el bot en pausa la sesión se cancela", async () => {
    expect(await shouldCancelResumeForPausedBot(setup(true), { variables: {}, conversationId: "cv-1" })).toBe(true);
  });

  it("con el bot activo sigue", async () => {
    expect(await shouldCancelResumeForPausedBot(setup(false), { variables: {}, conversationId: "cv-1" })).toBe(false);
  });

  it("los flujos de eventos de gestión corren aunque el bot esté en pausa", async () => {
    expect(await shouldCancelResumeForPausedBot(setup(true), { variables: { __case_event: "case_closed" }, conversationId: "cv-1" })).toBe(false);
  });

  it("sin conversación no cancela", async () => {
    expect(await shouldCancelResumeForPausedBot(setup(true), { variables: {}, conversationId: null })).toBe(false);
  });
});

describe("cancelar sesiones", () => {
  it("cancelOtherWaitingSessions deja la indicada y cancela las demás esperas del contacto y canal", async () => {
    const db = new FakeDb();
    db.seed("flow_sessions", [
      { id: "a", contact_id: "ct", channel_id: "ch", status: "active", waiting_for_input: true },
      { id: "b", contact_id: "ct", channel_id: "ch", status: "active", waiting_for_input: true },
      { id: "c", contact_id: "ct", channel_id: "ch", status: "active", waiting_for_input: false },
    ]);
    await cancelOtherWaitingSessions(db.asDb(), { sessionId: "a", contactId: "ct", channelId: "ch" });
    const status = (id: string) => db.rows("flow_sessions").find((s) => s.id === id)?.status;
    expect([status("a"), status("b"), status("c")]).toEqual(["active", "cancelled", "active"]);
  });

  it("cancelActiveSessions sin canales no hace nada", async () => {
    const db = new FakeDb();
    db.seed("flow_sessions", [{ id: "a", contact_id: "ct", channel_id: "ch", status: "active", waiting_for_input: true }]);
    await cancelActiveSessions(db.asDb(), { contactId: "ct", channelIds: [] });
    expect(db.rows("flow_sessions")[0].status).toBe("active");
  });
});
