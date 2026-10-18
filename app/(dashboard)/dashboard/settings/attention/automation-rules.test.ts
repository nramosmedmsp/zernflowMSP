import { describe, expect, it } from "vitest";
import type { BusinessHours } from "@/lib/types/database";
import {
  DEFAULT_OFF_HOURS_TEXT,
  automationFromSettings,
  mergeAutomationSettings,
  parseAutomationInput,
  previewOpening,
  renderOffHoursPreview,
  unknownVariables,
} from "./automation-rules";

const OK = { offHoursEnabled: true, offHoursText: "Hola {nombre}", minHoursBetween: "", reassignMinutes: "" };
const HOURS: BusinessHours = { mon: [["09:00", "18:00"]], tue: [["09:00", "18:00"]] };

describe("automationFromSettings", () => {
  it("valores por defecto sin configuración", () => {
    expect(automationFromSettings({})).toEqual({
      offHoursEnabled: false,
      offHoursText: DEFAULT_OFF_HOURS_TEXT,
      minHoursBetween: "",
      reassignMinutes: "",
    });
    expect(automationFromSettings(null).reassignMinutes).toBe("");
  });

  it("lee lo guardado", () => {
    const f = automationFromSettings({
      off_hours_reply: { enabled: true, text: "Hola", min_hours_between: 12 },
      reassign_after_minutes: 30,
    });
    expect(f).toEqual({ offHoursEnabled: true, offHoursText: "Hola", minHoursBetween: "12", reassignMinutes: "30" });
  });
});

describe("parseAutomationInput", () => {
  it("acepta y normaliza", () => {
    const r = parseAutomationInput({
      ...OK,
      offHoursText: "  Hola {nombre}, {empresa} abre {apertura}  ",
      minHoursBetween: "24",
      reassignMinutes: " 45 ",
    });
    expect(r).toEqual({
      value: {
        offHoursReply: { enabled: true, text: "Hola {nombre}, {empresa} abre {apertura}", min_hours_between: 24 },
        reassignAfterMinutes: 45,
      },
    });
  });

  it("vacío = una sola vez y reasignación desactivada", () => {
    expect(parseAutomationInput(OK)).toEqual({
      value: {
        offHoursReply: { enabled: true, text: "Hola {nombre}", min_hours_between: null },
        reassignAfterMinutes: null,
      },
    });
  });

  it("exige texto solo si está activa", () => {
    expect("error" in parseAutomationInput({ ...OK, offHoursText: "  " })).toBe(true);
    expect("error" in parseAutomationInput({ ...OK, offHoursEnabled: false, offHoursText: "" })).toBe(false);
  });

  it("rechaza variables desconocidas, textos largos y números inválidos", () => {
    expect("error" in parseAutomationInput({ ...OK, offHoursText: "Hola {sede}" })).toBe(true);
    expect("error" in parseAutomationInput({ ...OK, offHoursText: "x".repeat(1001) })).toBe(true);
    expect("error" in parseAutomationInput({ ...OK, minHoursBetween: "0" })).toBe(true);
    expect("error" in parseAutomationInput({ ...OK, minHoursBetween: "1.5" })).toBe(true);
    expect("error" in parseAutomationInput({ ...OK, minHoursBetween: "721" })).toBe(true);
    expect("error" in parseAutomationInput({ ...OK, reassignMinutes: "-5" })).toBe(true);
    expect("error" in parseAutomationInput({ ...OK, reassignMinutes: "abc" })).toBe(true);
    expect("error" in parseAutomationInput({ ...OK, reassignMinutes: "43201" })).toBe(true);
    expect("error" in parseAutomationInput({ ...OK, offHoursEnabled: "si" })).toBe(true);
    expect("error" in parseAutomationInput(null)).toBe(true);
  });

  it("detecta variables desconocidas", () => {
    expect(unknownVariables("Hola {nombre} {x} {x} {apertura}")).toEqual(["{x}"]);
    expect(unknownVariables("sin variables")).toEqual([]);
  });
});

describe("mergeAutomationSettings", () => {
  const next = {
    offHoursReply: { enabled: true, text: "Hola", min_hours_between: null },
    reassignAfterMinutes: 30,
  };

  it("conserva las demás claves, incluso las de horarios y atención", () => {
    const current = {
      agent_visibility: "team",
      business_hours: { mon: [["09:00", "18:00"]] },
      key_date_label: "Vence",
    };
    expect(mergeAutomationSettings(current, next)).toEqual({
      ...current,
      off_hours_reply: next.offHoursReply,
      reassign_after_minutes: 30,
    });
  });

  it("quita reassign_after_minutes al desactivarla", () => {
    const merged = mergeAutomationSettings({ reassign_after_minutes: 30, a: 1 }, { ...next, reassignAfterMinutes: null });
    expect(merged).toEqual({ a: 1, off_hours_reply: next.offHoursReply });
  });
});

describe("vista previa", () => {
  it("reemplaza las variables", () => {
    expect(
      renderOffHoursPreview("Hola {nombre}, {empresa} abre {apertura}. {nombre}", {
        nombre: "Ana",
        empresa: "Tienda",
        apertura: "lunes 9:00",
      }),
    ).toBe("Hola Ana, Tienda abre lunes 9:00. Ana");
  });

  it("sin horario no hay apertura", () => {
    expect(previewOpening(new Date(), null)).toBeNull();
  });

  it("cerrado: la próxima apertura real (hora de Lima)", () => {
    // sábado 17 de octubre de 2026, 22:00 en Lima
    expect(previewOpening(new Date("2026-10-18T03:00:00Z"), HOURS)).toBe("lunes 9:00");
  });

  it("abierto: la apertura posterior al próximo cierre", () => {
    // lunes 19 de octubre de 2026, 10:00 en Lima, abierto hasta las 18:00
    expect(previewOpening(new Date("2026-10-19T15:00:00Z"), HOURS)).toBe("mañana 9:00");
  });

  it("respeta los feriados", () => {
    expect(previewOpening(new Date("2026-10-18T03:00:00Z"), HOURS, ["2026-10-19"])).toBe("martes 9:00");
  });
});
