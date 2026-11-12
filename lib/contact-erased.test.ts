import { describe, expect, it } from "vitest";
import { ERASED_DISPLAY_NAME, displayNameFor, erasedNotice, isContactErased } from "./contact-erased";

describe("isContactErased", () => {
  it("usa erased_at", () => {
    expect(isContactErased({ erased_at: "2026-11-01T15:00:00Z" })).toBe(true);
    expect(isContactErased({ erased_at: null })).toBe(false);
    expect(isContactErased({})).toBe(false);
    expect(isContactErased(null)).toBe(false);
    expect(isContactErased(undefined)).toBe(false);
  });
});

describe("erasedNotice", () => {
  it("da la fecha en hora de Lima", () => {
    // 2026-11-02T03:30Z = 1 nov 22:30 en Lima.
    const text = erasedNotice("2026-11-02T03:30:00Z");
    expect(text).toContain("se eliminaron el 1 nov 2026");
    expect(text.endsWith("La ficha es solo de lectura.")).toBe(true);
  });
  it("añade quién solo si se pasa el nombre", () => {
    expect(erasedNotice("2026-11-02T03:30:00Z", "Olga Dueña")).toContain(" por Olga Dueña.");
    expect(erasedNotice("2026-11-02T03:30:00Z")).not.toContain(" por ");
  });
  it("sin fecha igual avisa", () => {
    expect(erasedNotice(null)).toBe("Los datos de este cliente se eliminaron. La ficha es solo de lectura.");
  });
});

describe("displayNameFor", () => {
  it("nombre vacío de un eliminado", () => {
    expect(displayNameFor({ display_name: null, erased_at: "2026-11-01T00:00:00Z" }, "Desconocido")).toBe(ERASED_DISPLAY_NAME);
    expect(displayNameFor({ display_name: "  ", erased_at: "2026-11-01T00:00:00Z" }, "Desconocido")).toBe(ERASED_DISPLAY_NAME);
  });
  it("contacto normal sin nombre", () => {
    expect(displayNameFor({ display_name: null }, "Desconocido")).toBe("Desconocido");
    expect(displayNameFor({ display_name: "Ana" }, "Desconocido")).toBe("Ana");
  });
});
