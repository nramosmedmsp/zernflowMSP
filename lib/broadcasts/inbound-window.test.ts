// A-8: en los canales reales los mensajes del cliente no se guardan en
// `messages` (los guarda Zernio). La ventana de 24 h sale de
// conversations.last_inbound_at, que sella el webhook.

import { describe, expect, it } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { loadDeliveryContext, windowStateOf } from "./delivery";
import { planBroadcast } from "./plan";

const WS = "ws-1";
const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function setup(lastInboundAt: string | null) {
  const db = new FakeDb();
  db.seed("workspaces", [{ id: WS, name: "Tienda", slug: "t" }]);
  db.seed("channels", [{ id: "ch-1", workspace_id: WS, platform: "whatsapp", late_account_id: "acc-real", is_active: true }]);
  db.seed("contacts", [{ id: "ct-1", workspace_id: WS, display_name: "Lucía", is_subscribed: true, phone: null }]);
  db.seed("contact_channels", [{ contact_id: "ct-1", channel_id: "ch-1", platform_sender_id: "51999111222" }]);
  db.seed("conversations", [
    { id: "cv-1", workspace_id: WS, channel_id: "ch-1", contact_id: "ct-1", platform: "whatsapp", late_conversation_id: "z-1", last_inbound_at: lastInboundAt },
  ]);
  // Sin filas en `messages`: como en un canal real.
  return db;
}

describe("difusión de texto en un canal real", () => {
  it("el cliente que escribió hace 1 hora entra en la difusión aunque `messages` esté vacía", async () => {
    const db = setup(hoursAgo(1));
    const plan = await planBroadcast(db.asDb(), WS, { kind: "text", text: "Hola" }, null, NOW);
    expect(plan.recipients).toEqual([{ contactId: "ct-1", channelId: "ch-1" }]);
    expect(plan.excluded.closedWindow).toBe(0);
  });

  it("el que escribió hace 30 horas queda fuera por ventana cerrada", async () => {
    const db = setup(hoursAgo(30));
    const plan = await planBroadcast(db.asDb(), WS, { kind: "text", text: "Hola" }, null, NOW);
    expect(plan.recipients).toHaveLength(0);
    expect(plan.excluded.closedWindow).toBe(1);
  });

  it("el que nunca escribió queda fuera por ventana cerrada", async () => {
    const db = setup(null);
    const plan = await planBroadcast(db.asDb(), WS, { kind: "text", text: "Hola" }, null, NOW);
    expect(plan.recipients).toHaveLength(0);
    expect(plan.excluded.closedWindow).toBe(1);
  });
});

describe("envío a un contacto (secuencias y difusión)", () => {
  it("la ventana se lee de la conversación", async () => {
    const open = await loadDeliveryContext(setup(hoursAgo(2)).asDb(), { workspaceId: WS, contactId: "ct-1", channelId: "ch-1" });
    expect(open.lastInboundAt).toBe(hoursAgo(2));
    expect(windowStateOf(open, NOW)).toBe("open");

    const closed = await loadDeliveryContext(setup(hoursAgo(40)).asDb(), { workspaceId: WS, contactId: "ct-1", channelId: "ch-1" });
    expect(windowStateOf(closed, NOW)).toBe("closed");
  });
});
