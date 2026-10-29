// R2-B2: un contacto puede volver a entrar a una secuencia cuando terminó o se canceló.

import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { enrollInSequence } from "./enroll";

const WS = "ws-1";
let fake: FakeDb;
const steps = [
  { id: "a", type: "message" as const, content: "Hola" },
  { id: "b", type: "delay" as const, delayMinutes: 60 },
];
const params = { workspaceId: WS, sequenceId: "seq-1", steps, contactId: "ct-1", channelId: "ch-1" };

beforeEach(() => {
  fake = new FakeDb();
  fake.unique("sequence_enrollments", ["sequence_id", "contact_id"]);
  fake.seed("workspaces", [{ id: WS, name: "Tienda", settings: {} }]);
});

describe("enrollInSequence", () => {
  it("inscribe a un contacto nuevo en el primer paso", async () => {
    const result = await enrollInSequence(fake.asDb(), params);
    expect(result).toEqual({ ok: true, reactivated: false });
    expect(fake.rows("sequence_enrollments")[0]).toMatchObject({ status: "active", current_step_index: 0, current_step_id: "a" });
  });

  it("si ya está activo no lo duplica", async () => {
    await enrollInSequence(fake.asDb(), params);
    expect(await enrollInSequence(fake.asDb(), params)).toMatchObject({ ok: false, reason: "already_active" });
    expect(fake.rows("sequence_enrollments")).toHaveLength(1);
  });

  it.each(["completed", "cancelled"])("vuelve a entrar si la inscripción anterior quedó %s", async (status) => {
    await enrollInSequence(fake.asDb(), params);
    Object.assign(fake.rows("sequence_enrollments")[0], { status, current_step_index: 2, current_step_id: null, completed_at: "2026-01-01T00:00:00Z" });
    const result = await enrollInSequence(fake.asDb(), params);
    expect(result).toEqual({ ok: true, reactivated: true });
    expect(fake.rows("sequence_enrollments")).toHaveLength(1);
    expect(fake.rows("sequence_enrollments")[0]).toMatchObject({ status: "active", current_step_index: 0, current_step_id: "a", completed_at: null });
    expect(fake.rows("activity").map((a) => a.type)).toContain("sequence_reenrolled");
  });

  it("una secuencia sin pasos no inscribe", async () => {
    expect(await enrollInSequence(fake.asDb(), { ...params, steps: [] })).toMatchObject({ ok: false, reason: "no_steps" });
  });
});
