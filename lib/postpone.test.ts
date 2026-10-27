import { describe, expect, it } from "vitest";
import { postponeOptions } from "./postpone";

// Martes 27 oct 2026, 14:45 en Lima (19:45 UTC).
const tuesdayAfternoon = new Date("2026-10-27T19:45:00.000Z");

describe("postponeOptions", () => {
  it("ofrece en 1 hora, hoy en la tarde, mañana, en 3 días y el lunes", () => {
    const opts = postponeOptions(tuesdayAfternoon);
    expect(opts.map((o) => [o.label, o.detail])).toEqual([
      ["En 1 hora", "15:45"],
      ["Hoy en la tarde", "18:00"],
      ["Mañana", "mié 28 oct · 9:00"],
      ["En 3 días", "vie 30 oct · 9:00"],
      ["El lunes", "lun 2 nov · 9:00"],
    ]);
    expect(opts.find((o) => o.key === "tomorrow")?.at).toBe("2026-10-28T14:00:00.000Z");
    expect(opts.find((o) => o.key === "evening")?.at).toBe("2026-10-27T23:00:00.000Z");
  });

  it("después de las 17:00 ya no ofrece la tarde de hoy", () => {
    const late = new Date("2026-10-27T22:30:00.000Z"); // 17:30 en Lima
    expect(postponeOptions(late).map((o) => o.key)).not.toContain("evening");
  });

  it("no repite el lunes cuando es mañana o cae en 3 días", () => {
    const sunday = new Date("2026-11-01T15:00:00.000Z"); // domingo 10:00 Lima
    expect(postponeOptions(sunday).map((o) => o.key)).not.toContain("monday");
    const friday = new Date("2026-10-30T15:00:00.000Z"); // viernes: lunes = en 3 días
    expect(postponeOptions(friday).map((o) => o.key)).not.toContain("monday");
  });

  it("un lunes ofrece el lunes siguiente", () => {
    const monday = new Date("2026-11-02T15:00:00.000Z");
    expect(postponeOptions(monday).find((o) => o.key === "monday")?.detail).toBe("lun 9 nov · 9:00");
  });

  it("de noche, la hora cruza al día siguiente en hora de Lima", () => {
    const night = new Date("2026-10-28T04:30:00.000Z"); // 23:30 del 27 en Lima
    expect(postponeOptions(night)[0].detail).toBe("0:30");
    expect(postponeOptions(night).find((o) => o.key === "tomorrow")?.detail).toBe("mié 28 oct · 9:00");
  });
});
