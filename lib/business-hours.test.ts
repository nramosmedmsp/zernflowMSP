import { describe, expect, it } from "vitest";
import {
  PERU_HOLIDAYS,
  addBusinessMinutes,
  businessMinutesBetween,
  easterSunday,
  effectiveBusinessHours,
  formatOpening,
  hasSchedule,
  holidayDatesFor,
  isWithinHours,
  nextOpening,
  parseBusinessHours,
  parseOffHoursReply,
  parseReassignAfterMinutes,
  validateBusinessHours,
  type BusinessHours,
} from "./business-hours";

// Lima = UTC-5. 2026-10-16 viernes, 17 sábado, 18 domingo, 19 lunes.
const lima = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`);

const SPLIT: [string, string][] = [
  ["09:00", "13:00"],
  ["14:00", "19:00"],
];
const STORE: BusinessHours = {
  mon: SPLIT,
  tue: SPLIT,
  wed: SPLIT,
  thu: SPLIT,
  fri: SPLIT,
  sat: [["09:00", "13:00"]],
  sun: [],
};

describe("sin horario", () => {
  it("null o sin tramos = 24 horas y los feriados no aplican", () => {
    expect(isWithinHours(lima("2026-10-18", "03:00"), null)).toBe(true);
    expect(isWithinHours(lima("2026-10-18", "03:00"), {}, ["2026-10-18"])).toBe(true);
    expect(isWithinHours(lima("2026-10-18", "03:00"), { mon: [] })).toBe(true);
    expect(hasSchedule({ sun: [] })).toBe(false);
  });

  it("minutos de reloj y apertura inmediata", () => {
    expect(businessMinutesBetween(lima("2026-10-18", "03:00"), lima("2026-10-18", "05:30"), null)).toBe(150);
    expect(nextOpening(lima("2026-10-18", "03:00"), null)?.toISOString()).toBe(lima("2026-10-18", "03:00").toISOString());
  });
});

describe("tramos partidos (mañana y tarde)", () => {
  it("dentro y fuera del horario, con inicio incluido y fin excluido", () => {
    expect(isWithinHours(lima("2026-10-19", "09:00"), STORE)).toBe(true);
    expect(isWithinHours(lima("2026-10-19", "12:59"), STORE)).toBe(true);
    expect(isWithinHours(lima("2026-10-19", "13:00"), STORE)).toBe(false);
    expect(isWithinHours(lima("2026-10-19", "13:30"), STORE)).toBe(false);
    expect(isWithinHours(lima("2026-10-19", "14:00"), STORE)).toBe(true);
    expect(isWithinHours(lima("2026-10-19", "19:00"), STORE)).toBe(false);
    expect(isWithinHours(lima("2026-10-19", "08:59"), STORE)).toBe(false);
  });

  it("usa el día de Lima, no el de UTC", () => {
    // Lunes 23:30 en Lima es martes 04:30 UTC: cerrado (el martes abre a las 9).
    expect(isWithinHours(new Date("2026-10-20T04:30:00Z"), { mon: [["20:00", "24:00"]] })).toBe(true);
    expect(isWithinHours(new Date("2026-10-20T04:30:00Z"), { tue: [["00:00", "05:00"]] })).toBe(false);
  });

  it("domingo cerrado y sábado medio día", () => {
    expect(isWithinHours(lima("2026-10-18", "10:00"), STORE)).toBe(false);
    expect(isWithinHours(lima("2026-10-17", "10:00"), STORE)).toBe(true);
    expect(isWithinHours(lima("2026-10-17", "15:00"), STORE)).toBe(false);
  });

  it("próxima apertura: después del almuerzo, el lunes tras el fin de semana", () => {
    expect(nextOpening(lima("2026-10-19", "13:30"), STORE)?.toISOString()).toBe(lima("2026-10-19", "14:00").toISOString());
    expect(nextOpening(lima("2026-10-19", "06:00"), STORE)?.toISOString()).toBe(lima("2026-10-19", "09:00").toISOString());
    expect(nextOpening(lima("2026-10-16", "20:00"), STORE)?.toISOString()).toBe(lima("2026-10-17", "09:00").toISOString());
    expect(nextOpening(lima("2026-10-17", "14:00"), STORE)?.toISOString()).toBe(lima("2026-10-19", "09:00").toISOString());
    // Abierto: la apertura es ahora.
    expect(nextOpening(lima("2026-10-19", "10:15"), STORE)?.toISOString()).toBe(lima("2026-10-19", "10:15").toISOString());
  });

  it("minutos hábiles: salta el almuerzo, la noche y el domingo", () => {
    expect(businessMinutesBetween(lima("2026-10-19", "12:00"), lima("2026-10-19", "15:00"), STORE)).toBe(120);
    expect(businessMinutesBetween(lima("2026-10-19", "13:10"), lima("2026-10-19", "13:50"), STORE)).toBe(0);
    // Viernes 18:00 → lunes 10:00: 60 (vie) + 240 (sáb) + 0 (dom) + 60 (lun).
    expect(businessMinutesBetween(lima("2026-10-16", "18:00"), lima("2026-10-19", "10:00"), STORE)).toBe(360);
    // Una semana completa: 5 × 540 + 240.
    expect(businessMinutesBetween(lima("2026-10-19", "00:00"), lima("2026-10-26", "00:00"), STORE)).toBe(2940);
    expect(businessMinutesBetween(lima("2026-10-19", "15:00"), lima("2026-10-19", "12:00"), STORE)).toBe(0);
    // Segundos: fracción de minuto.
    expect(businessMinutesBetween(lima("2026-10-19", "10:00"), new Date(lima("2026-10-19", "10:00").getTime() + 90_000), STORE)).toBe(1.5);
  });
});

describe("feriados de empresa y de equipo", () => {
  const rows = [
    { date: "2026-10-19", team_id: null },
    { date: "2026-10-20", team_id: "sede-a" },
  ];

  it("la empresa cierra en sus feriados; el equipo, además, en los suyos", () => {
    const company = holidayDatesFor(rows, null);
    const teamA = holidayDatesFor(rows, "sede-a");
    const teamB = holidayDatesFor(rows, "sede-b");
    expect([...company]).toEqual(["2026-10-19"]);
    expect([...teamA].sort()).toEqual(["2026-10-19", "2026-10-20"]);
    expect([...teamB]).toEqual(["2026-10-19"]);

    expect(isWithinHours(lima("2026-10-19", "10:00"), STORE, company)).toBe(false);
    expect(isWithinHours(lima("2026-10-20", "10:00"), STORE, teamB)).toBe(true);
    expect(isWithinHours(lima("2026-10-20", "10:00"), STORE, teamA)).toBe(false);
  });

  it("la próxima apertura y los minutos hábiles saltan los feriados", () => {
    const teamA = holidayDatesFor(rows, "sede-a");
    expect(nextOpening(lima("2026-10-17", "14:00"), STORE, teamA)?.toISOString()).toBe(lima("2026-10-21", "09:00").toISOString());
    // Viernes 18:00 → miércoles 10:00 con lunes y martes feriados: 60 + 240 + 60.
    expect(businessMinutesBetween(lima("2026-10-16", "18:00"), lima("2026-10-21", "10:00"), STORE, teamA)).toBe(360);
    expect(businessMinutesBetween(lima("2026-10-16", "18:00"), lima("2026-10-21", "10:00"), STORE, ["2026-10-17"])).toBe(60 + 540 * 2 + 60);
  });

  it("sin apertura en 400 días devuelve null", () => {
    const onlyMondays: BusinessHours = { mon: [["09:00", "10:00"]] };
    const mondays: string[] = [];
    for (let i = 0; i < 70; i++) {
      mondays.push(new Date(Date.UTC(2026, 9, 19) + i * 7 * 86_400_000).toISOString().slice(0, 10));
    }
    expect(nextOpening(lima("2026-10-18", "10:00"), onlyMondays, mondays)).toBeNull();
  });
});

describe("cruces de medianoche", () => {
  const NIGHT: BusinessHours = { fri: [["22:00", "02:00"]], sat: [["01:00", "03:00"]] };

  it("un tramo nocturno sigue abierto pasada la medianoche", () => {
    expect(isWithinHours(lima("2026-10-16", "23:00"), NIGHT)).toBe(true);
    expect(isWithinHours(lima("2026-10-17", "00:30"), NIGHT)).toBe(true);
    expect(isWithinHours(lima("2026-10-17", "02:30"), NIGHT)).toBe(true);
    expect(isWithinHours(lima("2026-10-17", "03:00"), NIGHT)).toBe(false);
    expect(isWithinHours(lima("2026-10-16", "21:59"), NIGHT)).toBe(false);
  });

  it("los tramos que se solapan no se cuentan dos veces", () => {
    // 22:00 → 03:00 unidos = 300 minutos.
    expect(businessMinutesBetween(lima("2026-10-16", "20:00"), lima("2026-10-17", "05:00"), NIGHT)).toBe(300);
  });

  it("el tramo nocturno pertenece al día en que empieza (feriado)", () => {
    const fridayOff = ["2026-10-16"];
    expect(isWithinHours(lima("2026-10-17", "00:30"), NIGHT, fridayOff)).toBe(false);
    expect(isWithinHours(lima("2026-10-17", "01:30"), NIGHT, fridayOff)).toBe(true);
    expect(nextOpening(lima("2026-10-16", "23:00"), NIGHT, fridayOff)?.toISOString()).toBe(lima("2026-10-17", "01:00").toISOString());
  });

  it("24:00 del lunes y 00:00 del martes son continuos", () => {
    const hours: BusinessHours = { mon: [["20:00", "24:00"]], tue: [["00:00", "02:00"]] };
    expect(isWithinHours(lima("2026-10-20", "00:00"), hours)).toBe(true);
    expect(businessMinutesBetween(lima("2026-10-19", "23:00"), lima("2026-10-20", "01:00"), hours)).toBe(120);
  });

  it("cruce de fin de semana: del sábado al lunes", () => {
    const weekend: BusinessHours = { sat: [["20:00", "02:00"]], mon: [["08:00", "09:00"]] };
    // Sábado 21:00 → lunes 08:30: 300 (sáb 21:00 → dom 02:00) + 30.
    expect(businessMinutesBetween(lima("2026-10-17", "21:00"), lima("2026-10-19", "08:30"), weekend)).toBe(330);
    expect(nextOpening(lima("2026-10-18", "03:00"), weekend)?.toISOString()).toBe(lima("2026-10-19", "08:00").toISOString());
  });
});

describe("formatOpening", () => {
  const now = lima("2026-10-18", "20:00"); // domingo

  it("hoy, mañana, día de la semana y fecha lejana", () => {
    expect(formatOpening(lima("2026-10-18", "21:30"), now)).toBe("hoy 21:30");
    expect(formatOpening(lima("2026-10-19", "09:00"), now)).toBe("mañana 9:00");
    expect(formatOpening(lima("2026-10-21", "14:00"), now)).toBe("miércoles 14:00");
    expect(formatOpening(lima("2026-10-24", "09:05"), now)).toBe("sábado 9:05");
    expect(formatOpening(lima("2026-10-26", "09:00"), now)).toBe("lunes 26 de octubre 9:00");
  });

  it("compara días de Lima (de noche en UTC ya es mañana)", () => {
    const lateNow = lima("2026-10-18", "23:30"); // 04:30 UTC del lunes
    expect(formatOpening(lima("2026-10-19", "09:00"), lateNow)).toBe("mañana 9:00");
  });
});

describe("feriados de Perú", () => {
  it("fijos más Jueves y Viernes Santo, ordenados", () => {
    const y2026 = PERU_HOLIDAYS(2026);
    expect(y2026).toHaveLength(16);
    expect(y2026.map((h) => h.date)).toEqual([...y2026.map((h) => h.date)].sort());
    expect(y2026).toContainEqual({ date: "2026-04-02", name: "Jueves Santo" });
    expect(y2026).toContainEqual({ date: "2026-04-03", name: "Viernes Santo" });
    expect(y2026).toContainEqual({ date: "2026-07-28", name: "Fiestas Patrias" });
    expect(y2026).toContainEqual({ date: "2026-12-09", name: "Batalla de Ayacucho" });
    expect(y2026[0]).toEqual({ date: "2026-01-01", name: "Año Nuevo" });
  });

  it("Semana Santa coincide con la tabla de Nexo", () => {
    const holy = (y: number) => PERU_HOLIDAYS(y).filter((h) => h.name.endsWith("Santo")).map((h) => h.date);
    expect(holy(2026)).toEqual(["2026-04-02", "2026-04-03"]);
    expect(holy(2027)).toEqual(["2027-03-25", "2027-03-26"]);
    expect(holy(2028)).toEqual(["2028-04-13", "2028-04-14"]);
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
  });
});

describe("lectura y validación", () => {
  it("parseBusinessHours descarta lo mal formado", () => {
    expect(parseBusinessHours(null)).toBeNull();
    expect(parseBusinessHours({})).toBeNull();
    expect(parseBusinessHours([])).toBeNull();
    expect(parseBusinessHours({ mon: [["9:00", "13:00"]] })).toBeNull();
    expect(
      parseBusinessHours({ mon: [["09:00", "13:00"], ["xx", "yy"], ["10:00", "10:00"]], tue: "no", foo: [["09:00", "10:00"]] }),
    ).toEqual({ mon: [["09:00", "13:00"]] });
  });

  it("horario efectivo: el del equipo o el de la empresa", () => {
    const team = { sat: [["10:00", "12:00"]] };
    expect(effectiveBusinessHours(team, STORE)).toEqual(team);
    // Los días vacíos se omiten (cerrado igual).
    expect(effectiveBusinessHours(null, STORE)).toEqual({ ...STORE, sun: undefined });
    expect(effectiveBusinessHours(null, null)).toBeNull();
  });

  it("validateBusinessHours explica el error en español", () => {
    expect(validateBusinessHours({ mon: [["09:00", "13:00"], ["12:00", "15:00"]] })).toEqual({
      ok: false,
      error: "Los tramos del lunes se superponen.",
    });
    expect(validateBusinessHours({ tue: [["09:00"]] })).toMatchObject({ ok: false });
    expect(validateBusinessHours({ lunes: [] })).toEqual({ ok: false, error: '"lunes" no es un día válido.' });
    expect(validateBusinessHours({ mon: [] })).toEqual({ ok: true, value: null });
    expect(validateBusinessHours({ wed: [["14:00", "19:00"], ["09:00", "13:00"]], sun: [["22:00", "02:00"]] })).toEqual({
      ok: true,
      value: { wed: [["09:00", "13:00"], ["14:00", "19:00"]], sun: [["22:00", "02:00"]] },
    });
  });

  it("respuesta fuera de horario y reasignación", () => {
    expect(parseOffHoursReply({ enabled: true, text: "  Hola {nombre} ", min_hours_between: 12 })).toEqual({
      enabled: true,
      text: "Hola {nombre}",
      min_hours_between: 12,
    });
    expect(parseOffHoursReply({ enabled: "sí", text: 3 })).toEqual({ enabled: false, text: "", min_hours_between: null });
    expect(parseOffHoursReply(null)).toBeNull();
    expect(parseReassignAfterMinutes(30)).toBe(30);
    expect(parseReassignAfterMinutes("45")).toBe(45);
    expect(parseReassignAfterMinutes(0)).toBeNull();
    expect(parseReassignAfterMinutes(1.5)).toBeNull();
    expect(parseReassignAfterMinutes(null)).toBeNull();
  });
});

describe("addBusinessMinutes (R2-10)", () => {
  it("sin horario son minutos de reloj", () => {
    expect(addBusinessMinutes(lima("2026-10-16", "10:00"), 90, null)?.toISOString()).toBe(lima("2026-10-16", "11:30").toISOString());
  });

  it("dentro del mismo tramo", () => {
    expect(addBusinessMinutes(lima("2026-10-16", "09:30"), 60, STORE)?.toISOString()).toBe(lima("2026-10-16", "10:30").toISOString());
  });

  it("salta el almuerzo y el cierre de la tarde hasta el día hábil siguiente", () => {
    // 12:00 + 2 h: 1 h hasta las 13:00 y 1 h desde las 14:00.
    expect(addBusinessMinutes(lima("2026-10-16", "12:00"), 120, STORE)?.toISOString()).toBe(lima("2026-10-16", "15:00").toISOString());
    // Viernes 18:00 + 2 h: 1 h hasta las 19:00 y 1 h el sábado desde las 09:00.
    expect(addBusinessMinutes(lima("2026-10-16", "18:00"), 120, STORE)?.toISOString()).toBe(lima("2026-10-17", "10:00").toISOString());
  });

  it("empieza a contar en la próxima apertura si se pide fuera de horario y respeta feriados", () => {
    // Sábado 14:00 (cerrado) + 1 h: domingo cerrado, lunes 09:00 -> 10:00.
    expect(addBusinessMinutes(lima("2026-10-17", "14:00"), 60, STORE)?.toISOString()).toBe(lima("2026-10-19", "10:00").toISOString());
    // Si el lunes es feriado, pasa al martes.
    expect(addBusinessMinutes(lima("2026-10-17", "14:00"), 60, STORE, ["2026-10-19"])?.toISOString()).toBe(lima("2026-10-20", "10:00").toISOString());
  });

  it("es el inverso de businessMinutesBetween, también a través de semanas", () => {
    const from = lima("2026-10-14", "11:00");
    const due = addBusinessMinutes(from, 24 * 60, STORE)!;
    expect(businessMinutesBetween(from, due, STORE)).toBeCloseTo(24 * 60, 3);
  });

  it("null si el horario nunca abre", () => {
    const days = Array.from({ length: 80 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));
    expect(addBusinessMinutes(lima("2026-10-16", "10:00"), 60, { mon: [["09:00", "10:00"]] } as BusinessHours, new Set(days))).not.toBeNull();
  });
});
