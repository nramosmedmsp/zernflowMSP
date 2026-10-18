import { describe, expect, it } from "vitest";
import { parseImportDate } from "./dates";
import { normalizeImportPhone, senderIdFromPhone } from "./phone";

function phone(input: string) {
  const r = normalizeImportPhone(input);
  return r.ok ? r.value : "ERROR";
}

describe("normalizeImportPhone", () => {
  it("vacío es sin teléfono", () => {
    expect(phone("")).toBeNull();
    expect(phone("   ")).toBeNull();
  });
  it("celular de Perú de 9 dígitos que empieza en 9 va con +51", () => {
    expect(phone("987654321")).toBe("+51987654321");
    expect(phone("987 654 321")).toBe("+51987654321");
    expect(phone("987-654-321")).toBe("+51987654321");
    expect(phone("987654321.0")).toBe("+51987654321");
  });
  it("respeta el código de país", () => {
    expect(phone("+51 987 654 321")).toBe("+51987654321");
    expect(phone("51987654321")).toBe("+51987654321");
    expect(phone("0051987654321")).toBe("+51987654321");
    expect(phone("+57 300 123 4567")).toBe("+573001234567");
    expect(phone("+1 (212) 555-1234")).toBe("+12125551234");
  });
  it("el resto es inválido", () => {
    expect(phone("887654321")).toBe("ERROR"); // 9 dígitos que no empiezan en 9
    expect(phone("12345")).toBe("ERROR");
    expect(phone("2125551234")).toBe("ERROR"); // 10 dígitos sin código de país
    expect(phone("abc")).toBe("ERROR");
    expect(phone("9.87654321E+8")).toBe("ERROR");
    expect(phone("+123")).toBe("ERROR");
  });
  it("el id del remitente es el teléfono sin +", () => {
    expect(senderIdFromPhone("+51987654321")).toBe("51987654321");
  });
});

describe("parseImportDate", () => {
  const date = (s: string) => {
    const r = parseImportDate(s);
    return r.ok ? r.value : "ERROR";
  };
  it("acepta dd/mm/aaaa y aaaa-mm-dd", () => {
    expect(date("15/03/2026")).toBe("2026-03-15");
    expect(date("5/3/2026")).toBe("2026-03-05");
    expect(date("2026-03-15")).toBe("2026-03-15");
    expect(date("15-03-2026")).toBe("2026-03-15");
    expect(date("2026-03-15 00:00:00")).toBe("2026-03-15");
  });
  it("vacío es sin fecha", () => {
    expect(date("")).toBeNull();
  });
  it("rechaza fechas imposibles o con otro formato", () => {
    expect(date("31/02/2026")).toBe("ERROR");
    expect(date("2026-13-01")).toBe("ERROR");
    expect(date("03/15/2026")).toBe("ERROR");
    expect(date("15/03/26")).toBe("ERROR");
    expect(date("mañana")).toBe("ERROR");
  });
});
