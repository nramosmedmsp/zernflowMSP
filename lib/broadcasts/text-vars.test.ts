// Difusión de texto: las variables se reemplazan por contacto y quien no puede
// recibir un texto armado queda fuera (nunca sale vacío ni con llaves crudas).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("@/lib/cases", () => ({ stampBotOutbound: vi.fn(async () => {}) }));
vi.mock("@/lib/cases/messaging", () => ({
  zernioMessenger: () => ({
    sendText: async (input: { text: string }) => {
      state.sent.push(input.text);
      return { ok: true, messageId: "m" };
    },
    sendTemplate: async () => ({ ok: true, messageId: "m" }),
  }),
}));

import { deliverBroadcast } from "./deliver";
import { planBroadcast } from "./plan";

const WS = "ws-1";
let fake: FakeDb;

beforeEach(() => {
  state.sent = [];
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Muscle Shop" }]);
  fake.seed("channels", [{ id: "ch-1", workspace_id: WS, platform: "whatsapp", late_account_id: "acc-1", is_active: true }]);
  const recent = new Date().toISOString();
  for (const [id, name] of [["c1", "Ana Pérez"], ["c2", "+51 987 654 321"]]) {
    fake.seed("contacts", [{ id, workspace_id: WS, display_name: name, is_subscribed: true }]);
    fake.seed("conversations", [
      { workspace_id: WS, contact_id: id, channel_id: "ch-1", late_conversation_id: `late-${id}`, last_inbound_at: recent },
    ]);
  }
});

describe("difusión de texto con variables", () => {
  it("deja fuera al contacto cuyo {nombre} queda vacío", async () => {
    const plan = await planBroadcast(fake.asDb(), WS, { kind: "text", text: "Hola {nombre}, 20% de descuento" }, null);
    expect(plan.recipients.map((r) => r.contactId)).toEqual(["c1"]);
    expect(plan.excluded.emptyVariable).toBe(1);
  });

  it("un texto sin variables llega a todos", async () => {
    const plan = await planBroadcast(fake.asDb(), WS, { kind: "text", text: "20% de descuento solo hoy" }, null);
    expect(plan.recipients).toHaveLength(2);
  });

  it("al enviar, el texto sale con el nombre puesto", async () => {
    const res = await deliverBroadcast(fake.asDb(), {
      workspaceId: WS,
      contactId: "c1",
      channelId: "ch-1",
      messageContent: { kind: "text", text: "Hola {nombre}, 20% de descuento" },
    });
    expect(res.ok).toBe(true);
    expect(state.sent).toEqual(["Hola Ana, 20% de descuento"]);
  });

  it("al enviar a quien no tiene nombre, no sale nada", async () => {
    const res = await deliverBroadcast(fake.asDb(), {
      workspaceId: WS,
      contactId: "c2",
      channelId: "ch-1",
      messageContent: { kind: "text", text: "Hola {nombre}" },
    });
    expect(res).toMatchObject({ ok: false });
    expect(state.sent).toEqual([]);
  });
});
