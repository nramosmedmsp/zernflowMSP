import { describe, expect, it } from "vitest";
import {
  closeOptions,
  closeSelection,
  nextContactChip,
  nextContactOptions,
  relativeDayTime,
  stageSteps,
} from "./case-card-model";

const stage = (id: string, name: string, kind: "open" | "won" | "lost" | "resolved" = "open", archived = false) => ({
  id,
  name,
  kind,
  archived,
});

const venta = [
  stage("s1", "Nuevo interesado"),
  stage("s2", "Asesorando"),
  stage("s3", "Pedido o enlace de pago enviado"),
  stage("s4", "Esperando pago"),
  stage("w", "Pagado", "won"),
  stage("l", "No compró", "lost"),
];

// Miércoles 28 oct 2026, 10:00 en Lima.
const NOW = new Date("2026-10-28T15:00:00Z");

describe("stageSteps", () => {
  it("marca pasadas, actual y siguientes en orden", () => {
    const steps = stageSteps(venta, "s2");
    expect(steps.map((s) => s.state)).toEqual(["past", "current", "next", "next"]);
    expect(steps.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("sin etapa actual todo queda como siguiente", () => {
    expect(stageSteps(venta, null).every((s) => s.state === "next")).toBe(true);
  });

  it("omite finales y archivadas, salvo la actual", () => {
    const stages = [stage("a", "A"), stage("b", "B", "open", true), stage("c", "C")];
    expect(stageSteps(stages, "a").map((s) => s.id)).toEqual(["a", "c"]);
    expect(stageSteps(stages, "b").map((s) => [s.id, s.state])).toEqual([
      ["a", "past"],
      ["b", "current"],
      ["c", "next"],
    ]);
  });

  it("una etapa que no existe deja todo como siguiente", () => {
    expect(stageSteps(venta, "zzz").every((s) => s.state === "next")).toBe(true);
  });
});

describe("closeOptions", () => {
  it("lista las finales con ganadas primero y tono por resultado", () => {
    const options = closeOptions(venta);
    expect(options.map((o) => [o.name, o.tone])).toEqual([
      ["Pagado", "positive"],
      ["No compró", "negative"],
    ]);
  });

  it("pone resuelta antes que perdida aunque venga después", () => {
    const stages = [stage("a", "A"), stage("l", "Sin solución", "lost"), stage("r", "Resuelta", "resolved")];
    expect(closeOptions(stages).map((o) => o.name)).toEqual(["Resuelta", "Sin solución"]);
  });

  it("ignora finales archivadas", () => {
    const stages = [stage("w", "Compró", "won"), stage("l", "No compró", "lost", true)];
    expect(closeOptions(stages).map((o) => o.name)).toEqual(["Compró"]);
  });

  it("sin tipo o sin finales ofrece resolver", () => {
    expect(closeOptions(null)).toEqual([{ stageId: null, name: "Resuelta", kind: "resolved", tone: "positive" }]);
    expect(closeOptions([stage("a", "A")])).toHaveLength(1);
  });
});

describe("closeSelection", () => {
  it("la primera final de un resultado se envía vacía", () => {
    expect(closeSelection(venta, "w")).toEqual({ kind: "won", stageId: "" });
    expect(closeSelection(venta, "l")).toEqual({ kind: "lost", stageId: "" });
  });

  it("una segunda final del mismo resultado conserva su id", () => {
    const stages = [stage("a", "A"), stage("r1", "Resuelta", "resolved"), stage("r2", "Resuelta con nota", "resolved")];
    expect(closeSelection(stages, "r2")).toEqual({ kind: "resolved", stageId: "r2" });
  });

  it("devuelve null si no hay etapa o no es final", () => {
    expect(closeSelection(venta, null)).toBeNull();
    expect(closeSelection(venta, "s1")).toBeNull();
  });
});

describe("nextContactChip", () => {
  it("sin fecha invita a programar", () => {
    expect(nextContactChip(null, NOW)).toEqual({ label: "Programar", tone: "none" });
  });

  it("mañana a las 9:00", () => {
    expect(nextContactChip("2026-10-29T14:00:00Z", NOW)).toEqual({ label: "Mañana 9:00", tone: "ok" });
  });

  it("hoy más tarde", () => {
    expect(nextContactChip("2026-10-28T23:30:00Z", NOW)).toEqual({ label: "Hoy 18:30", tone: "ok" });
  });

  it("atrasado ayer", () => {
    expect(nextContactChip("2026-10-27T15:00:00Z", NOW)).toEqual({ label: "Atrasado: ayer 10:00", tone: "overdue" });
  });

  it("atrasado hoy", () => {
    expect(nextContactChip("2026-10-28T13:15:00Z", NOW)).toEqual({ label: "Atrasado: hoy 8:15", tone: "overdue" });
  });

  it("usa día de la semana dentro de la semana y fecha después", () => {
    expect(nextContactChip("2026-11-02T14:00:00Z", NOW).label).toBe("Lun 9:00");
    expect(nextContactChip("2026-11-20T14:00:00Z", NOW).label).toBe("20 nov 9:00");
  });

  it("usa el día de Lima, no el de UTC", () => {
    // 02:00 UTC del 29 = 21:00 del 28 en Lima.
    expect(relativeDayTime(new Date("2026-10-29T02:00:00Z"), NOW)).toBe("hoy 21:00");
  });

  it("una fecha inválida se trata como sin programar", () => {
    expect(nextContactChip("no es fecha", NOW).tone).toBe("none");
  });
});

describe("nextContactOptions", () => {
  it("miércoles: en 3 h, mañana y lunes", () => {
    const options = nextContactOptions(NOW);
    expect(options.map((o) => o.key)).toEqual(["three-hours", "tomorrow", "monday"]);
    expect(options[0]).toMatchObject({ at: "2026-10-28T18:00:00.000Z", detail: "13:00" });
    expect(options[1]).toMatchObject({ at: "2026-10-29T14:00:00.000Z", detail: "jue 29 oct · 9:00" });
    expect(options[2]).toMatchObject({ at: "2026-11-02T14:00:00.000Z", detail: "lun 2 nov · 9:00" });
  });

  it("domingo: el lunes es mañana, no se repite", () => {
    const sunday = new Date("2026-11-01T15:00:00Z");
    expect(nextContactOptions(sunday).map((o) => o.key)).toEqual(["three-hours", "tomorrow"]);
  });

  it("lunes: el próximo lunes es en 7 días", () => {
    const monday = new Date("2026-11-02T15:00:00Z");
    const monOpt = nextContactOptions(monday).find((o) => o.key === "monday");
    expect(monOpt?.at).toBe("2026-11-09T14:00:00.000Z");
  });
});
