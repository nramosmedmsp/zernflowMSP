// processComment: «Enviado» solo si salió un mensaje, el comentario no mueve el
// chat, y un comentario repetido no se responde dos veces.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ onRun: null as null | (() => void), runs: 0 }));

vi.mock("@/lib/flow-engine/engine", () => ({
  executeFlow: async () => {
    state.runs++;
    state.onRun?.();
  },
}));
vi.mock("@/lib/workspace-secrets", () => ({ getLateApiKey: async () => null }));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: () => ({}) }));

import { processComment } from "./comment-processor";
import type { Database } from "@/lib/types/database";

const WS = "ws-1";
let fake: FakeDb;
const channel = { id: "ch-1", workspace_id: WS, platform: "instagram", late_account_id: "acc-1" } as Database["public"]["Tables"]["channels"]["Row"];
const comment = { id: "c-1", postId: "p-1", text: "info por favor", author: { id: "ig-1", username: "ana_fit" } };

beforeEach(() => {
  fake = new FakeDb();
  fake.unique("comment_logs", ["channel_id", "platform_comment_id"]);
  state.onRun = null;
  state.runs = 0;
  fake.seed("flows", [{ id: "fl-1", workspace_id: WS, status: "published" }]);
  fake.seed("triggers", [
    { id: "tr-1", flow_id: "fl-1", channel_id: null, type: "comment_keyword", is_active: true, priority: 1, config: { keywords: [{ value: "info" }] }, flows: { status: "published", workspace_id: WS } },
  ]);
});

describe("processComment", () => {
  it("R2-B11: si el flujo no envió nada, el DM no figura como enviado", async () => {
    await processComment({ supabase: fake.asDb(), channel, comment });
    const log = fake.rows("comment_logs")[0];
    expect(log.dm_sent).toBe(false);
    expect(String(log.error)).toContain("no envió");
  });

  it("R2-B11: si el flujo envió un mensaje, figura como enviado", async () => {
    state.onRun = () => {
      fake.seed("messages", [
        { conversation_id: fake.rows("conversations")[0].id, direction: "outbound", sent_by_flow_id: "fl-1", status: "sent", created_at: new Date().toISOString() },
      ]);
    };
    await processComment({ supabase: fake.asDb(), channel, comment });
    expect(fake.rows("comment_logs")[0].dm_sent).toBe(true);
  });

  it("R2-B12: el comentario no mueve el chat ni deja un texto inventado, y no usa «Unknown commenter»", async () => {
    await processComment({ supabase: fake.asDb(), channel, comment: { ...comment, author: { id: "ig-2" } } });
    const conversation = fake.rows("conversations")[0];
    expect(conversation.last_message_at ?? null).toBeNull();
    expect(conversation.last_message_preview ?? null).toBeNull();
    expect(fake.rows("contacts")[0].display_name).toBe("Comentarista de Instagram");
  });

  it("R2-B13: un comentario repetido no se procesa dos veces", async () => {
    await processComment({ supabase: fake.asDb(), channel, comment });
    const second = await processComment({ supabase: fake.asDb(), channel, comment });
    expect(second.skipped).toBe("already_processed");
    expect(state.runs).toBe(1);
  });
});
