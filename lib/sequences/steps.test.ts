import { describe, expect, it } from "vitest";
import type { SequenceStep } from "@/lib/types/database";
import { ensureStepIds, nextSendTime, resolveStepIndex, stepDueAt, type StepSchedule } from "./steps";

const msg = (id: string | undefined, content = "x"): SequenceStep => ({ id, type: "message", content });

describe("ensureStepIds", () => {
  it("da id a los pasos sin id y conserva los que ya tienen", () => {
    let n = 0;
    const out = ensureStepIds([msg("a"), msg(undefined), msg("")], () => `nuevo-${++n}`);
    expect(out.map((s) => s.id)).toEqual(["a", "nuevo-1", "nuevo-2"]);
  });

  it("un id repetido se reemplaza", () => {
    let n = 0;
    expect(ensureStepIds([msg("a"), msg("a")], () => `n${++n}`).map((s) => s.id)).toEqual(["a", "n1"]);
  });
});

describe("resolveStepIndex", () => {
  const steps = [msg("a"), msg("b"), msg("c")];

  it("sigue al paso por id aunque lo hayan movido", () => {
    const edited = [msg("c"), msg("new"), msg("a"), msg("b")];
    expect(resolveStepIndex(edited, { current_step_id: "b", current_step_index: 1 })).toBe(3);
  });

  it("si el paso se borró, usa el número guardado sin pasarse del final", () => {
    expect(resolveStepIndex(steps, { current_step_id: "zzz", current_step_index: 1 })).toBe(1);
    expect(resolveStepIndex([msg("a")], { current_step_id: "zzz", current_step_index: 5 })).toBe(1);
  });

  it("inscripciones sin id (anteriores) usan el número", () => {
    expect(resolveStepIndex(steps, { current_step_id: null, current_step_index: 2 })).toBe(2);
  });
});

describe("horario de atención", () => {
  // Lunes a viernes de 9 a 18 (hora de Lima).
  const schedule: StepSchedule = {
    hours: { mon: [["09:00", "18:00"]], tue: [["09:00", "18:00"]], wed: [["09:00", "18:00"]], thu: [["09:00", "18:00"]], fri: [["09:00", "18:00"]] },
    holidays: new Set(),
  };
  // 2026-11-02 es lunes. Lima = UTC-5.
  const mondayNoon = new Date("2026-11-02T17:00:00Z"); // 12:00
  const mondayNight = new Date("2026-11-03T07:00:00Z"); // martes 02:00 Lima
  const sundayNoon = new Date("2026-11-01T17:00:00Z");

  it("dentro del horario sale ahora", () => {
    expect(nextSendTime(mondayNoon, schedule)).toEqual(mondayNoon);
    expect(nextSendTime(mondayNoon, null)).toEqual(mondayNoon);
  });

  it("a las 2:00 espera a las 9:00", () => {
    expect(nextSendTime(mondayNight, schedule).toISOString()).toBe("2026-11-03T14:00:00.000Z");
  });

  it("el domingo espera al lunes a las 9:00", () => {
    expect(nextSendTime(sundayNoon, schedule).toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });

  it("una espera dura sus minutos de reloj; un mensaje respeta el horario", () => {
    expect(stepDueAt({ type: "delay", delayMinutes: 90 }, mondayNoon, schedule).toISOString()).toBe("2026-11-02T18:30:00.000Z");
    expect(stepDueAt(msg("a"), mondayNight, schedule).toISOString()).toBe("2026-11-03T14:00:00.000Z");
  });
});
