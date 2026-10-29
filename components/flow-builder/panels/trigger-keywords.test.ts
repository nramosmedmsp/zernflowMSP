import { describe, expect, it } from "vitest";
import { hasKeyword } from "./TriggerPanel";

describe("hasKeyword (B-40)", () => {
  const keywords = [{ value: "Hola", matchType: "contains" }];
  it("detecta la misma palabra sin importar mayúsculas ni espacios", () => {
    expect(hasKeyword(keywords, "  hola ", "contains")).toBe(true);
  });
  it("con otro tipo de coincidencia sí se puede agregar", () => {
    expect(hasKeyword(keywords, "hola", "exact")).toBe(false);
    expect(hasKeyword(keywords, "precio", "contains")).toBe(false);
  });
});
