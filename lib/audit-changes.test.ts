import { describe, expect, it } from "vitest";
import { hoursChangeMeta, keywordsChangeMeta, pairIfChanged } from "./audit-changes";
import { sanitizeAuditMeta } from "./audit";

describe("hoursChangeMeta", () => {
  it("anota solo los días que cambiaron, con antes → después", () => {
    const before = { mon: [["09:00", "21:00"]], tue: [["09:00", "18:00"]] };
    const after = { mon: [["09:00", "20:00"]], tue: [["09:00", "18:00"]], sat: [["10:00", "14:00"]] };
    expect(hoursChangeMeta(before, after, "company")).toEqual({
      day_mon_from: "09:00-21:00",
      day_mon_to: "09:00-20:00",
      day_sat_from: "Cerrado",
      day_sat_to: "10:00-14:00",
    });
  });

  it("sin cambios devuelve null", () => {
    const h = { mon: [["09:00", "18:00"]] };
    expect(hoursChangeMeta(h, { ...h }, "company")).toBeNull();
    expect(hoursChangeMeta(null, {}, "company")).toBeNull();
  });

  it("empresa sin tramos = 24 horas; equipo sin horario propio usa el de la empresa", () => {
    expect(hoursChangeMeta(null, { mon: [["09:00", "18:00"]] }, "company")).toMatchObject({ day_mon_from: "24 horas", day_mon_to: "09:00-18:00", day_tue_from: "24 horas", day_tue_to: "Cerrado" });
    expect(hoursChangeMeta({ mon: [["09:00", "18:00"]] }, null, "team")).toMatchObject({ day_mon_from: "09:00-18:00", day_mon_to: "Cerrado", uses_company_hours: true });
  });

  it("todo lo que genera pasa el filtro de secretos de logAudit", () => {
    const meta = hoursChangeMeta(null, { mon: [["09:00", "18:00"]] }, "team")!;
    expect(sanitizeAuditMeta({ ...meta, team_name: "Ventas" })).toEqual({ ...meta, team_name: "Ventas" });
  });
});

describe("pairIfChanged", () => {
  it("agrega el par solo si cambió", () => {
    const meta: Record<string, string | number | boolean | null> = {};
    pairIfChanged(meta, "a", 1, 1);
    pairIfChanged(meta, "b", null, 30);
    expect(meta).toEqual({ b_from: null, b_to: 30 });
    expect(sanitizeAuditMeta(meta)).toEqual(meta);
  });
});

describe("keywordsChangeMeta", () => {
  it("agregadas, quitadas y con otra acción", () => {
    const meta = keywordsChangeMeta(
      [{ keyword: "baja", action: "unsubscribe" }, { keyword: "stop" }],
      [{ keyword: "baja", action: "subscribe" }, { keyword: "alta", action: "subscribe" }],
    );
    expect(meta).toEqual({ added: "alta (alta)", removed: "stop (baja)", changed: "baja (alta)", total: 2 });
    expect(sanitizeAuditMeta(meta!)).toEqual(meta);
  });

  it("sin cambios devuelve null", () => {
    expect(keywordsChangeMeta([{ keyword: "baja", action: "unsubscribe" }], [{ keyword: "baja", action: "unsubscribe" }])).toBeNull();
    expect(keywordsChangeMeta([], [])).toBeNull();
  });
});
