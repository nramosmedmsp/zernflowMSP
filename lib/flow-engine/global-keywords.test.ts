// PRIV-03: Configuración guardaba textos sueltos y el motor esperaba objetos
// `{keyword, action}`: con una palabra guardada, cada mensaje de texto lanzaba
// un TypeError. El resolvedor tolera ambos formatos y datos dañados.

import { describe, expect, it } from "vitest";
import { normalizeGlobalKeywords, resolveGlobalKeyword } from "./global-keywords";

describe("normalizeGlobalKeywords", () => {
  it("un texto suelto es una palabra de baja", () => {
    expect(normalizeGlobalKeywords(["baja", " Stop "])).toEqual([
      { keyword: "baja", action: "unsubscribe" },
      { keyword: "Stop", action: "unsubscribe" },
    ]);
  });

  it("conserva los objetos {keyword, action} y mezcla con textos sin repetir", () => {
    expect(
      normalizeGlobalKeywords([{ keyword: "alta", action: "subscribe" }, "ALTA", { keyword: "baja", action: "unsubscribe" }]),
    ).toEqual([
      { keyword: "alta", action: "subscribe" },
      { keyword: "baja", action: "unsubscribe" },
    ]);
  });

  it("descarta datos dañados sin lanzar", () => {
    expect(normalizeGlobalKeywords(null)).toEqual([]);
    expect(normalizeGlobalKeywords("baja")).toEqual([]);
    expect(normalizeGlobalKeywords({ keyword: "baja" })).toEqual([]);
    expect(normalizeGlobalKeywords([null, 5, undefined, {}, { keyword: 7 }, { keyword: "  " }, [], "", "ok"])).toEqual([
      { keyword: "ok", action: "unsubscribe" },
    ]);
  });
});

describe("resolveGlobalKeyword", () => {
  it("con textos sueltos (lo que guardaba Configuración) da de baja en vez de lanzar", () => {
    expect(resolveGlobalKeyword("BAJA", ["baja"])).toEqual({ handled: true, action: "unsubscribe", keyword: "baja" });
    expect(resolveGlobalKeyword("  Baja ", ["baja"])).toMatchObject({ handled: true, action: "unsubscribe" });
  });

  it("con objetos usa su acción", () => {
    expect(resolveGlobalKeyword("alta", [{ keyword: "ALTA", action: "subscribe" }])).toEqual({
      handled: true,
      action: "subscribe",
      keyword: "ALTA",
    });
  });

  it("una palabra con acción desconocida deja seguir al mensaje", () => {
    expect(resolveGlobalKeyword("hola", [{ keyword: "hola", action: "otra" }])).toEqual({ handled: false, keyword: "hola" });
  });

  it("no lanza con datos corruptos", () => {
    for (const bad of [null, undefined, "baja", 7, {}, [null], [{ keyword: 3 }], [{}], [[]]]) {
      expect(() => resolveGlobalKeyword("baja", bad)).not.toThrow();
      expect(resolveGlobalKeyword("baja", bad)).toEqual({ handled: false });
    }
  });

  it("un texto vacío o que no coincide no se atiende", () => {
    expect(resolveGlobalKeyword("", ["baja"])).toEqual({ handled: false });
    expect(resolveGlobalKeyword(undefined, ["baja"])).toEqual({ handled: false });
    expect(resolveGlobalKeyword("dame de baja por favor", ["baja"])).toEqual({ handled: false });
  });
});
