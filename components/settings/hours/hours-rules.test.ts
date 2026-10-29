import { describe, expect, it } from "vitest";
import type { TimeRange } from "@/lib/business-hours";
import {
  addRange,
  checkHolidayInput,
  checkHoursInput,
  cleanHolidayName,
  copyDay,
  describeDay,
  draftHasInvalidRange,
  draftFromHours,
  draftToPayload,
  emptyDraft,
  isHolidayYear,
  mergeBusinessHoursSettings,
  missingPeruHolidays,
  openWeekdaysIfEmpty,
  removeRange,
  sameDraft,
  setDayClosed,
  updateRange,
} from "./hours-rules";

describe("edición del borrador", () => {
  it("copia un día a otros sin tocar el resto ni compartir referencias", () => {
    const d = {
      ...emptyDraft(),
      mon: [
        ["09:00", "13:00"],
        ["14:00", "19:00"],
      ] as TimeRange[],
    };
    const next = copyDay(d, "mon", ["tue", "wed", "mon"]);
    expect(next.tue).toEqual(d.mon);
    expect(next.wed).toEqual(d.mon);
    expect(next.thu).toEqual([]);
    next.tue[0][0] = "10:00";
    expect(next.wed[0][0]).toBe("09:00");
    expect(d.mon[0][0]).toBe("09:00");
  });

  it("agrega un tramo a continuación del último y respeta el máximo", () => {
    let d = setDayClosed(emptyDraft(), "mon", false);
    expect(d.mon).toEqual([["09:00", "18:00"]]);
    d = addRange(d, "mon");
    expect(d.mon[1]).toEqual(["18:00", "22:00"]);
    d = addRange(d, "mon");
    expect(d.mon[2]).toEqual(["22:00", "24:00"]);
    for (let i = 0; i < 10; i++) d = addRange(d, "mon");
    expect(d.mon).toHaveLength(6);
  });

  it("un día vacío arranca con el tramo por defecto", () => {
    expect(addRange(emptyDraft(), "sat").sat).toEqual([["09:00", "18:00"]]);
  });

  it("actualiza, quita y cierra días", () => {
    let d = setDayClosed(emptyDraft(), "tue", false);
    d = updateRange(d, "tue", 0, ["08:00", "12:00"]);
    expect(d.tue).toEqual([["08:00", "12:00"]]);
    d = removeRange(d, "tue", 0);
    expect(d.tue).toEqual([]);
    d = setDayClosed(setDayClosed(emptyDraft(), "tue", false), "tue", true);
    expect(d.tue).toEqual([]);
  });

  it("abre de lunes a viernes solo si no hay ningún tramo", () => {
    const opened = openWeekdaysIfEmpty(emptyDraft());
    expect(opened.mon).toHaveLength(1);
    expect(opened.sat).toEqual([]);
    expect(openWeekdaysIfEmpty(opened)).toBe(opened);
  });

  it("convierte entre lo guardado y el borrador", () => {
    const d = draftFromHours({ mon: [["09:00", "13:00"]], sun: [], xyz: [["09:00", "10:00"]] });
    expect(d.mon).toEqual([["09:00", "13:00"]]);
    expect(draftToPayload(d)).toEqual({ mon: [["09:00", "13:00"]] });
    expect(draftFromHours(null)).toEqual(emptyDraft());
    expect(sameDraft(d, draftFromHours({ mon: [["09:00", "13:00"]] }))).toBe(true);
    expect(sameDraft(d, emptyDraft())).toBe(false);
  });

  it("describe un día", () => {
    expect(describeDay([])).toBe("Cerrado");
    expect(
      describeDay([
        ["09:00", "13:00"],
        ["14:00", "19:00"],
      ]),
    ).toBe("09:00-13:00, 14:00-19:00");
  });
});

