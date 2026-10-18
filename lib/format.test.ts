import { describe, it, expect } from "vitest";
import {
  APP_LOCALE,
  APP_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelative,
  formatTime,
} from "./format";

// 2026-10-18T19:35:00Z = 18 oct 2026, 14:35 en Lima (UTC-5, sin horario de verano).
const AFTERNOON = "2026-10-18T19:35:00Z";
// 2026-10-18T04:30:00Z = 17 oct 2026, 23:30 en Lima: en UTC ya es el 18.
const LIMA_PREVIOUS_DAY = "2026-10-18T04:30:00Z";

describe("constants", () => {
  it("exposes the Peru locale and time zone", () => {
    expect(APP_LOCALE).toBe("es-PE");
    expect(APP_TIME_ZONE).toBe("America/Lima");
  });
});

describe("formatDate", () => {
  it("formats day, short month without dot, and year", () => {
    expect(formatDate(AFTERNOON)).toBe("18 oct 2026");
  });

  it("does not pad the day and drops the dot of every month", () => {
    expect(formatDate("2026-01-05T12:00:00Z")).toBe("5 ene 2026");
    for (let m = 0; m < 12; m++) {
      expect(formatDate(Date.UTC(2026, m, 15, 12))).toMatch(/^15 [a-zñ]{3} 2026$/);
    }
  });

  it("accepts Date and epoch milliseconds", () => {
    expect(formatDate(new Date(AFTERNOON))).toBe("18 oct 2026");
    expect(formatDate(Date.parse(AFTERNOON))).toBe("18 oct 2026");
  });

  it("uses the Lima calendar day, not UTC", () => {
    expect(formatDate(LIMA_PREVIOUS_DAY)).toBe("17 oct 2026");
  });

  it("returns an empty string for null, undefined and invalid input", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("no es una fecha")).toBe("");
    expect(formatDate(NaN)).toBe("");
    expect(formatDate(new Date("invalid"))).toBe("");
  });
});

describe("formatDateTime", () => {
  it("formats date and 24-hour time", () => {
    expect(formatDateTime(AFTERNOON)).toBe("18 oct 2026, 14:35");
  });

  it("shows the Lima day and time across the UTC day boundary", () => {
    expect(formatDateTime(LIMA_PREVIOUS_DAY)).toBe("17 oct 2026, 23:30");
  });

  it("never emits a.m./p.m. markers", () => {
    expect(formatDateTime("2026-10-18T22:05:00Z")).toBe("18 oct 2026, 17:05");
  });

  it("returns an empty string for null, undefined and invalid input", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime(undefined)).toBe("");
    expect(formatDateTime("basura")).toBe("");
  });
});

describe("formatTime", () => {
  it("formats 24-hour time", () => {
    expect(formatTime(AFTERNOON)).toBe("14:35");
  });

  it("zero-pads hours and uses 00 for midnight, never 24", () => {
    expect(formatTime("2026-10-18T05:05:00Z")).toBe("00:05");
    expect(formatTime("2026-10-18T14:09:00Z")).toBe("09:09");
  });

  it("uses Lima time across the UTC day boundary", () => {
    expect(formatTime(LIMA_PREVIOUS_DAY)).toBe("23:30");
  });

  it("returns an empty string for null, undefined and invalid input", () => {
    expect(formatTime(null)).toBe("");
    expect(formatTime(undefined)).toBe("");
    expect(formatTime(new Date("x"))).toBe("");
  });
});

