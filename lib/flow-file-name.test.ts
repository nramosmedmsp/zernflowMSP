import { describe, expect, it } from "vitest";
import { flowFileName } from "./flow-file-name";

describe("flowFileName", () => {
  it("quita las tildes en vez de convertirlas en guiones", () => {
    expect(flowFileName("Catálogo y precios")).toBe("catalogo-y-precios.flow.json");
    expect(flowFileName("  ¡Promoción  de Año Nuevo! ")).toBe("promocion-de-ano-nuevo.flow.json");
  });
  it("un nombre sin letras ni números usa un nombre por defecto", () => {
    expect(flowFileName("???")).toBe("flujo.flow.json");
  });
});
