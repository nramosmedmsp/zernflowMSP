// Comentario → DM (R2-B10): Instagram solo deja una respuesta privada por
// comentario. Sale el primer mensaje y el resto espera a que el cliente conteste.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ privateReplies: [] as string[] }));

vi.mock("@/lib/workspace-secrets", () => ({ getLateApiKey: async () => "key" }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({
    comments: {
      sendPrivateReplyToComment: async (input: { body: { message: string } }) => {
        state.privateReplies.push(input.body.message);
        return { data: { ok: true } };
      },
    },
  }),
}));

import { executeFlow } from "./engine";
import { findWaitingSession } from "./waiting-session";
import type { FlowExecutionContext } from "./types";

const WS = "ws-1";
let fake: FakeDb;

function seed(nodes: unknown[], edges: unknown[]) {
  fake = new FakeDb();
  state.privateReplies = [];
  fake.seed("workspaces", [{ id: WS, name: "Muscle Shop", settings: {} }]);
  fake.seed("channels", [{ id: "ch-1", workspace_id: WS, platform: "instagram", late_account_id: "acc-1" }]);
  fake.seed("contacts", [{ id: "ct-1", workspace_id: WS, display_name: "Ana", is_subscribed: true }]);
  fake.seed("conversations", [{ id: "cv-1", workspace_id: WS, contact_id: "ct-1", channel_id: "ch-1", late_conversation_id: null }]);
  fake.seed("flows", [{ id: "fl-1", workspace_id: WS, status: "published", nodes, edges }]);
}

const context = (): FlowExecutionContext => ({
  triggerId: "tr-1",
  flowId: "fl-1",
  channelId: "ch-1",
  contactId: "ct-1",
  conversationId: "cv-1",
  workspaceId: WS,
  lateAccountId: "acc-1",
  incomingMessage: { text: "info" },
  variables: { comment_id: "c-1", post_id: "p-1" },
});

const send = (id: string, text: string) => ({ id, type: "sendMessage", data: { messages: [{ text }] } });
const trigger = { id: "t", type: "trigger", data: { triggerType: "comment_keyword" } };

describe("flujo disparado por un comentario", () => {
  beforeEach(() => seed([], []));

  it("sale el primer mensaje como respuesta privada y el flujo espera al cliente", async () => {
    seed([trigger, send("m1", "Hola, gracias por comentar"), send("m2", "Aquí va el catálogo")], [
      { id: "e1", source: "t", target: "m1" },
      { id: "e2", source: "m1", target: "m2" },
    ]);
    await executeFlow(fake.asDb(), context());

    expect(state.privateReplies).toEqual(["Hola, gracias por comentar"]);
    const session = fake.rows("flow_sessions")[0];
    expect(session).toMatchObject({ status: "active", waiting_for_input: true, current_node_id: "m1" });
    // El segundo mensaje no se intentó (no hay nota de fallo ni mensaje fallido).
    expect(fake.rows("messages").filter((m) => m.status === "failed")).toHaveLength(0);
    expect(fake.rows("case_notes")).toHaveLength(0);
    expect(await findWaitingSession(fake.asDb(), { contactId: "ct-1", channelId: "ch-1" })).not.toBeNull();
  });

  it("si no hay nada después del primer mensaje, el flujo termina sin quedar esperando", async () => {
    seed([trigger, send("m1", "Hola")], [{ id: "e1", source: "t", target: "m1" }]);
    await executeFlow(fake.asDb(), context());
    expect(state.privateReplies).toEqual(["Hola"]);
    const session = fake.rows("flow_sessions")[0];
    expect(session.waiting_for_input).not.toBe(true);
    expect(session.status).toBe("completed");
  });
});
