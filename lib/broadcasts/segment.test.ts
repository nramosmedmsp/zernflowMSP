import { describe, expect, it } from "vitest";
import {
  combineSets,
  formatDateRange,
  matchesContactRule,
  parseCustomFieldValue,
  parseDateRange,
  type SegmentContact,
  type SegmentRule,
} from "./segment";

const contact = (extra: Partial<SegmentContact> = {}): SegmentContact => ({
  id: "c1",
  contact_type_id: "t-socio",
  team_id: "team-1",
  owner_id: "u-ana",
  key_date: "2026-11-15",
  ...extra,
});
const rule = (field: string, operator: string, value: string): SegmentRule => ({ field, operator, value });

describe("filtros de tipo de contacto, equipo y responsable", () => {
  it("equals y not_equals comparan el id", () => {
    expect(matchesContactRule(contact(), rule("contact_type", "equals", "t-socio"))).toBe(true);
    expect(matchesContactRule(contact(), rule("contact_type", "equals", "t-otro"))).toBe(false);
    expect(matchesContactRule(contact(), rule("contact_type", "not_equals", "t-otro"))).toBe(true);
    expect(matchesContactRule(contact(), rule("team", "equals", "team-1"))).toBe(true);
    expect(matchesContactRule(contact(), rule("owner", "not_equals", "u-ana"))).toBe(false);
  });

  it("el valor none coincide con los que no tienen equipo, tipo o responsable", () => {
    expect(matchesContactRule(contact({ owner_id: null }), rule("owner", "equals", "none"))).toBe(true);
    expect(matchesContactRule(contact(), rule("owner", "equals", "none"))).toBe(false);
    expect(matchesContactRule(contact({ team_id: null }), rule("team", "not_equals", "none"))).toBe(false);
  });

  it("un filtro sin valor no coincide con nadie", () => {
    expect(matchesContactRule(contact(), rule("team", "equals", ""))).toBe(false);
  });
});

describe("filtro de fecha clave (rango)", () => {
  const between = (from: string | null, to: string | null) => rule("key_date", "between", formatDateRange(from, to));

  it("entre dos fechas, inclusive", () => {
    expect(matchesContactRule(contact(), between("2026-11-01", "2026-11-30"))).toBe(true);
    expect(matchesContactRule(contact(), between("2026-11-15", "2026-11-15"))).toBe(true);
    expect(matchesContactRule(contact(), between("2026-11-16", "2026-11-30"))).toBe(false);
    expect(matchesContactRule(contact(), between("2026-10-01", "2026-11-14"))).toBe(false);
  });

  it("rango abierto por un lado", () => {
    expect(matchesContactRule(contact(), between("2026-11-01", null))).toBe(true);
    expect(matchesContactRule(contact(), between(null, "2026-11-01"))).toBe(false);
  });

  it("desde y hasta con una sola fecha", () => {
    expect(matchesContactRule(contact(), rule("key_date", "after", "2026-11-15"))).toBe(true);
    expect(matchesContactRule(contact(), rule("key_date", "after", "2026-11-16"))).toBe(false);
    expect(matchesContactRule(contact(), rule("key_date", "before", "2026-11-15"))).toBe(true);
    expect(matchesContactRule(contact(), rule("key_date", "before", "2026-11-14"))).toBe(false);
  });

  it("sin fecha clave o sin rango no coincide", () => {
    expect(matchesContactRule(contact({ key_date: null }), between("2026-01-01", "2026-12-31"))).toBe(false);
    expect(matchesContactRule(contact(), between(null, null))).toBe(false);
    expect(matchesContactRule(contact(), rule("key_date", "after", "no-es-fecha"))).toBe(false);
  });

  it("parseDateRange y formatDateRange son inversos", () => {
    expect(parseDateRange("2026-11-01::2026-11-30")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(parseDateRange("::2026-11-30")).toEqual({ from: null, to: "2026-11-30" });
    expect(parseDateRange("")).toEqual({ from: null, to: null });
    expect(formatDateRange("2026-11-01", null)).toBe("2026-11-01::");
  });
});

describe("combinación de reglas y filtros existentes", () => {
  it("and intersecta y or une", () => {
    const a = new Set(["1", "2", "3"]);
    const b = new Set(["2", "3", "4"]);
    expect([...combineSets("and", [a, b])].sort()).toEqual(["2", "3"]);
    expect([...combineSets("or", [a, b])].sort()).toEqual(["1", "2", "3", "4"]);
    expect(combineSets("and", []).size).toBe(0);
  });

  it("el campo personalizado acepta slug::valor (interfaz) y slug:valor", () => {
    expect(parseCustomFieldValue("plan::Mensual: gold")).toEqual({ slug: "plan", value: "Mensual: gold" });
    expect(parseCustomFieldValue("plan:Anual")).toEqual({ slug: "plan", value: "Anual" });
  });

  it("los campos de la fase 1 no se resuelven en memoria", () => {
    expect(matchesContactRule(contact(), rule("has_tag", "equals", "x"))).toBe(false);
  });
});