describe("checkHoursInput", () => {
  it("acepta un horario válido y lo ordena", () => {
    const r = checkHoursInput(
      {
        mon: [
          ["14:00", "19:00"],
          ["09:00", "13:00"],
        ],
      },
      "company",
    );
    expect(r).toEqual({
      ok: true,
      value: {
        mon: [
          ["09:00", "13:00"],
          ["14:00", "19:00"],
        ],
      },
    });
  });

  it("acepta tramos nocturnos y 24:00", () => {
    expect(checkHoursInput({ fri: [["22:00", "02:00"]], sat: [["00:00", "24:00"]] }, "team").ok).toBe(true);
  });

  it("rechaza tramos iguales, mal formados, superpuestos o de más", () => {
    expect(checkHoursInput({ mon: [["09:00", "09:00"]] }, "company").ok).toBe(false);
    expect(checkHoursInput({ mon: [["9:00", "13:00"]] }, "company").ok).toBe(false);
    expect(checkHoursInput({ mon: [["24:00", "02:00"]] }, "company").ok).toBe(false);
    const overlap = checkHoursInput(
      {
        mon: [
          ["09:00", "13:00"],
          ["12:00", "18:00"],
        ],
      },
      "company",
    );
    expect(overlap).toEqual({ ok: false, error: "Los tramos del lunes se superponen." });
    const seven = Array.from({ length: 7 }, (_, i) => [`0${i}:00`, `0${i}:30`]);
    expect(checkHoursInput({ mon: seven }, "company").ok).toBe(false);
    expect(checkHoursInput({ dom: [] }, "company").ok).toBe(false);
    expect(checkHoursInput([], "company").ok).toBe(false);
  });

  it("empresa sin tramos = 24 horas (null)", () => {
    expect(checkHoursInput({}, "company")).toEqual({ ok: true, value: null });
    expect(checkHoursInput(null, "company")).toEqual({ ok: true, value: null });
  });

  it("equipo: null usa el de la empresa, pero un horario propio necesita tramos", () => {
    expect(checkHoursInput(null, "team")).toEqual({ ok: true, value: null });
    expect(checkHoursInput({ mon: [] }, "team").ok).toBe(false);
  });
});

describe("mergeBusinessHoursSettings", () => {
  it("conserva las demás claves", () => {
    const current = { agent_visibility: "team", off_hours_reply: { enabled: true }, extra: 1 };
    const merged = mergeBusinessHoursSettings(current, { mon: [["09:00", "18:00"]] });
    expect(merged).toEqual({ ...current, business_hours: { mon: [["09:00", "18:00"]] } });
    expect(current).not.toHaveProperty("business_hours");
  });

  it("quita business_hours cuando es null y tolera settings vacíos", () => {
    expect(mergeBusinessHoursSettings({ a: 1, business_hours: { mon: [["09:00", "10:00"]] } }, null)).toEqual({ a: 1 });
    expect(mergeBusinessHoursSettings(null, null)).toEqual({});
  });
});

describe("feriados", () => {
  it("valida fecha y nombre", () => {
    expect(checkHolidayInput("2026-12-31", "  Día   no laborable ")).toEqual({
      ok: true,
      date: "2026-12-31",
      name: "Día no laborable",
    });
    expect(checkHolidayInput("2026-02-30", "x").ok).toBe(false);
    expect(checkHolidayInput("31/12/2026", "x").ok).toBe(false);
    expect(checkHolidayInput("2026-12-31", "   ").ok).toBe(false);
    expect(cleanHolidayName("x".repeat(300))).toHaveLength(200);
  });

  it("valida el año", () => {
    expect(isHolidayYear(2026)).toBe(true);
    expect(isHolidayYear(1999)).toBe(false);
    expect(isHolidayYear("2026")).toBe(false);
    expect(isHolidayYear(2026.5)).toBe(false);
  });

  it("carga los feriados de Perú sin duplicar los existentes", () => {
    const all = missingPeruHolidays(2026, []);
    expect(all.length).toBeGreaterThanOrEqual(16);
    expect(all.every((h) => h.date.startsWith("2026-"))).toBe(true);
    const some = missingPeruHolidays(2026, ["2026-01-01", "2026-12-25T00:00:00"]);
    expect(some).toHaveLength(all.length - 2);
    expect(some.find((h) => h.date === "2026-01-01")).toBeUndefined();
    expect(
      missingPeruHolidays(
        2026,
        all.map((h) => h.date),
      ),
    ).toEqual([]);
  });
});

describe("B-8: tramos inválidos", () => {
  it("detecta un tramo cuyo inicio y fin son iguales", () => {
    const ok = { ...emptyDraft(), mon: [["09:00", "18:00"]] as TimeRange[] };
    const bad = { ...ok, tue: [["09:00", "09:00"]] as TimeRange[] };
    expect(draftHasInvalidRange(emptyDraft())).toBe(false);
    expect(draftHasInvalidRange(ok)).toBe(false);
    expect(draftHasInvalidRange(bad)).toBe(true);
  });
});
