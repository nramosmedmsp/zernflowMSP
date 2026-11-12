import { describe, expect, it } from "vitest";
import { buildDailySeries, buildFlowPerformance, toCount } from "./aggregate";

describe("analítica agregada", () => {
  it("toCount acepta números y texto (bigint)", () => {
    expect(toCount("12345")).toBe(12345);
    expect(toCount(7)).toBe(7);
    expect(toCount(null)).toBe(0);
    expect(toCount("x")).toBe(0);
  });

  it("no corta en 1 000: 25 000 inicios y 12 500 terminaciones dan 50 % de abandono", () => {
    const perf = buildFlowPerformance([{ flow_id: "f1", starts: "25000", completions: 12500 }], new Map([["f1", "Bienvenida"]]));
    expect(perf).toEqual([{ id: "f1", name: "Bienvenida", starts: 25000, completions: 12500, dropOffRate: 50 }]);
  });

  it("ordena por inicios, deja los 10 primeros y nombra los flujos borrados", () => {
    const stats = Array.from({ length: 12 }, (_, i) => ({ flow_id: `f${i}`, starts: i + 1, completions: 0 }));
    const perf = buildFlowPerformance(stats, new Map());
    expect(perf).toHaveLength(10);
    expect(perf[0].starts).toBe(12);
    expect(perf[0].name).toBe("Flujo desconocido");
  });

  it("serie diaria: rellena con ceros los días sin datos y suma más de 1 000 por día", () => {
    const { contactGrowth, messageVolume } = buildDailySeries(
      [{ day: "2026-11-02", sent: "4200", failed: 3, new_contacts: 1500 }],
      ["2026-11-01", "2026-11-02", "2026-11-03"],
    );
    expect(messageVolume).toEqual([
      { date: "2026-11-01", sent: 0, failed: 0 },
      { date: "2026-11-02", sent: 4200, failed: 3 },
      { date: "2026-11-03", sent: 0, failed: 0 },
    ]);
    expect(contactGrowth.map((c) => c.count)).toEqual([0, 1500, 0]);
  });
});
