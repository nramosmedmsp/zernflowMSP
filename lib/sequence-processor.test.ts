// Secuencias: un contacto dado de baja no recibe nada, el mismo paso no sale
// dos veces aunque el cron se solape, y el texto sale con sus variables.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ db: null as unknown, sent: [] as { text?: string; templateName?: string }[] }));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db }));
vi.mock("@/lib/cases", () => ({ stampBotOutbound: vi.fn(async () => {}) }));
vi.mock("@/lib/cases/messaging", () => ({
  zernioMessenger: () => ({
    sendText: async (input: { text: string; lateAccountId?: string }) => {
      state.sent.push({ text: input.text });
      // Canal de prueba: el mensajero real guarda el mensaje en `messages`.
      if (input.lateAccountId?.startsWith("demo-")) {
        const [row] = (state.db as FakeDb).seed("messages", [
          { conversation_id: "cv-1", direction: "outbound", text: input.text, status: "sent", platform_message_id: "demo-x" },
        ]);
        return { ok: true, messageId: row.id };
      }
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

function seed(opts: { subscribed?: boolean; steps?: unknown[]; displayName?: string; status?: string; stepId?: string | null; index?: number; settings?: unknown } = {}) {
  fake = new FakeDb();
  state.db = fake;
  state.sent = [];
  fake.seed("workspaces", [{ id: WS, name: "Muscle Shop", settings: opts.settings ?? {} }]);
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
    name: "Bienvenida",
    status: opts.status ?? "active",
    steps: opts.steps ?? [{ type: "message", content: "Hola {nombre}, ¿cómo vas con tu rutina?" }],
  };
  fake.seed("sequence_enrollments", [
    {
      id: "en-1",
      sequence_id: "seq-1",
      contact_id: "ct-1",
      channel_id: "ch-1",
      status: "active",
      current_step_index: opts.index ?? 0,
      current_step_id: opts.stepId ?? null,
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

  it("sin nombre real, el mensaje sale sin el nombre y bien escrito", async () => {
    seed({ displayName: "+51 987 654 321" });
    await processSequenceSteps();
    expect(state.sent).toEqual([{ text: "Hola, ¿cómo vas con tu rutina?" }]);
    expect(fake.rows("activity").some((a) => a.type === "sequence_step_failed")).toBe(false);
  });

  it("otra variable vacía (la fecha clave) no manda el mensaje con la llave y registra el motivo en español", async () => {
    seed({ steps: [{ type: "message", content: "Tu plan vence el {fecha_clave}" }] });
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

describe("secuencias robustas (tanda 7B)", () => {
  afterEach(() => vi.useRealTimers());

  it("R2-B1: pausar la secuencia no cancela a los inscritos y siguen al reactivar", async () => {
    seed({ status: "paused" });
    await processSequenceSteps();
    expect(state.sent).toEqual([]);
    expect(enrollment().status).toBe("active");
    expect(enrollment().current_step_index).toBe(0);
    // Se reactiva y la inscripción vuelve a estar disponible.
    fake.rows("sequence_enrollments")[0].sequences = { ...(enrollment().sequences as object), status: "active" };
    enrollment().next_step_at = new Date(Date.now() - 1000).toISOString();
    await processSequenceSteps();
    expect(state.sent).toHaveLength(1);
    expect(enrollment().status).toBe("completed");
  });

  it("R2-B3: si se agregan pasos antes, la persona sigue en su mismo paso (por id)", async () => {
    // Iba en el paso "b"; después de editar hay un paso nuevo adelante.
    seed({
      steps: [
        { id: "nuevo", type: "message", content: "Nuevo" },
        { id: "a", type: "message", content: "Uno" },
        { id: "b", type: "message", content: "Dos" },
      ],
      stepId: "b",
      index: 1,
    });
    await processSequenceSteps();
    expect(state.sent.map((s) => s.text)).toEqual(["Dos"]);
    expect(enrollment().status).toBe("completed");
  });

  it("R2-B3: el avance guarda el id del paso siguiente", async () => {
    seed({ steps: [{ id: "a", type: "message", content: "Uno" }, { id: "b", type: "message", content: "Dos" }], stepId: "a" });
    await processSequenceSteps();
    expect(enrollment()).toMatchObject({ current_step_index: 1, current_step_id: "b", status: "active" });
  });

  it("R2-B19: si el avance no se pudo guardar no se envía el paso (no sale dos veces)", async () => {
    seed({ steps: [{ type: "message", content: "Uno" }, { type: "message", content: "Dos" }] });
    // Lecturas/escrituras de inscripciones: 1 = buscar, 2 = tomar, 3 = avanzar (esta falla).
    let calls = 0;
    const real = fake;
    state.db = new Proxy(real, {
      get(target, prop) {
        if (prop === "from") {
          return (table: string) => {
            if (table === "sequence_enrollments" && ++calls === 3) target.failNext.set(table, "update");
            return target.from(table);
          };
        }
        return Reflect.get(target, prop);
      },
    });
    await processSequenceSteps();
    expect(state.sent).toEqual([]);
    expect(enrollment().current_step_index).toBe(0);
    // Con la base sana, el paso sale una sola vez.
    state.db = real;
    enrollment().next_step_at = new Date(Date.now() - 1000).toISOString();
    await processSequenceSteps();
    // "Uno" salió una sola vez y la inscripción ya apunta a "Dos".
    expect(state.sent.map((s) => s.text)).toEqual(["Uno"]);
    expect(enrollment().current_step_index).toBe(1);
  });

  it("R2-B20: fuera del horario de atención el paso espera a la próxima hora hábil", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T07:00:00Z")); // martes 2:00 en Lima
    const day = [["09:00", "18:00"]];
    seed({ settings: { business_hours: { mon: day, tue: day, wed: day, thu: day, fri: day } } });
    enrollment().next_step_at = new Date("2026-11-03T06:59:00Z").toISOString();
    await processSequenceSteps();
    expect(state.sent).toEqual([]);
    expect(enrollment().status).toBe("active");
    expect(enrollment().current_step_index).toBe(0);
    expect(enrollment().next_step_at).toBe("2026-11-03T14:00:00.000Z");
    // A las 9:00 sí sale.
    vi.setSystemTime(new Date("2026-11-03T14:00:01Z"));
    await processSequenceSteps();
    expect(state.sent).toHaveLength(1);
  });

  it("R2-B5: el mensaje queda marcado como de la secuencia y la conversación sube", async () => {
    await processSequenceSteps();
    expect(fake.rows("messages")[0]).toMatchObject({ sent_by_node_id: "sequence:Bienvenida" });
    const conversation = fake.rows("conversations")[0];
    expect(conversation.last_message_preview).toBe("Hola Ana, ¿cómo vas con tu rutina?");
    expect(conversation.last_message_at).toBeTruthy();
  });

  it("B-18: en un canal de prueba el paso no se guarda dos veces y queda marcado como de la secuencia", async () => {
    fake.rows("channels")[0].late_account_id = "demo-acc";
    await processSequenceSteps();
    const messages = fake.rows("messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ sent_by_node_id: "sequence:Bienvenida", text: "Hola Ana, ¿cómo vas con tu rutina?" });
  });
});
