// Reanudación automática del bot a las 24 h del último mensaje humano si el
// contacto no tiene gestión abierta ni programada.

import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.test-helper";
import { resumeIdlePausedBots } from "./bot-resume";

const WS = "ws-1";
const NOW = new Date("2026-10-29T12:00:00Z");
let fake: FakeDb;

const run = () => resumeIdlePausedBots(fake.asDb(), { deadline: Date.now() + 60_000, now: NOW });
const human = (at: string, conv = "cv-1") => ({
  conversation_id: conv,
  direction: "outbound",
  sent_by_user_id: "u-ana",
  created_at: at,
});

beforeEach(() => {
  fake = new FakeDb();
  fake.seed("contacts", [{ id: "ct-1", workspace_id: WS, display_name: "María" }]);
  fake.seed("conversations", [{ id: "cv-1", workspace_id: WS, contact_id: "ct-1", channel_id: "ch-1", is_automation_paused: true }]);
});

describe("reanudación automática del bot a las 24 h", () => {
  it("reanuda y registra la actividad si pasaron más de 24 h sin gestión abierta", async () => {
    fake.seed("messages", [human("2026-10-28T11:00:00Z")]);
    const r = await run();
    expect(r.resumed).toBe(1);
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(false);
    expect(fake.rows("activity")).toHaveLength(1);
    expect(fake.rows("activity")[0]).toMatchObject({ type: "automation_resumed", conversation_id: "cv-1", to_value: "active" });
  });

  it("no reanuda antes de las 24 h", async () => {
    fake.seed("messages", [human("2026-10-28T13:00:00Z")]);
    expect((await run()).resumed).toBe(0);
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(true);
  });

  it("cuenta desde el último mensaje humano, no desde uno anterior", async () => {
    fake.seed("messages", [human("2026-10-20T10:00:00Z"), human("2026-10-29T10:00:00Z")]);
    expect((await run()).resumed).toBe(0);
  });

  it("los mensajes del bot o del cliente no cuentan como humanos", async () => {
    fake.seed("messages", [
      human("2026-10-27T10:00:00Z"),
      { conversation_id: "cv-1", direction: "outbound", sent_by_user_id: null, created_at: "2026-10-29T11:00:00Z" },
      { conversation_id: "cv-1", direction: "inbound", sent_by_user_id: null, created_at: "2026-10-29T11:30:00Z" },
    ]);
    expect((await run()).resumed).toBe(1);
  });

  it.each(["open", "scheduled"])("no reanuda si el contacto tiene una gestión %s", async (status) => {
    fake.seed("messages", [human("2026-10-20T10:00:00Z")]);
    fake.seed("cases", [{ workspace_id: WS, contact_id: "ct-1", status }]);
    expect((await run()).resumed).toBe(0);
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(true);
  });

  it("una gestión cerrada no impide reanudar", async () => {
    fake.seed("messages", [human("2026-10-20T10:00:00Z")]);
    fake.seed("cases", [{ workspace_id: WS, contact_id: "ct-1", status: "won" }]);
    expect((await run()).resumed).toBe(1);
  });

  it("una pausa sin ningún mensaje humano (a mano) no se toca", async () => {
    expect((await run()).resumed).toBe(0);
    expect(fake.rows("conversations")[0].is_automation_paused).toBe(true);
  });

  it("es idempotente: la segunda vuelta no repite ni duplica la actividad", async () => {
    fake.seed("messages", [human("2026-10-20T10:00:00Z")]);
    await run();
    expect((await run()).resumed).toBe(0);
    expect(fake.rows("activity")).toHaveLength(1);
  });
});

describe("B-21: paginación por cursor", () => {
  it("con más de una página de chats pausados reanuda todos, sin saltarse los que quedan tras reanudar los primeros", async () => {
    const total = 230;
    const ids = Array.from({ length: total }, (_, i) => `cv-${String(i).padStart(4, "0")}`);
    fake.rows("conversations").length = 0;
    fake.seed(
      "conversations",
      ids.map((id) => ({ id, workspace_id: WS, contact_id: `ct-${id}`, channel_id: "ch-1", is_automation_paused: true })),
    );
    fake.seed(
      "messages",
      ids.map((id) => human("2026-10-20T10:00:00Z", id)),
    );
    const r = await run();
    expect(r.resumed).toBe(total);
    expect(fake.rows("conversations").every((c) => c.is_automation_paused === false)).toBe(true);
  });
});