describe("formatRelative", () => {
  // 2026-10-18 12:00 en Lima.
  const now = new Date("2026-10-18T17:00:00Z");
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  it("says 'ahora' under a minute, past or future", () => {
    expect(formatRelative(at(0), now)).toBe("ahora");
    expect(formatRelative(at(-30_000), now)).toBe("ahora");
    expect(formatRelative(at(30_000), now)).toBe("ahora");
  });

  it("handles past minutes and hours", () => {
    expect(formatRelative(at(-MIN), now)).toBe("hace 1 min");
    expect(formatRelative(at(-5 * MIN), now)).toBe("hace 5 min");
    expect(formatRelative(at(-59 * MIN), now)).toBe("hace 59 min");
    expect(formatRelative(at(-HOUR), now)).toBe("hace 1 h");
    expect(formatRelative(at(-2 * HOUR), now)).toBe("hace 2 h");
  });

  it("handles past days by calendar day", () => {
    expect(formatRelative("2026-10-17T15:00:00Z", now)).toBe("ayer");
    expect(formatRelative("2026-10-15T17:00:00Z", now)).toBe("hace 3 días");
    expect(formatRelative("2026-10-12T17:00:00Z", now)).toBe("hace 6 días");
  });

  it("switches to the absolute date from 7 days", () => {
    expect(formatRelative("2026-10-11T17:00:00Z", now)).toBe("11 oct 2026");
    expect(formatRelative("2026-01-05T17:00:00Z", now)).toBe("5 ene 2026");
  });

  it("handles future minutes, hours and days symmetrically", () => {
    expect(formatRelative(at(5 * MIN), now)).toBe("en 5 min");
    expect(formatRelative(at(2 * HOUR), now)).toBe("en 2 h");
    expect(formatRelative("2026-10-19T17:00:00Z", now)).toBe("mañana");
    expect(formatRelative("2026-10-21T17:00:00Z", now)).toBe("en 3 días");
    expect(formatRelative("2026-10-24T17:00:00Z", now)).toBe("en 6 días");
    expect(formatRelative("2026-10-25T17:00:00Z", now)).toBe("25 oct 2026");
  });

  it("computes 'ayer' by Lima calendar day, not by 24 hours", () => {
    // Ahora: 00:30 del 18 en Lima. Hace 1 h 30 min fue el 17 a las 23:00.
    const justAfterMidnight = new Date("2026-10-18T05:30:00Z");
    expect(formatRelative("2026-10-18T04:00:00Z", justAfterMidnight)).toBe("ayer");
    // Hace 23 h 30 min sigue siendo "ayer"; pasadas 24 h también.
    expect(formatRelative("2026-10-17T06:00:00Z", justAfterMidnight)).toBe("ayer");
    expect(formatRelative("2026-10-17T05:00:00Z", justAfterMidnight)).toBe("ayer");
  });

  it("computes 'mañana' by Lima calendar day, not by 24 hours", () => {
    // Ahora: 23:30 del 17 en Lima. En 1 h ya es el 18 en Lima.
    const lateEvening = new Date(LIMA_PREVIOUS_DAY);
    expect(formatRelative("2026-10-18T05:30:00Z", lateEvening)).toBe("mañana");
  });

  it("does not call a same-Lima-day date 'ayer' just because UTC rolled over", () => {
    // Ahora: 22:00 del 17 en Lima (ya es 18 en UTC). Valor: 15:00 del mismo día.
    const lateEvening = new Date("2026-10-18T03:00:00Z");
    expect(formatRelative("2026-10-17T20:00:00Z", lateEvening)).toBe("hace 7 h");
  });

  it("keeps minutes for under an hour even across midnight", () => {
    // Ahora 00:10 del 18 en Lima; valor 23:50 del 17.
    const justAfterMidnight = new Date("2026-10-18T05:10:00Z");
    expect(formatRelative("2026-10-18T04:50:00Z", justAfterMidnight)).toBe("hace 20 min");
  });

  it("uses day words for exact 24h multiples", () => {
    expect(formatRelative(at(-DAY), now)).toBe("ayer");
    expect(formatRelative(at(-3 * DAY), now)).toBe("hace 3 días");
    expect(formatRelative(at(DAY), now)).toBe("mañana");
  });

  it("defaults 'now' to the current time", () => {
    expect(formatRelative(new Date())).toBe("ahora");
  });

  it("returns an empty string for null, undefined and invalid input", () => {
    expect(formatRelative(null, now)).toBe("");
    expect(formatRelative(undefined, now)).toBe("");
    expect(formatRelative("nada", now)).toBe("");
    expect(formatRelative(AFTERNOON, new Date("invalid"))).toBe("");
  });
});

describe("formatNumber", () => {
  it("uses es-PE grouping and decimal separators", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(1234567.891)).toBe("1,234,567.891");
    expect(formatNumber(-9876.5)).toBe("-9,876.5");
  });

  it("returns an empty string for null, undefined and non-finite values", () => {
    expect(formatNumber(null)).toBe("");
    expect(formatNumber(undefined)).toBe("");
    expect(formatNumber(NaN)).toBe("");
    expect(formatNumber(Infinity)).toBe("");
  });

  it("accepts numeric strings and rejects blank or garbage strings", () => {
    expect(formatNumber("1500")).toBe("1,500");
    expect(formatNumber("")).toBe("");
    expect(formatNumber("   ")).toBe("");
    expect(formatNumber("abc")).toBe("");
  });
});
