// Secuencias: un contacto dado de baja no recibe nada, el mismo paso no sale
// dos veces aunque el cron se solape, y el texto sale con sus variables.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ db: null as unknown, sent: [] as { text?: string; templateName?: string }[] }));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db }));
vi.mock("@/lib/cases", () => ({ stampBotOutbound: vi.fn(async () => {}) }));
vi.mock("@/lib/cases/messaging", () => ({
  zernioMessenger: () => ({
    sendText: async (input: { text: string }) => {
      state.sent.push({ text: input.text });
      return { ok: true, messageId: `m-${state.sent.length}` };
    },
    sendTemplate: async (input: { templateName: string }) => {
      state.sent.push({ templateName: input.templateName });
      return { ok: true, messageId: `m-${state.sent.length}` };
    },
  }),
}));

import { processSequenceSteps } from "./sequence-processor";

const WS = "ws-1";
let fake: FakeDb;

function seed(opts: { subscribed?: boolean; steps?: unknown[]; displayName?: string } = {}) {
  fake = new FakeDb();
  state.db = fake;
  state.sent = [];
  fake.seed("workspaces", [{ id: WS, name: "Muscle Shop" }]);
  fake.seed("channels", [{ id: "ch-1", workspace_id: WS, platform: "whatsapp", late_account_id: "acc-1", is_active: true }]);
  fake.seed("contacts", [
    { id: "ct-1", workspace_id: WS, display_name: opts.displayName ?? "Ana Pérez", is_subscribed: opts.subscribed ?? true },
  ]);
  fake.seed("conversations", [
    {
      id: "cv-1",
      workspace_id: WS,
      contact_id: "ct-1",
      channel_id: "ch-1",
      late_conversation_id: "late-1",
      last_inbound_at: new Date().toISOString(),
    },
  ]);
  const sequence = {
    id: "seq-1",
    workspace_id: WS,
    status: "active",
    steps: opts.steps ?? [{ type: "message", content: "Hola {nombre}, ¿cómo vas con tu rutina?" }],
  };
  fake.seed("sequence_enrollments", [
    {
      id: "en-1",
      sequence_id: "seq-1",
      contact_id: "ct-1",
      channel_id: "ch-1",
      status: "active",
      current_step_index: 0,
      next_step_at: new Date(Date.now() - 1000).toISOString(),
      sequences: sequence,
    },
  ]);
}

const enrollment = () => fake.rows("sequence_enrollments")[0];

beforeEach(() => seed());

describe("processSequenceSteps", () => {
  it("envía el paso con las variables ya puestas y completa la inscripción", async () => {
    await processSequenceSteps();
    expect(state.sent).toEqual([{ text: "Hola Ana, ¿cómo vas con tu rutina?" }]);
    expect(enrollment().status).toBe("completed");
    expect(fake.rows("messages")[0]).toMatchObject({ text: "Hola Ana, ¿cómo vas con tu rutina?", status: "sent" });
  });

  it("un contacto dado de baja no recibe nada y la inscripción se cancela", async () => {
    seed({ subscribed: false });
    await processSequenceSteps();
    expect(state.sent).toEqual([]);
    expect(enrollment().status).toBe("cancelled");
    expect(fake.rows("messages")).toHaveLength(0);
  });

  it("la baja a mitad de la secuencia detiene los pasos siguientes", async () => {
    seed({ steps: [{ type: "message", content: "Uno" }, { type: "message", content: "Dos" }] });
    await processSequenceSteps();
    expect(state.sent.map((s) => s.text)).toEqual(["Uno"]);
    fake.rows("contacts")[0].is_subscribed = false;
    await processSequenceSteps();
    expect(state.sent.map((s) => s.text)).toEqual(["Uno"]);
    expect(enrollment().status).toBe("cancelled");
  });

  it("dos pasadas del cron a la vez no envían el mismo paso dos veces", async () => {
    await Promise.all([processSequenceSteps(), processSequenceSteps()]);
    expect(state.sent).toHaveLength(1);
  });

  it("una variable vacía no manda el mensaje con la llave y registra el motivo en español", async () => {
    seed({ displayName: "+51 987 654 321" });
    await processSequenceSteps();
    expect(state.sent).toEqual([]);
    const failure = fake.rows("activity").find((a) => a.type === "sequence_step_failed");
    expect(failure).toBeTruthy();
    expect(JSON.stringify(failure!.meta)).toContain("está vacía");
    expect(fake.rows("messages")[0]).toMatchObject({ status: "failed" });
  });

  it("un paso con llaves desconocidas no sale", async () => {
    seed({ steps: [{ type: "message", content: "Tu precio es {precio}" }] });
    await processSequenceSteps();
    expect(state.sent).toEqual([]);
    expect(fake.rows("activity").some((a) => a.type === "sequence_step_failed")).toBe(true);
  });
});
